/**
 * OtakuMessageService - Custom message service for Otaku
 *
 * Extends the default ElizaOS message service with:
 * - x402 job request bypass (paid API jobs bypass race tracking)
 * - Multi-step workflow execution with custom templates
 * - Custom race tracking logic
 * - Rich logging and telemetry
 */

import { v4 } from 'uuid';
import {
  type IAgentRuntime,
  type Memory,
  type Content,
  type UUID,
  type State,
  type HandlerCallback,
  type IMessageService,
  type MessageProcessingOptions,
  type MessageProcessingResult,
  type ResponseDecision,
  type Room,
  type MentionContext,
  type Media,
  type Action,
  ChannelType,
  EventType,
  ModelType,
  asUUID,
  createUniqueUuid,
  composePromptFromState,
  parseKeyValueXml,
  parseBooleanFromText,
  truncateToCompleteSentence,
  logger,
} from '@elizaos/core';

import { multiStepDecisionTemplate, multiStepSummaryTemplate } from '../templates/index.js';
import { refreshStateAfterAction } from '../utils/index.js';

/**
 * Template for LLM-based shouldRespond evaluation
 * Used when rules-based shouldRespond returns skipEvaluation: false
 */
const shouldRespondTemplate = `<task>Decide on behalf of {{agentName}} whether they should respond to the message, ignore it or stop the conversation.</task>

<providers>
{{providers}}
</providers>

<instructions>Decide if {{agentName}} should respond to or interact with the conversation.

IMPORTANT RULES FOR RESPONDING:
- If YOUR name ({{agentName}}) is directly mentioned → RESPOND
- If someone uses a DIFFERENT name (not {{agentName}}) → IGNORE (they're talking to someone else)
- If you're actively participating in a conversation and the message continues that thread → RESPOND
- If someone tells you to stop or be quiet → STOP
- Otherwise → IGNORE

The key distinction is:
- "Talking TO {{agentName}}" (your name mentioned, replies to you, continuing your conversation) → RESPOND
- "Talking ABOUT {{agentName}}" or to someone else → IGNORE
</instructions>

<output>
Do NOT include any thinking, reasoning, or <think> sections in your response.
Go directly to the XML response format without any preamble or explanation.

Respond using XML format like this:
<response>
  <name>{{agentName}}</name>
  <reasoning>Your reasoning here</reasoning>
  <action>RESPOND | IGNORE | STOP</action>
</response>

IMPORTANT: Your response must ONLY contain the <response></response> XML block above. Do not include any text, thinking, or reasoning before or after this XML block. Start your response immediately with <response> and end with </response>.
</output>`;

/**
 * Template for single-shot message handling (non-multi-step mode)
 */
const singleShotTemplate = `<task>Generate dialog and actions for the character {{agentName}}.</task>

<providers>
{{providers}}
</providers>

<instructions>
Write a thought and plan for {{agentName}} and decide what actions to take. Also include the providers that {{agentName}} will use to have the right context for responding and acting, if any.

Available actions: {{actionNames}}
</instructions>

<output>
Respond using XML format like this:
<response>
  <thought>Your reasoning here</thought>
  <actions>ACTION1,ACTION2</actions>
  <providers>PROVIDER1,PROVIDER2</providers>
  <text>Your response text here</text>
</response>
</output>`;

/**
 * Multi-step workflow execution result
 */
interface MultiStepActionResult {
  data: { actionName: string };
  success: boolean;
  text?: string;
  error?: string | Error;
  values?: Record<string, unknown>;
}

/**
 * Strategy mode for response generation
 */
type StrategyMode = 'simple' | 'actions' | 'none';

/**
 * Strategy result from core processing
 */
interface StrategyResult {
  responseContent: Content | null;
  responseMessages: Memory[];
  state: State;
  mode: StrategyMode;
}

/**
 * Tracks the latest response ID per agent+room to handle message superseding
 */
const latestResponseIds = new Map<string, Map<string, string>>();

/**
 * Default retry configuration
 */
const RETRY_CONFIG = {
  baseDelayMs: 1000,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
};

/**
 * Calculate exponential backoff delay
 */
function getRetryDelay(attempt: number): number {
  const delay = RETRY_CONFIG.baseDelayMs * Math.pow(RETRY_CONFIG.backoffMultiplier, attempt - 1);
  return Math.min(delay, RETRY_CONFIG.maxDelayMs);
}

/**
 * Safely access the runtime's stateCache for action results
 * This is an internal ElizaOS API that may change - use with caution
 */
function getActionResultsFromCache(
  runtime: IAgentRuntime,
  messageId: string
): unknown[] {
  try {
    // Access stateCache through the runtime - this is an internal API
    const runtimeWithCache = runtime as unknown as { 
      stateCache?: Map<string, { values?: { actionResults?: unknown[] } }> 
    };
    
    if (!runtimeWithCache.stateCache) {
      logger.debug('[OtakuMessageService] stateCache not available on runtime');
      return [];
    }
    
    const cachedState = runtimeWithCache.stateCache.get(`${messageId}_action_results`);
    return cachedState?.values?.actionResults || [];
  } catch (error) {
    logger.warn(
      { error },
      '[OtakuMessageService] Failed to access stateCache - this may indicate an ElizaOS version incompatibility'
    );
    return [];
  }
}

/**
 * Clean up race tracking entry for an agent/room
 */
function cleanupRaceTracking(agentId: string, roomId: string): void {
  const agentResponses = latestResponseIds.get(agentId);
  if (agentResponses) {
    agentResponses.delete(roomId);
    if (agentResponses.size === 0) {
      latestResponseIds.delete(agentId);
    }
  }
}

/**
 * OtakuMessageService implements the IMessageService interface with custom
 * multi-step workflow execution and x402 job request handling.
 */
export class OtakuMessageService implements IMessageService {
  /**
   * Main message handling entry point
   */
  async handleMessage(
    runtime: IAgentRuntime,
    message: Memory,
    callback?: HandlerCallback,
    options?: MessageProcessingOptions
  ): Promise<MessageProcessingResult> {
    const timeoutDuration = options?.timeoutDuration ?? 60 * 60 * 1000; // 1 hour
    let timeoutId: NodeJS.Timeout | undefined = undefined;

    try {
      runtime.logger.info(
        `[OtakuMessageService] Message received from ${message.entityId} in room ${message.roomId}`
      );

      // Generate a new response ID
      const responseId = v4();

      // Check if this is a job request (x402 paid API)
      // Job requests are isolated one-off operations that don't need race tracking
      const isJobRequest =
        (message.content.metadata as Record<string, unknown>)?.isJobMessage === true;

      // Get or create the agent-specific map
      if (!latestResponseIds.has(runtime.agentId)) {
        latestResponseIds.set(runtime.agentId, new Map<string, string>());
      }
      const agentResponses = latestResponseIds.get(runtime.agentId);
      if (!agentResponses) throw new Error('Agent responses map not found');

      // Only track response IDs for non-job messages
      // Job requests bypass race tracking since they're isolated operations
      if (!isJobRequest) {
        const previousResponseId = agentResponses.get(message.roomId);
        if (previousResponseId) {
          logger.warn(
            `[OtakuMessageService] Updating response ID for room ${message.roomId} from ${previousResponseId} to ${responseId}`
          );
        }
        agentResponses.set(message.roomId, responseId);
      } else {
        runtime.logger.info(
          `[OtakuMessageService] Job request detected for room ${message.roomId} - bypassing race tracking`
        );
      }

      // Use runtime's run tracking for this message processing
      const runId = runtime.startRun(message.roomId) as UUID;
      const startTime = Date.now();

      // Emit run started event
      await runtime.emitEvent(EventType.RUN_STARTED, {
        runtime,
        runId: runId!,
        messageId: message.id!,
        roomId: message.roomId,
        entityId: message.entityId,
        startTime,
        status: 'started',
        source: 'OtakuMessageService',
      } as Parameters<typeof runtime.emitEvent>[1] & { runId: UUID; messageId: UUID; source: string });

      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(async () => {
          await runtime.emitEvent(EventType.RUN_TIMEOUT, {
            runtime,
            runId: runId!,
            messageId: message.id!,
            roomId: message.roomId,
            entityId: message.entityId,
            startTime,
            status: 'timeout',
            endTime: Date.now(),
            duration: Date.now() - startTime,
            error: 'Run exceeded timeout',
            source: 'OtakuMessageService',
          } as Parameters<typeof runtime.emitEvent>[1] & { runId: UUID; messageId: UUID; source: string });
          reject(new Error('Run exceeded timeout'));
        }, timeoutDuration);
      });

      const processingPromise = this.processMessage(
        runtime,
        message,
        callback,
        responseId,
        runId as UUID,
        startTime,
        options
      );

      const result = await Promise.race([processingPromise, timeoutPromise]);

      clearTimeout(timeoutId);
      return result;
    } catch (error) {
      // Clean up race tracking on error to prevent memory leak
      cleanupRaceTracking(runtime.agentId, message.roomId);
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Internal message processing implementation
   */
  private async processMessage(
    runtime: IAgentRuntime,
    message: Memory,
    callback: HandlerCallback | undefined,
    responseId: string,
    runId: UUID,
    startTime: number,
    options?: MessageProcessingOptions
  ): Promise<MessageProcessingResult> {
    const agentResponses = latestResponseIds.get(runtime.agentId);
    if (!agentResponses) throw new Error('Agent responses map not found');

    try {
      // Skip messages from self
      if (message.entityId === runtime.agentId) {
        runtime.logger.debug(`[OtakuMessageService] Skipping message from self`);
        await this.emitRunEnded(runtime, runId, message, startTime, 'self');
        return {
          didRespond: false,
          responseContent: null,
          responseMessages: [],
          state: { values: {}, data: {}, text: '' } as State,
          mode: 'none',
        };
      }

      runtime.logger.debug(
        `[OtakuMessageService] Processing message: ${truncateToCompleteSentence(message.content.text || '', 50)}...`
      );

      // Save the incoming message to memory
      runtime.logger.debug('[OtakuMessageService] Saving message to memory');
      let memoryToQueue: Memory;

      if (message.id) {
        const existingMemory = await runtime.getMemoryById(message.id);
        if (existingMemory) {
          runtime.logger.debug('[OtakuMessageService] Memory already exists, skipping creation');
          memoryToQueue = existingMemory;
        } else {
          const createdMemoryId = await runtime.createMemory(message, 'messages');
          memoryToQueue = { ...message, id: createdMemoryId };
        }
        await runtime.queueEmbeddingGeneration(memoryToQueue, 'high');
      } else {
        const memoryId = await runtime.createMemory(message, 'messages');
        message.id = memoryId;
        memoryToQueue = { ...message, id: memoryId };
        await runtime.queueEmbeddingGeneration(memoryToQueue, 'normal');
      }

      // Check LLM off by default setting
      const agentUserState = await runtime.getParticipantUserState(message.roomId, runtime.agentId);
      const defLllmOff = parseBooleanFromText(String(runtime.getSetting('BOOTSTRAP_DEFLLMOFF') ?? ''));

      if (defLllmOff && agentUserState === null) {
        runtime.logger.debug('[OtakuMessageService] LLM is off by default');
        await this.emitRunEnded(runtime, runId, message, startTime, 'off');
        return {
          didRespond: false,
          responseContent: null,
          responseMessages: [],
          state: { values: {}, data: {}, text: '' } as State,
          mode: 'none',
        };
      }

      // Check if room is muted
      if (
        agentUserState === 'MUTED' &&
        !message.content.text?.toLowerCase().includes(runtime.character.name.toLowerCase())
      ) {
        runtime.logger.debug(`[OtakuMessageService] Ignoring muted room ${message.roomId}`);
        await this.emitRunEnded(runtime, runId, message, startTime, 'muted');
        return {
          didRespond: false,
          responseContent: null,
          responseMessages: [],
          state: { values: {}, data: {}, text: '' } as State,
          mode: 'none',
        };
      }

      // Process attachments if any (images, documents)
      if (message.content.attachments && message.content.attachments.length > 0) {
        runtime.logger.debug(
          `[OtakuMessageService] Processing ${message.content.attachments.length} attachments`
        );
        message.content.attachments = await this.processAttachments(
          runtime,
          message.content.attachments
        );
      }

      // Get room context for shouldRespond decision
      const room = await runtime.getRoom(message.roomId);
      
      // Extract mention context from message metadata
      const metadata = message.content.metadata as Record<string, unknown> | undefined;
      const mentionContext: MentionContext | undefined = metadata
        ? {
            isMention: !!metadata.isMention,
            isReply: !!metadata.isReply,
            isThread: !!metadata.isThread,
            mentionType: metadata.mentionType as MentionContext['mentionType'],
          }
        : undefined;

      // Check if we should respond based on rules
      const respondDecision = this.shouldRespond(runtime, message, room ?? undefined, mentionContext);
      runtime.logger.debug(
        `[OtakuMessageService] shouldRespond decision: ${respondDecision.shouldRespond} (${respondDecision.reason})`
      );

      // Determine if we should respond, using LLM evaluation if needed
      let shouldRespondToMessage = true;
      
      if (respondDecision.skipEvaluation) {
        // Rules gave a definitive answer - use it directly
        runtime.logger.debug(
          `[OtakuMessageService] Skipping LLM evaluation: ${respondDecision.reason}`
        );
        shouldRespondToMessage = respondDecision.shouldRespond;
      } else {
        // Compose state for LLM evaluation
        const evalState = await runtime.composeState(
          message,
          ['RECENT_MESSAGES', 'CHARACTER', 'ENTITIES'],
          true
        );
        
        // Need LLM evaluation - compose prompt and call model
        runtime.logger.debug(
          `[OtakuMessageService] Using LLM evaluation: ${respondDecision.reason}`
        );
        
        const shouldRespondPrompt = composePromptFromState({
          state: evalState,
          template: runtime.character.templates?.shouldRespondTemplate || shouldRespondTemplate,
        });
        
        const response = await runtime.useModel(ModelType.TEXT_SMALL, {
          prompt: shouldRespondPrompt,
        });
        
        runtime.logger.debug(
          { response: String(response).substring(0, 200) },
          '[OtakuMessageService] LLM evaluation result'
        );
        
        const responseObject = parseKeyValueXml(String(response));
        const nonResponseActions = ['IGNORE', 'NONE', 'STOP'];
        const actionValue = responseObject?.action;
        
        shouldRespondToMessage = 
          typeof actionValue === 'string' && 
          !nonResponseActions.includes(actionValue.toUpperCase());
        
        runtime.logger.debug(
          `[OtakuMessageService] LLM decided: ${shouldRespondToMessage ? 'RESPOND' : 'IGNORE'} (action=${actionValue})`
        );
      }

      // Exit if we shouldn't respond
      if (!shouldRespondToMessage) {
        runtime.logger.debug(`[OtakuMessageService] Not responding based on evaluation`);
        await this.emitRunEnded(runtime, runId, message, startTime, 'shouldRespond:no');
        return {
          didRespond: false,
          responseContent: null,
          responseMessages: [],
          state: { values: {}, data: {}, text: '' } as State,
          mode: 'none',
        };
      }

      // Compose initial state
      let state = await runtime.composeState(
        message,
        ['ANXIETY', 'SHOULD_RESPOND', 'ENTITIES', 'CHARACTER', 'RECENT_MESSAGES', 'ACTIONS'],
        true
      );

      // Determine processing mode from options or settings
      const useMultiStep = options?.useMultiStep ?? 
        parseBooleanFromText(String(runtime.getSetting('USE_MULTI_STEP') ?? 'true'));
      
      // Streaming is not yet supported - log warning if requested
      // TODO: Implement streaming by passing onStreamChunk to model calls
      if (options?.onStreamChunk) {
        runtime.logger.warn(
          '[OtakuMessageService] Streaming (onStreamChunk) is not yet supported - responses will be sent in full'
        );
      }

      // Run appropriate processing strategy
      let result: StrategyResult;
      if (useMultiStep) {
        runtime.logger.debug('[OtakuMessageService] Using multi-step processing');
        result = await this.runMultiStepCore(runtime, message, state, callback, options);
      } else {
        runtime.logger.debug('[OtakuMessageService] Using single-shot processing');
        result = await this.runSingleShotCore(runtime, message, state, callback, options);
      }

      let responseContent = result.responseContent;
      const responseMessages = result.responseMessages;
      state = result.state;

      // Race check before we send anything
      // IMPORTANT: Bypass race check for job requests (x402 paid API)
      const isJobRequest =
        (message.content.metadata as Record<string, unknown>)?.isJobMessage === true;

      if (!isJobRequest) {
        const currentResponseId = agentResponses.get(message.roomId);
        if (currentResponseId !== responseId) {
          runtime.logger.info(
            `[OtakuMessageService] Response discarded - newer message being processed`
          );
          return {
            didRespond: false,
            responseContent: null,
            responseMessages: [],
            state,
            mode: 'none',
          };
        }
      }

      if (responseContent && message.id) {
        responseContent.inReplyTo = createUniqueUuid(runtime, message.id);
      }

      if (responseContent?.providers?.length && responseContent.providers.length > 0) {
        state = await runtime.composeState(message, responseContent.providers || []);
      }

      if (responseContent) {
        const mode = result.mode ?? ('actions' as StrategyMode);

        if (mode === 'simple') {
          if (responseContent.providers && responseContent.providers.length > 0) {
            runtime.logger.debug(
              { providers: responseContent.providers },
              '[OtakuMessageService] Simple response used providers'
            );
          }
          if (callback) {
            await callback(responseContent);
          }
        } else if (mode === 'actions') {
          await runtime.processActions(message, responseMessages, state, async (content) => {
            runtime.logger.debug({ content }, '[OtakuMessageService] action callback');
            responseContent!.actionCallbacks = content;
            if (callback) {
              return callback(content);
            }
            return [];
          });
        }
      }

      // Clean up the response ID tracking
      cleanupRaceTracking(runtime.agentId, message.roomId);

      // Run evaluators
      await runtime.evaluate(
        message,
        state,
        true,
        async (content) => {
          runtime.logger.debug({ content }, '[OtakuMessageService] evaluate callback');
          if (responseContent) {
            responseContent.evalCallbacks = content;
          }
          if (callback) {
            return callback(content);
          }
          return [];
        },
        responseMessages
      );

      // Collect metadata for logging
      let entityName = 'noname';
      if (message.metadata && 'entityName' in message.metadata) {
        entityName = (message.metadata as Record<string, unknown>).entityName as string;
      }

      const isDM = message.content?.channelType === ChannelType.DM;
      let roomName = entityName;
      if (!isDM) {
        const roomDatas = await runtime.getRoomsByIds([message.roomId]);
        if (roomDatas?.length) {
          const roomData = roomDatas[0];
          if (roomData.name) {
            roomName = roomData.name;
          }
          if (roomData.worldId) {
            const worldData = await runtime.getWorld(roomData.worldId);
            if (worldData) {
              roomName = worldData.name + '-' + roomName;
            }
          }
        }
      }

      const date = new Date();
      // Use safe property access for action data
      const actionsData = (state.data?.providers as Record<string, unknown>)?.ACTIONS as Record<string, unknown> | undefined;
      const actionsDataContent = (actionsData?.data as Record<string, unknown>)?.actionsData as Action[] | undefined;
      const availableActions = actionsDataContent?.map((a: Action) => a.name) || [-1];

      const logData = {
        at: date.toString(),
        timestamp: parseInt('' + date.getTime() / 1000),
        messageId: message.id,
        userEntityId: message.entityId,
        input: message.content.text,
        thought: responseContent?.thought,
        simple: responseContent?.simple,
        availableActions,
        actions: responseContent?.actions,
        providers: responseContent?.providers,
        irt: responseContent?.inReplyTo,
        output: responseContent?.text,
        entityName,
        source: message.content.source,
        channelType: message.content.channelType,
        roomName,
      };

      // Emit run ended event - use type assertion for extended payload
      await runtime.emitEvent(EventType.RUN_ENDED, {
        runtime,
        runId: runId!,
        messageId: message.id!,
        roomId: message.roomId,
        entityId: message.entityId,
        startTime,
        status: 'completed',
        endTime: Date.now(),
        duration: Date.now() - startTime,
        source: 'OtakuMessageService',
      } as Parameters<typeof runtime.emitEvent>[1] & { runId: UUID; messageId: UUID; source: string });

      // Log extended metadata separately for telemetry
      runtime.logger.debug({ logData }, '[OtakuMessageService] Run completed');

      return {
        didRespond: true,
        responseContent,
        responseMessages,
        state,
        mode: result.mode,
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[OtakuMessageService] Error:', error);

      await runtime.emitEvent(EventType.RUN_ENDED, {
        runtime,
        runId: runId!,
        messageId: message.id!,
        roomId: message.roomId,
        entityId: message.entityId,
        startTime,
        status: 'error',
        endTime: Date.now(),
        duration: Date.now() - startTime,
        error: errorMessage,
        source: 'OtakuMessageService',
      } as Parameters<typeof runtime.emitEvent>[1] & { runId: UUID; messageId: UUID; source: string });

      throw error;
    }
  }

  /**
   * Multi-step workflow core execution
   */
  private async runMultiStepCore(
    runtime: IAgentRuntime,
    message: Memory,
    state: State,
    callback?: HandlerCallback,
    options?: MessageProcessingOptions
  ): Promise<StrategyResult> {
    const traceActionResult: MultiStepActionResult[] = [];
    let accumulatedState: State = state;
    
    // Use options.maxMultiStepIterations if provided, otherwise fall back to setting or default
    const maxIterations = options?.maxMultiStepIterations 
      ?? parseInt(String(runtime.getSetting('MAX_MULTISTEP_ITERATIONS') ?? '6'));
    let iterationCount = 0;

    // Compose initial state including wallet data
    accumulatedState = await runtime.composeState(message, [
      'RECENT_MESSAGES',
      'ACTION_STATE',
      'ACTIONS',
      'PROVIDERS',
      'WALLET_STATE',
    ]);
    accumulatedState.data.actionResults = traceActionResult;

    // Standard multi-step loop
    while (iterationCount < maxIterations) {
      iterationCount++;
      runtime.logger.debug(`[MultiStep] Starting iteration ${iterationCount}/${maxIterations}`);

      accumulatedState = await runtime.composeState(message, [
        'RECENT_MESSAGES',
        'ACTION_STATE',
        'WALLET_STATE',
      ]);
      accumulatedState.data.actionResults = traceActionResult;

      // Add iteration context to state for template
      const stateWithIterationContext = {
        ...accumulatedState,
        iterationCount,
        maxIterations,
        traceActionResult,
      };

      const prompt = composePromptFromState({
        state: stateWithIterationContext,
        template:
          runtime.character.templates?.multiStepDecisionTemplate || multiStepDecisionTemplate,
      });

      // Retry logic for parsing failures
      const maxParseRetries = parseInt(String(runtime.getSetting('MULTISTEP_PARSE_RETRIES') ?? '5'));
      let stepResultRaw: string = '';
      let parsedStep: Record<string, unknown> | null = null;

      for (let parseAttempt = 1; parseAttempt <= maxParseRetries; parseAttempt++) {
        try {
          runtime.logger.debug(
            `[MultiStep] Decision step model call attempt ${parseAttempt}/${maxParseRetries}`
          );
          stepResultRaw = await runtime.useModel(ModelType.TEXT_LARGE, { prompt });
          parsedStep = parseKeyValueXml(stepResultRaw);

          if (parsedStep) {
            runtime.logger.debug(`[MultiStep] Successfully parsed on attempt ${parseAttempt}`);
            break;
          } else {
            runtime.logger.warn(
              `[MultiStep] Failed to parse XML on attempt ${parseAttempt}/${maxParseRetries}`
            );
            if (parseAttempt < maxParseRetries) {
              const delay = getRetryDelay(parseAttempt);
              runtime.logger.debug(`[MultiStep] Retrying in ${delay}ms...`);
              await new Promise((resolve) => setTimeout(resolve, delay));
            }
          }
        } catch (error) {
          runtime.logger.error(`[MultiStep] Error during model call attempt ${parseAttempt}`);
          if (parseAttempt >= maxParseRetries) {
            throw error;
          }
          const delay = getRetryDelay(parseAttempt);
          runtime.logger.debug(`[MultiStep] Retrying in ${delay}ms...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }

      if (!parsedStep) {
        runtime.logger.warn(`[MultiStep] Failed to parse step result after ${maxParseRetries} attempts`);
        traceActionResult.push({
          data: { actionName: 'parse_error' },
          success: false,
          error: `Failed to parse step result after ${maxParseRetries} attempts`,
        });
        break;
      }

      const { thought, action, isFinish, parameters } = parsedStep as {
        thought?: string;
        action?: string;
        isFinish?: string | boolean;
        parameters?: string | Record<string, unknown>;
      };

      // If no action to execute, check if we should finish
      if (!action) {
        if (isFinish === 'true' || isFinish === true) {
          runtime.logger.info(`[MultiStep] Task marked as complete at iteration ${iterationCount}`);
          if (callback) {
            await callback({
              text: '',
              thought: thought ?? '',
            });
          }
          break;
        } else {
          runtime.logger.warn(
            `[MultiStep] No action specified at iteration ${iterationCount}, forcing completion`
          );
          break;
        }
      }

      try {
        // Ensure workingMemory exists on accumulatedState
        if (!accumulatedState.data) accumulatedState.data = {} as Record<string, unknown>;
        if (!accumulatedState.data.workingMemory)
          accumulatedState.data.workingMemory = {} as Record<string, unknown>;

        // Parse and store parameters if provided
        let actionParams: Record<string, unknown> = {};
        if (parameters) {
          if (typeof parameters === 'string') {
            try {
              actionParams = JSON.parse(parameters);
              runtime.logger.debug(`[MultiStep] Parsed parameters: ${JSON.stringify(actionParams)}`);
            } catch {
              runtime.logger.warn(`[MultiStep] Failed to parse parameters JSON: ${parameters}`);
            }
          } else if (typeof parameters === 'object') {
            actionParams = parameters;
            runtime.logger.debug(`[MultiStep] Using parameters object: ${JSON.stringify(actionParams)}`);
          }
        }

        const hasActionParams = Object.keys(actionParams).length > 0;

        if (action && hasActionParams) {
          accumulatedState.data.actionParams = actionParams;

          // Also support action-specific namespaces for backwards compatibility
          const actionKey = action.toLowerCase().replace(/_/g, '');
          accumulatedState.data[actionKey] = {
            ...actionParams,
            source: 'multiStepDecisionTemplate',
            timestamp: Date.now(),
          };

          runtime.logger.info(
            `[MultiStep] Stored parameters for ${action}: ${JSON.stringify(actionParams)}`
          );
        }

        if (action) {
          const actionContent: Content & {
            actionParams?: Record<string, unknown>;
            actionInput?: Record<string, unknown>;
          } = {
            text: ` Executing action: ${action}`,
            actions: [action],
            thought: thought ?? '',
          };

          if (hasActionParams) {
            actionContent.actionParams = actionParams;
            actionContent.actionInput = actionParams;
          }

          await runtime.processActions(
            message,
            [
              {
                id: v4() as UUID,
                entityId: runtime.agentId,
                roomId: message.roomId,
                createdAt: Date.now(),
                content: actionContent,
              },
            ],
            accumulatedState,
            async () => {
              return [];
            }
          );

          // Safely access action results from cache
          const actionResults = getActionResultsFromCache(runtime, message.id as string);
          const result = actionResults.length > 0 ? actionResults[0] as Record<string, unknown> : null;
          const success = (result?.success as boolean) ?? false;

          traceActionResult.push({
            data: { actionName: action },
            success,
            text: result?.text as string | undefined,
            values: result?.values as Record<string, unknown> | undefined,
            error: success ? undefined : (result?.text as string | undefined),
          });

          // Refresh state after action execution
          runtime.logger.debug(`[MultiStep] Refreshing state after action ${action}`);
          accumulatedState = await refreshStateAfterAction(
            runtime,
            message,
            accumulatedState,
            traceActionResult
          );
        }
      } catch (err) {
        runtime.logger.error({ err }, '[MultiStep] Error executing step');
        traceActionResult.push({
          data: { actionName: action || 'unknown' },
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      // After executing actions, check if we should finish
      if (isFinish === 'true' || isFinish === true) {
        runtime.logger.info(
          `[MultiStep] Task marked as complete at iteration ${iterationCount} after action`
        );
        if (callback) {
          await callback({
            text: '',
            thought: thought ?? '',
          });
        }
        break;
      }
    }

    if (iterationCount >= maxIterations) {
      runtime.logger.warn(`[MultiStep] Reached maximum iterations (${maxIterations})`);
    }

    // Generate summary
    accumulatedState = await runtime.composeState(message, ['RECENT_MESSAGES', 'ACTION_STATE']);
    const summaryPrompt = composePromptFromState({
      state: accumulatedState,
      template: runtime.character.templates?.multiStepSummaryTemplate || multiStepSummaryTemplate,
    });

    // Retry logic for summary parsing failures
    const maxSummaryRetries = parseInt(String(runtime.getSetting('MULTISTEP_SUMMARY_PARSE_RETRIES') ?? '5'));
    let finalOutput: string = '';
    let summary: Record<string, unknown> | null = null;

    for (let summaryAttempt = 1; summaryAttempt <= maxSummaryRetries; summaryAttempt++) {
      try {
        runtime.logger.debug(`[MultiStep] Summary generation attempt ${summaryAttempt}`);
        finalOutput = await runtime.useModel(ModelType.TEXT_LARGE, { prompt: summaryPrompt });
        summary = parseKeyValueXml(finalOutput);

        if (summary?.text) {
          runtime.logger.debug(`[MultiStep] Successfully parsed summary on attempt ${summaryAttempt}`);
          break;
        } else {
          runtime.logger.warn(
            `[MultiStep] Failed to parse summary XML on attempt ${summaryAttempt}/${maxSummaryRetries}`
          );
          if (summaryAttempt < maxSummaryRetries) {
            const delay = getRetryDelay(summaryAttempt);
            runtime.logger.debug(`[MultiStep] Retrying summary in ${delay}ms...`);
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
        }
      } catch (error) {
        runtime.logger.error(`[MultiStep] Error during summary generation attempt ${summaryAttempt}`);
        if (summaryAttempt >= maxSummaryRetries) {
          runtime.logger.warn('[MultiStep] Failed to generate summary after all retries');
          break;
        }
        const delay = getRetryDelay(summaryAttempt);
        runtime.logger.debug(`[MultiStep] Retrying summary in ${delay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    let responseContent: Content | null = null;
    if (summary?.text) {
      responseContent = {
        actions: ['MULTI_STEP_SUMMARY'],
        text: summary.text as string,
        thought: (summary.thought as string) || 'Final user-facing message after task completion.',
        simple: true,
      };
    } else {
      runtime.logger.warn(`[MultiStep] No valid summary generated, using fallback`);
      responseContent = {
        actions: ['MULTI_STEP_SUMMARY'],
        text: 'I completed the requested actions, but encountered an issue generating the summary.',
        thought: 'Summary generation failed after retries.',
        simple: true,
      };
    }

    const responseMessages: Memory[] = responseContent
      ? [
          {
            id: asUUID(v4()),
            entityId: runtime.agentId,
            agentId: runtime.agentId,
            content: responseContent,
            roomId: message.roomId,
            createdAt: Date.now(),
          },
        ]
      : [];

    return {
      responseContent,
      responseMessages,
      state: accumulatedState,
      mode: responseContent ? 'simple' : 'none',
    };
  }

  /**
   * Single-shot response generation (non-multi-step mode)
   * Generates a response in a single LLM call without iterative action execution
   */
  private async runSingleShotCore(
    runtime: IAgentRuntime,
    message: Memory,
    state: State,
    callback?: HandlerCallback,
    options?: MessageProcessingOptions
  ): Promise<StrategyResult> {
    // Use the passed-in state which already has rich context from providers:
    // ['ANXIETY', 'SHOULD_RESPOND', 'ENTITIES', 'CHARACTER', 'RECENT_MESSAGES', 'ACTIONS']
    // This ensures single-shot mode has access to conversation history, character personality,
    // and entity information for generating high-quality responses.
    let currentState = state;
    
    if (!currentState.values?.actionNames) {
      runtime.logger.warn('[OtakuMessageService] actionNames missing from state');
    }

    // Generate response using single-shot template
    const prompt = composePromptFromState({
      state: currentState,
      template: runtime.character.templates?.messageHandlerTemplate || singleShotTemplate,
    });

    const maxRetries = options?.maxRetries ?? 3;
    let response: string | null = null;
    let parsedResponse: Record<string, unknown> | null = null;
    
    // Retry loop for parsing failures
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        response = String(await runtime.useModel(ModelType.TEXT_LARGE, { prompt }));
        parsedResponse = parseKeyValueXml(response);
        
        if (parsedResponse?.text || parsedResponse?.thought) {
          break; // Successfully parsed
        }
        
        runtime.logger.warn(
          `[OtakuMessageService] Single-shot attempt ${attempt + 1}/${maxRetries} - missing required fields`
        );
      } catch (error) {
        runtime.logger.error(
          { error, attempt },
          '[OtakuMessageService] Single-shot generation failed'
        );
      }
    }

    if (!parsedResponse) {
      runtime.logger.error('[OtakuMessageService] All single-shot attempts failed');
      return {
        responseContent: null,
        responseMessages: [],
        state: currentState,
        mode: 'none',
      };
    }

    // Build response content
    const responseContent: Content = {
      text: String(parsedResponse.text || ''),
      thought: String(parsedResponse.thought || ''),
      actions: parsedResponse.actions
        ? String(parsedResponse.actions).split(',').map((a: string) => a.trim()).filter(Boolean)
        : [],
      providers: parsedResponse.providers
        ? String(parsedResponse.providers).split(',').map((p: string) => p.trim()).filter(Boolean)
        : [],
      source: message.content.source,
      inReplyTo: message.id ? createUniqueUuid(runtime, message.id) : undefined,
    };

    // Create response memory
    const responseMessages: Memory[] = responseContent.text
      ? [
          {
            id: asUUID(v4()),
            entityId: runtime.agentId,
            agentId: runtime.agentId,
            roomId: message.roomId,
            content: responseContent,
            createdAt: Date.now(),
          },
        ]
      : [];

    runtime.logger.debug(
      { text: responseContent.text?.substring(0, 100), actions: responseContent.actions },
      '[OtakuMessageService] Single-shot response generated'
    );

    return {
      responseContent: responseContent.text ? responseContent : null,
      responseMessages,
      state: currentState,
      mode: responseContent.actions?.length ? 'actions' : 'simple',
    };
  }

  /**
   * Determines whether the agent should respond to a message.
   */
  shouldRespond(
    runtime: IAgentRuntime,
    message: Memory,
    room?: Room,
    mentionContext?: MentionContext
  ): ResponseDecision {
    if (!room) {
      return { shouldRespond: false, skipEvaluation: true, reason: 'no room context' };
    }

    function normalizeEnvList(value: unknown): string[] {
      if (!value || typeof value !== 'string') return [];
      const cleaned = value.trim().replace(/^\[|\]$/g, '');
      return cleaned
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
    }

    const alwaysRespondChannels = [
      ChannelType.DM,
      ChannelType.VOICE_DM,
      ChannelType.SELF,
      ChannelType.API,
    ];

    const alwaysRespondSources = ['client_chat'];

    const customChannels = normalizeEnvList(
      runtime.getSetting('ALWAYS_RESPOND_CHANNELS') ||
        runtime.getSetting('SHOULD_RESPOND_BYPASS_TYPES')
    );
    const customSources = normalizeEnvList(
      runtime.getSetting('ALWAYS_RESPOND_SOURCES') ||
        runtime.getSetting('SHOULD_RESPOND_BYPASS_SOURCES')
    );

    const respondChannels = new Set(
      [...alwaysRespondChannels.map((t) => t.toString()), ...customChannels].map((s: string) =>
        s.trim().toLowerCase()
      )
    );

    const respondSources = [...alwaysRespondSources, ...customSources].map((s: string) =>
      s.trim().toLowerCase()
    );

    const roomType = room.type?.toString().toLowerCase();
    const sourceStr = message.content.source?.toLowerCase() || '';

    // 1. DM/VOICE_DM/API channels: always respond
    if (respondChannels.has(roomType)) {
      return { shouldRespond: true, skipEvaluation: true, reason: `private channel: ${roomType}` };
    }

    // 2. Specific sources (e.g., client_chat): always respond
    if (respondSources.some((pattern) => sourceStr.includes(pattern))) {
      return {
        shouldRespond: true,
        skipEvaluation: true,
        reason: `whitelisted source: ${sourceStr}`,
      };
    }

    // 3. Platform mentions and replies: always respond
    const hasPlatformMention = !!(mentionContext?.isMention || mentionContext?.isReply);
    if (hasPlatformMention) {
      const mentionType = mentionContext?.isMention ? 'mention' : 'reply';
      return { shouldRespond: true, skipEvaluation: true, reason: `platform ${mentionType}` };
    }

    // 4. All other cases: let the LLM decide
    return { shouldRespond: false, skipEvaluation: false, reason: 'needs LLM evaluation' };
  }

  /**
   * Processes attachments in a message (images, documents, etc.)
   * Generates descriptions for images and extracts text from documents.
   */
  async processAttachments(runtime: IAgentRuntime, attachments: Media[]): Promise<Media[]> {
    if (!attachments || attachments.length === 0) {
      return attachments;
    }

    const processedAttachments: Media[] = [];

    for (const attachment of attachments) {
      try {
        // If attachment already has a description, keep it
        if (attachment.description) {
          processedAttachments.push(attachment);
          continue;
        }

        // Process based on content type
        const contentType = attachment.contentType || '';
        
        if (contentType.startsWith('image/')) {
          // For images, use vision model to generate description
          runtime.logger.debug(
            `[OtakuMessageService] Processing image attachment: ${attachment.url}`
          );
          
          try {
            // Try to use vision model to describe the image
            // Note: IMAGE_DESCRIPTION may not be available in all configurations
            const result = await runtime.useModel(ModelType.IMAGE_DESCRIPTION, {
              imageUrl: attachment.url,
              prompt: 'Describe this image in detail.',
            });
            
            attachment.description = typeof result === 'string' 
              ? result 
              : (result as { description?: string })?.description || 'Image attachment';
          } catch (visionError) {
            // Log the vision model error so users know why image descriptions are generic
            runtime.logger.warn(
              { error: visionError instanceof Error ? visionError.message : String(visionError), url: attachment.url },
              '[OtakuMessageService] Vision model failed for image - using generic description. ' +
              'This may indicate IMAGE_DESCRIPTION model is not configured.'
            );
            attachment.description = `Image: ${attachment.title || attachment.url}`;
          }
        } else if (
          contentType.startsWith('text/') ||
          contentType.includes('pdf') ||
          contentType.includes('document')
        ) {
          // For text documents, try to extract text
          runtime.logger.debug(
            `[OtakuMessageService] Processing document attachment: ${attachment.url}`
          );
          
          // Use the text field if available
          if (attachment.text) {
            attachment.description = `Document content: ${attachment.text.substring(0, 500)}${
              attachment.text.length > 500 ? '...' : ''
            }`;
          } else {
            attachment.description = `Document: ${attachment.title || attachment.url}`;
          }
        } else {
          // For other types, use generic description
          attachment.description = `Attachment: ${attachment.title || attachment.url}`;
        }

        processedAttachments.push(attachment);
      } catch (error) {
        runtime.logger.warn(
          { error, attachment: attachment.url },
          '[OtakuMessageService] Failed to process attachment'
        );
        // Still include the attachment even if processing failed
        processedAttachments.push(attachment);
      }
    }

    return processedAttachments;
  }

  /**
   * Deletes a message from the agent's memory.
   */
  async deleteMessage(runtime: IAgentRuntime, message: Memory): Promise<void> {
    try {
      if (!message.id) {
        runtime.logger.error('[OtakuMessageService] Cannot delete memory: message ID is missing');
        return;
      }

      runtime.logger.info(
        `[OtakuMessageService] Deleting memory for message ${message.id} from room ${message.roomId}`
      );
      await runtime.deleteMemory(message.id);
      runtime.logger.debug(
        { messageId: message.id },
        '[OtakuMessageService] Successfully deleted memory'
      );
    } catch (error: unknown) {
      runtime.logger.error({ error }, '[OtakuMessageService] Error in deleteMessage');
      throw error;
    }
  }

  /**
   * Clears all messages from a channel/room.
   */
  async clearChannel(runtime: IAgentRuntime, roomId: UUID, channelId: string): Promise<void> {
    try {
      runtime.logger.info(
        `[OtakuMessageService] Clearing message memories from channel ${channelId} -> room ${roomId}`
      );

      const memories = await runtime.getMemoriesByRoomIds({
        tableName: 'messages',
        roomIds: [roomId],
      });

      runtime.logger.debug(
        `[OtakuMessageService] Found ${memories.length} memories to delete`
      );

      let deletedCount = 0;
      for (const memory of memories) {
        if (memory.id) {
          try {
            await runtime.deleteMemory(memory.id);
            deletedCount++;
          } catch (error) {
            runtime.logger.warn(
              { error, memoryId: memory.id },
              '[OtakuMessageService] Failed to delete message memory'
            );
          }
        }
      }

      runtime.logger.info(
        `[OtakuMessageService] Cleared ${deletedCount}/${memories.length} memories from channel ${channelId}`
      );
    } catch (error: unknown) {
      runtime.logger.error({ error }, '[OtakuMessageService] Error in clearChannel');
      throw error;
    }
  }

  /**
   * Helper to emit run ended events
   */
  private async emitRunEnded(
    runtime: IAgentRuntime,
    runId: UUID,
    message: Memory,
    startTime: number,
    status: string
  ): Promise<void> {
    await runtime.emitEvent(EventType.RUN_ENDED, {
      runtime,
      runId,
      messageId: message.id!,
      roomId: message.roomId,
      entityId: message.entityId,
      startTime,
      status,
      endTime: Date.now(),
      duration: Date.now() - startTime,
      source: 'OtakuMessageService',
    } as Parameters<typeof runtime.emitEvent>[1] & { runId: UUID; messageId: UUID; source: string });
  }
}
