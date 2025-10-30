import {
  logger,
  validateUuid,
  stringToUuid,
  type UUID,
  type ElizaOS,
  ChannelType,
} from '@elizaos/core';
import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { paymentMiddleware } from 'x402-express';
import type { AgentServer } from '../../index';
import {
  JobStatus,
  type CreateJobRequest,
  type CreateJobResponse,
  type JobDetailsResponse,
  type Job,
} from '../../types/jobs';
import internalMessageBus from '../../bus';

const DEFAULT_SERVER_ID = '00000000-0000-0000-0000-000000000000' as UUID;
const DEFAULT_JOB_TIMEOUT_MS = 30000; // 30 seconds
const MAX_JOB_TIMEOUT_MS = 300000; // 5 minutes
const JOB_CLEANUP_INTERVAL_MS = 60000; // 1 minute
const MAX_JOBS_IN_MEMORY = 10000; // Prevent memory leaks

// In-memory job storage
const jobs = new Map<string, Job>();

// Track cleanup interval
let cleanupInterval: NodeJS.Timeout | null = null;

/**
 * Cleanup expired jobs
 */
function cleanupExpiredJobs(): void {
  const now = Date.now();
  let cleanedCount = 0;

  for (const [jobId, job] of jobs.entries()) {
    // Remove jobs that are expired and completed/failed
    if (
      job.expiresAt < now &&
      (job.status === JobStatus.COMPLETED ||
        job.status === JobStatus.FAILED ||
        job.status === JobStatus.TIMEOUT)
    ) {
      jobs.delete(jobId);
      cleanedCount++;
    }
    // Mark timed-out jobs
    else if (job.expiresAt < now && job.status === JobStatus.PROCESSING) {
      job.status = JobStatus.TIMEOUT;
      job.error = 'Job timed out waiting for agent response';
      logger.warn(`[Jobs API] Job ${jobId} timed out`);
    }
  }

  if (cleanedCount > 0) {
    logger.info(`[Jobs API] Cleaned up ${cleanedCount} expired jobs. Current jobs: ${jobs.size}`);
  }

  // Emergency cleanup if too many jobs in memory
  if (jobs.size > MAX_JOBS_IN_MEMORY) {
    const sortedJobs = Array.from(jobs.entries()).sort(
      ([, a], [, b]) => a.createdAt - b.createdAt
    );
    const toRemove = sortedJobs.slice(0, Math.floor(MAX_JOBS_IN_MEMORY * 0.1)); // Remove oldest 10%
    toRemove.forEach(([jobId]) => jobs.delete(jobId));
    logger.warn(
      `[Jobs API] Emergency cleanup: removed ${toRemove.length} oldest jobs. Current: ${jobs.size}`
    );
  }
}

/**
 * Initialize cleanup interval
 */
function startCleanupInterval(): void {
  if (!cleanupInterval) {
    cleanupInterval = setInterval(cleanupExpiredJobs, JOB_CLEANUP_INTERVAL_MS);
    logger.info('[Jobs API] Started job cleanup interval');
  }
}

/**
 * Stop cleanup interval
 */
function stopCleanupInterval(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
    logger.info('[Jobs API] Stopped job cleanup interval');
  }
}

/**
 * Convert Job to JobDetailsResponse
 */
function jobToResponse(job: Job): JobDetailsResponse {
  return {
    jobId: job.id,
    status: job.status,
    agentId: job.agentId,
    userId: job.userId,
    prompt: job.prompt,
    createdAt: job.createdAt,
    expiresAt: job.expiresAt,
    result: job.result,
    error: job.error,
    metadata: job.metadata,
  };
}

/**
 * Validate CreateJobRequest (userId is now optional)
 */
function isValidCreateJobRequest(obj: unknown): obj is CreateJobRequest {
  if (!obj || typeof obj !== 'object') {
    return false;
  }

  const req = obj as Record<string, unknown>;
  return (
    (req.agentId === undefined || typeof req.agentId === 'string') &&
    (req.userId === undefined || typeof req.userId === 'string') &&
    typeof req.prompt === 'string' &&
    req.prompt.length > 0
  );
}

/**
 * Extract payer address from x402 payment signature
 * The X-PAYMENT header contains base64-encoded JSON with payment payload
 */
function extractPayerAddressFromPayment(req: express.Request): string | null {
  const xPaymentHeader = req.headers['x-payment'] as string | undefined;
  if (!xPaymentHeader) {
    return null;
  }

  try {
    // Decode base64-encoded JSON
    const paymentPayload = JSON.parse(
      Buffer.from(xPaymentHeader, 'base64').toString('utf-8')
    );

    // Extract the payer's address from the payload
    // The structure may vary, but typically: payload.payload.from or payload.from
    const payerAddress =
      paymentPayload?.payload?.from ||
      paymentPayload?.from ||
      paymentPayload?.payload?.payer ||
      paymentPayload?.payer;

    if (typeof payerAddress === 'string' && payerAddress.startsWith('0x')) {
      return payerAddress.toLowerCase();
    }
  } catch (error) {
    logger.debug(
      '[Jobs API] Failed to extract payer address from payment signature:',
      error instanceof Error ? error.message : String(error)
    );
  }

  return null;
}

/**
 * Extended Router interface with cleanup method
 */
export interface JobsRouter extends express.Router {
  cleanup: () => void;
}

/**
 * Creates the jobs router for one-off messaging with x402 payment support
 * 
 * This endpoint requires x402 payment ($0.02 per request) on Base or Polygon networks.
 * Payment is handled via Coinbase facilitator, which verifies and settles payments automatically.
 * 
 * Capabilities:
 * - Research: Query and analyze research data, papers, and academic resources
 * - News: Fetch and summarize current news articles from various sources
 * - Information Processing: Process and synthesize information from multiple sources
 * - Data Analysis: Analyze trends, patterns, and insights from provided data
 * 
 * Note: This endpoint does not support swap operations or direct EVM transaction capabilities.
 * Focus is on research, news, and information processing tasks.
 */
export function createJobsRouter(
  elizaOS: ElizaOS,
  serverInstance: AgentServer
): JobsRouter {
  const router = express.Router() as JobsRouter;

  // Start cleanup interval when router is created
  startCleanupInterval();

  // Cleanup function for the router
  router.cleanup = () => {
    stopCleanupInterval();
    jobs.clear();
    logger.info('[Jobs API] Router cleanup completed');
  };

  // Setup x402 payment middleware for jobs endpoint
  // Supports both Base and Polygon networks
  let receivingWallet: string;
  try {
    receivingWallet = process.env.X402_RECEIVING_WALLET || '';
    if (!receivingWallet) {
      logger.warn(
        '[Jobs API] X402_RECEIVING_WALLET not set. x402 payment support will not be available. ' +
        'Set X402_RECEIVING_WALLET to enable payment processing.'
      );
    } else {
      // Apply x402 payment middleware to POST /jobs endpoint
      // Price: $0.02 per request
      // Networks: Base and Polygon (Coinbase facilitator handles both)
      router.use(
        paymentMiddleware(receivingWallet as `0x${string}`, {
          'POST /jobs': {
            price: '$0.02',
            network: 'base', // Primary network, facilitator handles multi-network
            config: {
              description:
                'Access AI-powered research and news processing capabilities. ' +
                'Submit queries for research analysis, news summarization, and information processing. ' +
                'Agents can perform deep research, fetch current news, analyze trends, and synthesize information from multiple sources. ' +
                'Each request costs $0.02 and supports payments on Base and Polygon networks via Coinbase facilitator.',
              inputSchema: {
                bodyFields: {
                  userId: {
                    type: 'string',
                    description:
                      'Optional user identifier (UUID). If not provided, will be derived deterministically from the payment signature.',
                  },
                  prompt: {
                    type: 'string',
                    description:
                      'Query or prompt for research, news, or information processing',
                    required: true,
                  },
                  agentId: {
                    type: 'string',
                    description: 'Optional agent identifier (UUID). Uses first available agent if not provided.',
                  },
                  timeoutMs: {
                    type: 'number',
                    description: 'Optional timeout in milliseconds (default: 30000ms, max: 300000ms)',
                  },
                  metadata: {
                    type: 'object',
                    description: 'Optional metadata to attach to the job',
                  },
                },
              },
              outputSchema: {
                jobId: {
                  type: 'string',
                  description: 'Unique job identifier',
                },
                status: {
                  type: 'string',
                  enum: ['pending', 'processing', 'completed', 'failed', 'timeout'],
                  description: 'Current job status',
                },
                createdAt: {
                  type: 'number',
                  description: 'Timestamp when job was created',
                },
                expiresAt: {
                  type: 'number',
                  description: 'Timestamp when job will expire',
                },
              },
            },
          },
        })
      );
      logger.info(
        `[Jobs API] x402 payment middleware enabled. Receiving wallet: ${receivingWallet.substring(0, 10)}...`
      );
    }
  } catch (error) {
    logger.error(
      '[Jobs API] Failed to setup x402 payment middleware:',
      error instanceof Error ? error.message : String(error)
    );
    // Continue without payment middleware if setup fails
  }

  /**
   * Create a new job (one-off message to agent)
   * POST /api/messaging/jobs
   * Requires x402 payment ($0.02) - no JWT authentication
   */
  router.post(
    '/jobs',
    async (req: express.Request, res: express.Response) => {
      try {
        const body = req.body;

        // Validate request
        if (!isValidCreateJobRequest(body)) {
          return res.status(400).json({
            success: false,
            error: 'Invalid request. Required fields: prompt',
          });
        }

        // Determine userId: either from request body or derive from payment signature
        let userId: UUID;
        
        if (body.userId) {
          // Validate provided userId
          const validatedUserId = validateUuid(body.userId);
          if (!validatedUserId) {
            return res.status(400).json({
              success: false,
              error: 'Invalid userId format (must be valid UUID)',
            });
          }
          userId = validatedUserId;
        } else {
          // Derive userId from payment signature
          const payerAddress = extractPayerAddressFromPayment(req);
          if (!payerAddress) {
            return res.status(400).json({
              success: false,
              error:
                'userId is required when payment signature is not available. ' +
                'Either provide userId in request body or ensure X-PAYMENT header is present.',
            });
          }
          
          // Generate deterministic UUID from payer address
          userId = stringToUuid(payerAddress);
          logger.info(
            `[Jobs API] Derived userId ${userId} from payment signature (payer: ${payerAddress.substring(0, 10)}...)`
          );
        }

        // Determine agent ID - use provided or first available agent
        let agentId: UUID | null = null;
        
        if (body.agentId) {
          // Validate provided agentId
          agentId = validateUuid(body.agentId);
          if (!agentId) {
            return res.status(400).json({
              success: false,
              error: 'Invalid agentId format (must be valid UUID)',
            });
          }
        } else {
          // Get first available agent
          const agents = elizaOS.getAgents();
          if (agents && agents.length > 0) {
            agentId = agents[0].agentId;
            logger.info(
              `[Jobs API] No agentId provided, using first available agent: ${agentId}`
            );
          } else {
            return res.status(404).json({
              success: false,
              error: 'No agents available on server',
            });
          }
        }

        // Check if agent exists
        const runtime = elizaOS.getAgent(agentId);
        if (!runtime) {
          return res.status(404).json({
            success: false,
            error: `Agent ${agentId} not found`,
          });
        }

        // Calculate timeout
        const timeoutMs = Math.min(
          body.timeoutMs || DEFAULT_JOB_TIMEOUT_MS,
          MAX_JOB_TIMEOUT_MS
        );

        // Create job ID and channel ID
        const jobId = uuidv4();
        const channelId = uuidv4() as UUID;
        const now = Date.now();

        // Create the job
        const job: Job = {
          id: jobId,
          agentId,
          userId,
          channelId,
          prompt: body.prompt,
          status: JobStatus.PENDING,
          createdAt: now,
          expiresAt: now + timeoutMs,
          metadata: body.metadata || {},
        };

        // Store job
        jobs.set(jobId, job);

        logger.info(
          `[Jobs API] Created job ${jobId} for agent ${agentId} (timeout: ${timeoutMs}ms)`
        );

        // Create a temporary channel for this job
        try {
          await serverInstance.createChannel({
            id: channelId,
            name: `job-${jobId}`,
            type: ChannelType.DM,
            messageServerId: DEFAULT_SERVER_ID,
            metadata: {
              jobId,
              agentId,
              userId,
              isJobChannel: true,
              ...body.metadata,
            },
          });

          // Add agent as participant
          await serverInstance.addParticipantsToChannel(channelId, [agentId]);

          logger.info(`[Jobs API] Created temporary channel ${channelId} for job ${jobId}`);
        } catch (error) {
          jobs.delete(jobId);
          logger.error(
            `[Jobs API] Failed to create channel for job ${jobId}:`,
            error instanceof Error ? error.message : String(error)
          );
          return res.status(500).json({
            success: false,
            error: 'Failed to create job channel',
          });
        }

        // Update job status to processing
        job.status = JobStatus.PROCESSING;

        // Create and send the user message
        try {
          const userMessage = await serverInstance.createMessage({
            channelId,
            authorId: userId,
            content: body.prompt,
            rawMessage: {
              content: body.prompt,
            },
            sourceType: 'job_request',
            metadata: {
              jobId,
              isJobMessage: true,
              ...body.metadata,
            },
          });

          job.userMessageId = userMessage.id;

          logger.info(
            `[Jobs API] Created user message ${userMessage.id} for job ${jobId}, emitting to bus`
          );

          // Emit to internal message bus for agent processing
          internalMessageBus.emit('new_message', {
            id: userMessage.id,
            channel_id: channelId,
            server_id: DEFAULT_SERVER_ID,
            author_id: userId,
            content: body.prompt,
            created_at: new Date(userMessage.createdAt).getTime(),
            source_type: 'job_request',
            raw_message: { content: body.prompt },
            metadata: {
              jobId,
              isJobMessage: true,
              ...body.metadata,
            },
          });

          // Setup listener for agent response
          // Track if we've seen an action execution message
          let actionMessageReceived = false;
          
          const responseHandler = async (data: unknown) => {
            // Type guard for message structure
            if (!data || typeof data !== 'object') return;
            
            const message = data as {
              id?: UUID;
              channel_id?: UUID;
              author_id?: UUID;
              content?: string;
              created_at?: number;
              metadata?: Record<string, unknown>;
            };

            // Validate required fields
            if (
              !message.id ||
              !message.channel_id ||
              !message.author_id ||
              !message.content ||
              !message.created_at
            ) {
              return;
            }

            // Check if this message is the agent's response to our job
            if (
              message.channel_id === channelId &&
              message.author_id === agentId &&
              message.id !== userMessage.id
            ) {
              const currentJob = jobs.get(jobId);
              if (!currentJob || currentJob.status !== JobStatus.PROCESSING) {
                return;
              }

              // Check if this is an "Executing action" intermediate message
              const isActionMessage = 
                message.content.startsWith('Executing action:') ||
                message.content.includes('Executing action:');

              if (isActionMessage) {
                // This is an intermediate action message, keep waiting for the actual result
                actionMessageReceived = true;
                logger.info(
                  `[Jobs API] Job ${jobId} received action message, waiting for final result...`
                );
                return; // Don't mark as completed yet
              }

              // If we previously received an action message, this should be the actual result
              // OR if this is a direct response (no action), accept it
              if (actionMessageReceived || !isActionMessage) {
                currentJob.status = JobStatus.COMPLETED;
                currentJob.agentResponseId = message.id;
                currentJob.result = {
                  message: {
                    id: message.id,
                    content: message.content,
                    authorId: message.author_id,
                    createdAt: message.created_at,
                    metadata: message.metadata,
                  },
                  processingTimeMs: Date.now() - currentJob.createdAt,
                };

                logger.info(
                  `[Jobs API] Job ${jobId} completed with ${actionMessageReceived ? 'action result' : 'direct response'} ${message.id} (${currentJob.result.processingTimeMs}ms)`
                );

                // Remove listener after receiving final response
                internalMessageBus.off('new_message', responseHandler);
              }
            }
          };

          // Listen for agent response
          internalMessageBus.on('new_message', responseHandler);

          // Set timeout to cleanup listener
          setTimeout(() => {
            internalMessageBus.off('new_message', responseHandler);
          }, timeoutMs + 5000); // Extra 5s buffer
        } catch (error) {
          job.status = JobStatus.FAILED;
          job.error = 'Failed to create user message';
          logger.error(
            `[Jobs API] Failed to create message for job ${jobId}:`,
            error instanceof Error ? error.message : String(error)
          );
        }

        const response: CreateJobResponse = {
          jobId,
          status: job.status,
          createdAt: job.createdAt,
          expiresAt: job.expiresAt,
        };

        res.status(201).json(response);
      } catch (error) {
        logger.error(
          '[Jobs API] Error creating job:',
          error instanceof Error ? error.message : String(error)
        );
        res.status(500).json({
          success: false,
          error: 'Failed to create job',
        });
      }
    }
  );

  /**
   * Get job details and status
   * GET /api/messaging/jobs/:jobId
   */
  router.get('/jobs/:jobId', async (req: express.Request, res: express.Response) => {
    try {
      const { jobId } = req.params;

      const job = jobs.get(jobId);
      if (!job) {
        return res.status(404).json({
          success: false,
          error: 'Job not found',
        });
      }

      // Check if job has timed out
      if (job.expiresAt < Date.now() && job.status === JobStatus.PROCESSING) {
        job.status = JobStatus.TIMEOUT;
        job.error = 'Job timed out waiting for agent response';
      }

      const response = jobToResponse(job);
      res.json(response);
    } catch (error) {
      logger.error(
        '[Jobs API] Error getting job:',
        error instanceof Error ? error.message : String(error)
      );
      res.status(500).json({
        success: false,
        error: 'Failed to get job details',
      });
    }
  });

  /**
   * List all jobs (for debugging/admin)
   * GET /api/messaging/jobs
   * Note: No authentication required - public endpoint for job status checking
   */
  router.get(
    '/jobs',
    async (req: express.Request, res: express.Response) => {
      try {
        const limit = parseInt(req.query.limit as string) || 50;
        const status = req.query.status as JobStatus | undefined;

        let jobList = Array.from(jobs.values());

        // Filter by status if provided
        if (status && Object.values(JobStatus).includes(status)) {
          jobList = jobList.filter((job) => job.status === status);
        }

        // Sort by creation date (newest first)
        jobList.sort((a, b) => b.createdAt - a.createdAt);

        // Limit results
        jobList = jobList.slice(0, limit);

        const response = {
          jobs: jobList.map(jobToResponse),
          total: jobs.size,
          filtered: jobList.length,
        };

        res.json(response);
      } catch (error) {
        logger.error(
          '[Jobs API] Error listing jobs:',
          error instanceof Error ? error.message : String(error)
        );
        res.status(500).json({
          success: false,
          error: 'Failed to list jobs',
        });
      }
    }
  );

  /**
   * Health check endpoint
   * GET /api/messaging/jobs/health
   */
  router.get('/jobs/health', (_req: express.Request, res: express.Response) => {
    const now = Date.now();
    const statusCounts = {
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      timeout: 0,
    };

    for (const job of jobs.values()) {
      statusCounts[job.status]++;
    }

    res.json({
      healthy: true,
      timestamp: now,
      totalJobs: jobs.size,
      statusCounts,
      maxJobs: MAX_JOBS_IN_MEMORY,
    });
  });

  return router;
}

