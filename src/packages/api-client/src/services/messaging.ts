import { UUID, ChannelType } from '@elizaos/core';
import { BaseApiClient } from '../lib/base-client';
import {
  Message,
  MessageServer,
  MessageChannel,
  MessageSubmitParams,
  MessageCompleteParams,
  ExternalMessageParams,
  ChannelCreateParams,
  GroupChannelCreateParams,
  DmChannelParams,
  ChannelParticipant,
  MessageSearchParams,
  ServerCreateParams,
  ServerSyncParams,
  ChannelUpdateParams,
  ChannelMetadata,
  MessageMetadata,
} from '../types/messaging';
import { PaginationParams } from '../types/base';
import {
  CreateJobRequest,
  CreateJobResponse,
  JobDetailsResponse,
  JobListResponse,
  ListJobsParams,
  JobHealthResponse,
  JobStatus,
} from '../types/jobs';

// Internal payload interfaces for API requests
interface ChannelCreatePayload {
  name: string;
  type: ChannelType;
  server_id: UUID;
  metadata?: ChannelMetadata;
}

interface GroupChannelCreatePayload {
  name: string;
  server_id: UUID;
  participantCentralUserIds: UUID[];
  type?: ChannelType;
  metadata?: ChannelMetadata;
}

interface DmChannelQuery {
  currentUserId: UUID;
  targetUserId: UUID;
  dmServerId: UUID;
}

export class MessagingService extends BaseApiClient {
  /**
   * Submit agent replies or system messages
   */
  async submitMessage(params: MessageSubmitParams): Promise<Message> {
    return this.post<Message>('/api/messaging/submit', params);
  }

  /**
   * Notify message completion
   */
  async completeMessage(params: MessageCompleteParams): Promise<{ success: boolean }> {
    return this.post<{ success: boolean }>('/api/messaging/complete', params);
  }

  /**
   * Ingest messages from external platforms
   */
  async ingestExternalMessages(params: ExternalMessageParams): Promise<{ processed: number }> {
    return this.post<{ processed: number }>('/api/messaging/ingest-external', params);
  }

  /**
   * Create a new channel
   */
  async createChannel(params: ChannelCreateParams): Promise<MessageChannel> {
    // Server expects: { name, type, server_id, metadata }
    const payload: ChannelCreatePayload = {
      name: params.name,
      type: params.type,
      server_id: params.serverId || ('00000000-0000-0000-0000-000000000000' as UUID),
      metadata: params.metadata,
    };
    return this.post<MessageChannel>('/api/messaging/central-channels', payload);
  }

  /**
   * Create a group channel
   */
  async createGroupChannel(params: GroupChannelCreateParams): Promise<MessageChannel> {
    // Server expects: { name, server_id, participantCentralUserIds, type?, metadata? }
    // The client currently provides participantIds and may include server_id/type in metadata.
    const DEFAULT_SERVER_ID = '00000000-0000-0000-0000-000000000000' as UUID;

    // Extract and clean metadata - handle legacy fields that might be in metadata
    let cleanedMetadata: ChannelMetadata | undefined;
    let serverIdFromMeta: UUID | undefined;
    let typeFromMeta: ChannelType | undefined;

    if (params.metadata) {
      // Create a new metadata object without the hoisted fields
      const metadataCopy: ChannelMetadata = { ...params.metadata };

      // Extract hoisted fields safely using bracket notation (ChannelMetadata allows [key: string]: unknown)
      if ('server_id' in metadataCopy) {
        serverIdFromMeta = metadataCopy['server_id'] as UUID | undefined;
        delete metadataCopy['server_id'];
      }

      if ('type' in metadataCopy) {
        typeFromMeta = metadataCopy['type'] as ChannelType | undefined;
        delete metadataCopy['type'];
      }

      // Only include metadata if there are remaining properties
      if (Object.keys(metadataCopy).length > 0) {
        cleanedMetadata = metadataCopy;
      }
    }

    const payload: GroupChannelCreatePayload = {
      name: params.name,
      server_id: serverIdFromMeta || DEFAULT_SERVER_ID,
      participantCentralUserIds: params.participantIds,
      // If caller intended DM, allow type override
      ...(typeFromMeta ? { type: typeFromMeta } : {}),
      ...(cleanedMetadata ? { metadata: cleanedMetadata } : {}),
    };

    return this.post<MessageChannel>('/api/messaging/central-channels', payload);
  }

  /**
   * Find or create a DM channel
   */
  async getOrCreateDmChannel(params: DmChannelParams): Promise<MessageChannel> {
    // Map participantIds -> { currentUserId, targetUserId }
    const [userA, userB] = params.participantIds;
    // Arbitrarily treat the first as current and second as target; callers pass [current, target]
    const query: DmChannelQuery = {
      currentUserId: userA,
      targetUserId: userB,
      dmServerId: '00000000-0000-0000-0000-000000000000' as UUID,
    };
    return this.get<MessageChannel>('/api/messaging/dm-channel', { params: query });
  }

  /**
   * Get channel details
   */
  async getChannelDetails(channelId: UUID): Promise<MessageChannel> {
    return this.get<MessageChannel>(`/api/messaging/central-channels/${channelId}/details`);
  }

  /**
   * Get channel participants
   */
  async getChannelParticipants(channelId: UUID): Promise<{ participants: ChannelParticipant[] }> {
    return this.get<{ participants: ChannelParticipant[] }>(
      `/api/messaging/central-channels/${channelId}/participants`
    );
  }

  /**
   * Add agent to channel
   */
  async addAgentToChannel(channelId: UUID, agentId: UUID): Promise<{ success: boolean }> {
    return this.post<{ success: boolean }>(`/api/messaging/central-channels/${channelId}/agents`, {
      agentId,
    });
  }

  /**
   * Remove agent from channel
   */
  async removeAgentFromChannel(channelId: UUID, agentId: UUID): Promise<{ success: boolean }> {
    return this.delete<{ success: boolean }>(
      `/api/messaging/central-channels/${channelId}/agents/${agentId}`
    );
  }

  /**
   * Delete a channel
   */
  async deleteChannel(channelId: UUID): Promise<{ success: boolean }> {
    return this.delete<{ success: boolean }>(`/api/messaging/central-channels/${channelId}`);
  }

  /**
   * Clear channel history
   */
  async clearChannelHistory(channelId: UUID): Promise<{ deleted: number }> {
    return this.delete<{ deleted: number }>(
      `/api/messaging/central-channels/${channelId}/messages`
    );
  }

  /**
   * Add agent to server (associates agent with a server so it can receive messages)
   */
  async addAgentToServer(serverId: UUID, agentId: UUID): Promise<{ success: boolean }> {
    return this.post<{ success: boolean }>(`/api/messaging/servers/${serverId}/agents`, {
      agentId,
    });
  }

  /**
   * Remove agent from server
   */
  async removeAgentFromServer(serverId: UUID, agentId: UUID): Promise<{ success: boolean }> {
    return this.delete<{ success: boolean }>(
      `/api/messaging/servers/${serverId}/agents/${agentId}`
    );
  }

  /**
   * Post a new message to a channel
   */
  async postMessage(
    channelId: UUID,
    content: string,
    metadata?: MessageMetadata
  ): Promise<Message> {
    return this.post<Message>(`/api/messaging/central-channels/${channelId}/messages`, {
      content,
      metadata,
    });
  }

  /**
   * Get channel messages
   */
  async getChannelMessages(
    channelId: UUID,
    params?: PaginationParams & { before?: Date | string; after?: Date | string }
  ): Promise<{ messages: Message[] }> {
    return this.get<{ messages: Message[] }>(
      `/api/messaging/central-channels/${channelId}/messages`,
      { params }
    );
  }

  /**
   * Get a specific message
   */
  async getMessage(messageId: UUID): Promise<Message> {
    return this.get<Message>(`/api/messaging/messages/${messageId}`);
  }

  /**
   * Delete a message from a channel
   */
  async deleteMessage(channelId: UUID, messageId: UUID): Promise<{ success: boolean }> {
    return this.delete<{ success: boolean }>(
      `/api/messaging/central-channels/${channelId}/messages/${messageId}`
    );
  }

  /**
   * Update a message
   */
  async updateMessage(messageId: UUID, content: string): Promise<Message> {
    return this.patch<Message>(`/api/messaging/messages/${messageId}`, { content });
  }

  /**
   * Search messages
   */
  async searchMessages(params: MessageSearchParams): Promise<{ messages: Message[] }> {
    return this.post<{ messages: Message[] }>('/api/messaging/messages/search', params);
  }

  /**
   * List all message servers
   */
  async listServers(): Promise<{ servers: MessageServer[] }> {
    return this.get<{ servers: MessageServer[] }>('/api/messaging/central-servers');
  }

  /**
   * Get server channels
   */
  async getServerChannels(serverId: UUID): Promise<{ channels: MessageChannel[] }> {
    return this.get<{ channels: MessageChannel[] }>(
      `/api/messaging/central-servers/${serverId}/channels`
    );
  }

  /**
   * Create a new server
   */
  async createServer(params: ServerCreateParams): Promise<MessageServer> {
    return this.post<MessageServer>('/api/messaging/servers', params);
  }

  /**
   * Sync server channels
   */
  async syncServerChannels(serverId: UUID, params: ServerSyncParams): Promise<{ synced: number }> {
    return this.post<{ synced: number }>(
      `/api/messaging/servers/${serverId}/sync-channels`,
      params
    );
  }

  /**
   * Delete a server
   */
  async deleteServer(serverId: UUID): Promise<{ success: boolean }> {
    return this.delete<{ success: boolean }>(`/api/messaging/servers/${serverId}`);
  }

  /**
   * Update a channel
   */
  async updateChannel(
    channelId: UUID,
    params: ChannelUpdateParams
  ): Promise<{ success: boolean; data: MessageChannel }> {
    return this.patch<{ success: boolean; data: MessageChannel }>(
      `/api/messaging/central-channels/${channelId}`,
      params
    );
  }

  /**
   * Generate channel title from a user message
   */
  async generateChannelTitle(userMessage: string, agentId: UUID): Promise<{ title: string }> {
    return this.post<{ title: string }>(
      `/api/messaging/generate-title`,
      { userMessage, agentId }
    );
  }

  /**
   * Generate dynamic quick start prompts for a channel based on conversation context
   */
  async generateChannelPrompts(
    channelId: UUID,
    agentId: UUID,
    count: number = 4
  ): Promise<{ prompts: string[] }> {
    return this.post<{ prompts: string[] }>(
      `/api/messaging/central-channels/${channelId}/generate-prompts`,
      { agentId, count }
    );
  }

  /**
   * Add user to channel participants (implemented via updateChannel)
   */
  async addUserToChannel(
    channelId: UUID,
    userId: UUID
  ): Promise<{ success: boolean; data: MessageChannel }> {
    // First get current participants
    const channel = await this.getChannelDetails(channelId);
    const currentParticipants: UUID[] = channel.metadata?.participantCentralUserIds || [];

    // Add new user if not already present
    if (!currentParticipants.includes(userId)) {
      const updatedParticipants: UUID[] = [...currentParticipants, userId];
      return this.updateChannel(channelId, {
        participantCentralUserIds: updatedParticipants,
      });
    }

    return { success: true, data: channel };
  }

  /**
   * Add multiple users to channel participants (implemented via updateChannel)
   */
  async addUsersToChannel(
    channelId: UUID,
    userIds: UUID[]
  ): Promise<{ success: boolean; data: MessageChannel }> {
    // First get current participants
    const channel = await this.getChannelDetails(channelId);
    const currentParticipants: UUID[] = channel.metadata?.participantCentralUserIds || [];

    // Add new users that aren't already present
    const newParticipants: UUID[] = [...currentParticipants];
    for (const userId of userIds) {
      if (!newParticipants.includes(userId)) {
        newParticipants.push(userId);
      }
    }

    return this.updateChannel(channelId, {
      participantCentralUserIds: newParticipants,
    });
  }

  /**
   * Remove user from channel participants (implemented via updateChannel)
   */
  async removeUserFromChannel(
    channelId: UUID,
    userId: UUID
  ): Promise<{ success: boolean; data: MessageChannel }> {
    // First get current participants
    const channel = await this.getChannelDetails(channelId);
    const currentParticipants: UUID[] = channel.metadata?.participantCentralUserIds || [];

    // Remove user from participants
    const updatedParticipants: UUID[] = currentParticipants.filter((id) => id !== userId);

    return this.updateChannel(channelId, {
      participantCentralUserIds: updatedParticipants,
    });
  }

  // =============================================================================
  // Jobs API - One-off messaging
  // =============================================================================

  /**
   * Create a new job (one-off message to agent)
   * 
   * This creates a temporary channel and sends a message to the agent.
   * The job tracks the request and response, with automatic cleanup.
   * 
   * @param params - Job creation parameters
   * @returns Job details including jobId and status
   * 
   * @example
   * ```typescript
   * const job = await client.messaging.createJob({
   *   agentId: 'agent-uuid', // optional - uses first agent if not provided
   *   userId: 'user-uuid',
   *   content: 'What is the weather?',
   *   timeoutMs: 30000,
   *   metadata: { source: 'api' }
   * });
   * console.log(job.jobId);
   * ```
   */
  async createJob(params: CreateJobRequest): Promise<CreateJobResponse> {
    return this.post<CreateJobResponse>('/api/messaging/jobs', params);
  }

  /**
   * Get job details and status
   * 
   * Retrieves the current status of a job, including the result if completed.
   * 
   * @param jobId - The unique job identifier
   * @returns Job details including status and result
   * 
   * @example
   * ```typescript
   * const job = await client.messaging.getJob('job-uuid');
   * if (job.status === JobStatus.COMPLETED) {
   *   console.log(job.result?.message.content);
   * }
   * ```
   */
  async getJob(jobId: string): Promise<JobDetailsResponse> {
    return this.get<JobDetailsResponse>(`/api/messaging/jobs/${jobId}`);
  }

  /**
   * List all jobs with optional filtering
   * 
   * @param params - List parameters (limit and status filter)
   * @returns List of jobs with total counts
   * 
   * @example
   * ```typescript
   * const { jobs, total } = await client.messaging.listJobs({
   *   limit: 10,
   *   status: JobStatus.COMPLETED
   * });
   * ```
   */
  async listJobs(params?: ListJobsParams): Promise<JobListResponse> {
    return this.get<JobListResponse>('/api/messaging/jobs', { params });
  }

  /**
   * Get jobs service health status
   * 
   * @returns Health information including job counts by status
   * 
   * @example
   * ```typescript
   * const health = await client.messaging.getJobsHealth();
   * console.log(`Total jobs: ${health.totalJobs}`);
   * console.log(`Completed: ${health.statusCounts.completed}`);
   * ```
   */
  async getJobsHealth(): Promise<JobHealthResponse> {
    return this.get<JobHealthResponse>('/api/messaging/jobs/health');
  }

  /**
   * Poll a job until it completes or times out
   * 
   * Continuously polls the job status until it reaches a terminal state
   * (COMPLETED, FAILED, or TIMEOUT).
   * 
   * @param jobId - The job ID to poll
   * @param interval - Polling interval in milliseconds (default: 1000)
   * @param maxAttempts - Maximum number of poll attempts (default: 30)
   * @returns Final job details
   * @throws Error if job fails, times out, or max attempts reached
   * 
   * @example
   * ```typescript
   * try {
   *   const job = await client.messaging.createJob({
   *     userId: 'user-uuid',
   *     content: 'What is 2+2?'
   *   });
   *   
   *   const result = await client.messaging.pollJob(job.jobId, 1000, 30);
   *   console.log(result.result?.message.content);
   * } catch (error) {
   *   console.error('Job failed:', error);
   * }
   * ```
   */
  async pollJob(
    jobId: string,
    interval: number = 1000,
    maxAttempts: number = 30
  ): Promise<JobDetailsResponse> {
    let attempts = 0;

    while (attempts < maxAttempts) {
      const job = await this.getJob(jobId);

      // Check if job reached a terminal state
      if (job.status === JobStatus.COMPLETED) {
        return job;
      }

      if (job.status === JobStatus.FAILED) {
        throw new Error(`Job failed: ${job.error || 'Unknown error'}`);
      }

      if (job.status === JobStatus.TIMEOUT) {
        throw new Error('Job timed out waiting for agent response');
      }

      // Wait before next poll
      await new Promise((resolve) => setTimeout(resolve, interval));
      attempts++;
    }

    throw new Error(`Polling exceeded maximum attempts (${maxAttempts})`);
  }

  /**
   * Create a job and wait for the result
   * 
   * Convenience method that creates a job and polls until completion.
   * 
   * @param params - Job creation parameters
   * @param pollInterval - Polling interval in milliseconds (default: 1000)
   * @param maxAttempts - Maximum number of poll attempts (default: 30)
   * @returns Final job details with result
   * @throws Error if job fails, times out, or max attempts reached
   * 
   * @example
   * ```typescript
   * const result = await client.messaging.createAndWaitForJob({
   *   userId: 'user-uuid',
   *   content: 'Explain quantum computing'
   * });
   * console.log(result.result?.message.content);
   * ```
   */
  async createAndWaitForJob(
    params: CreateJobRequest,
    pollInterval: number = 1000,
    maxAttempts: number = 30
  ): Promise<JobDetailsResponse> {
    const job = await this.createJob(params);
    return this.pollJob(job.jobId, pollInterval, maxAttempts);
  }
}
