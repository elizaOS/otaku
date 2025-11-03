import {
  type ActionEventPayload,
  asUUID,
  ChannelType,
  composePromptFromState,
  type Content,
  type ControlMessage,
  createUniqueUuid,
  type EntityPayload,
  type EvaluatorEventPayload,
  type EventPayload,
  EventType,
  type IAgentRuntime,
  logger,
  type Memory,
  messageHandlerTemplate,
  type MessagePayload,
  ModelType,
  parseKeyValueXml,
  type Plugin,
  PluginEvents,
  parseBooleanFromText,
  Role,
  type Room,
  type RunEventPayload,
  truncateToCompleteSentence,
  type UUID,
  type WorldPayload,
  type State,
  Action,
  HandlerCallback,
} from '@elizaos/core';
import { v4 } from 'uuid';

// import * as actions from './actions/index.ts';
import * as evaluators from './evaluators/index.js';
import * as providers from './providers/index.js';

import { TaskService } from './services/task.js';
import { EmbeddingGenerationService } from './services/embedding.js';
import { multiStepDecisionTemplate, multiStepSummaryTemplate } from './templates/index.js';
import { refreshStateAfterAction } from './utils/index.js';


/**
 * Multi-step workflow execution result
 */
interface MultiStepActionResult {
  data: { actionName: string };
  success: boolean;
  text?: string;
  error?: string | Error;
  values?: Record<string, any>;
}

const latestResponseIds = new Map<string, Map<string, string>>();

/**
 * Handles incoming messages and generates responses based on the provided runtime and message information.
 *
 * @param {MessagePayload} payload - The message payload containing runtime, message, and callback.
 * @returns {Promise<void>} - A promise that resolves once the message handling and response generation is complete.
 */
const messageReceivedHandler = async ({
  runtime,
  message,
  callback,
  onComplete,
}: MessagePayload): Promise<void> => {
  // Set up timeout monitoring
  const timeoutDuration = 60 * 60 * 1000; // 1 hour
  let timeoutId: NodeJS.Timeout | undefined = undefined;

  try {
    runtime.logger.info(
      `[Bootstrap] Message received from ${message.entityId} in room ${message.roomId}`
    );

    // Generate a new response ID
    const responseId = v4();
    
    // Check if this is a job request (x402 paid API)
    // Job requests are isolated one-off operations that don't need race tracking
    const isJobRequest = (message.content.metadata as Record<string, unknown>)?.isJobMessage === true;
    
    // Get or create the agent-specific map
    if (!latestResponseIds.has(runtime.agentId)) {
      latestResponseIds.set(runtime.agentId, new Map<string, string>());
    }
    const agentResponses = latestResponseIds.get(runtime.agentId);
    if (!agentResponses) throw new Error('Agent responses map not found');

    // Only track response IDs for non-job messages
    // Job requests bypass race tracking since they're isolated operations
    if (!isJobRequest) {
      // Log when we're updating the response ID
      const previousResponseId = agentResponses.get(message.roomId);
      if (previousResponseId) {
        logger.warn(
          `[Bootstrap] Updating response ID for room ${message.roomId} from ${previousResponseId} to ${responseId} - this may discard in-progress responses`
        );
      }

      // Set this as the latest response ID for this agent+room
      agentResponses.set(message.roomId, responseId);
    } else {
      runtime.logger.info(
        `[Bootstrap] Job request detected for room ${message.roomId} - bypassing race tracking`
      );
    }

    // Use runtime's run tracking for this message processing
    const runId = runtime.startRun();
    const startTime = Date.now();

    // Emit run started event
    await runtime.emitEvent(EventType.RUN_STARTED, {
      runtime,
      runId,
      messageId: message.id,
      roomId: message.roomId,
      entityId: message.entityId,
      startTime,
      status: 'started',
      source: 'messageHandler',
      // this shouldn't be a standard
      // but we need to expose content somewhere
      metadata: message.content,
    });

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(async () => {
        await runtime.emitEvent(EventType.RUN_TIMEOUT, {
          runtime,
          runId,
          messageId: message.id,
          roomId: message.roomId,
          entityId: message.entityId,
          startTime,
          status: 'timeout',
          endTime: Date.now(),
          duration: Date.now() - startTime,
          error: 'Run exceeded 60 minute timeout',
          source: 'messageHandler',
        });
        reject(new Error('Run exceeded 60 minute timeout'));
      }, timeoutDuration);
    });

    const processingPromise = (async () => {
      try {
        if (message.entityId === runtime.agentId) {
          runtime.logger.debug(`[Bootstrap] Skipping message from self (${runtime.agentId})`);
          throw new Error('Message is from the agent itself');
        }

        runtime.logger.debug(
          `[Bootstrap] Processing message: ${truncateToCompleteSentence(message.content.text || '', 50)}...`
        );

        // First, save the incoming message
        runtime.logger.debug('[Bootstrap] Saving message to memory and queueing embeddings');

        // Check if memory already exists (it might have been created by MessageBusService)
        let memoryToQueue: Memory;

        if (message.id) {
          const existingMemory = await runtime.getMemoryById(message.id);
          if (existingMemory) {
            runtime.logger.debug('[Bootstrap] Memory already exists, skipping creation');
            memoryToQueue = existingMemory;
          } else {
            // Create memory with the existing ID (preserving external IDs)
            const createdMemoryId = await runtime.createMemory(message, 'messages');
            // Use the created memory with the actual ID returned by the database
            memoryToQueue = { ...message, id: createdMemoryId };
          }
          // Queue with high priority for messages with pre-existing IDs
          await runtime.queueEmbeddingGeneration(memoryToQueue, 'high');
        } else {
          // No ID, create new memory and queue embedding
          const memoryId = await runtime.createMemory(message, 'messages');
          // Set the ID on the message for downstream processing
          message.id = memoryId;
          // Create a memory object with the new ID for queuing
          memoryToQueue = { ...message, id: memoryId };
          await runtime.queueEmbeddingGeneration(memoryToQueue, 'normal');
        }

        const agentUserState = await runtime.getParticipantUserState(
          message.roomId,
          runtime.agentId
        );

        // default LLM to off
        const defLllmOff = parseBooleanFromText(runtime.getSetting('BOOTSTRAP_DEFLLMOFF'));
        if (defLllmOff && agentUserState === null) {
          runtime.logger.debug('bootstrap - LLM is off by default');
          // allow some other subsystem to handle this event
          // maybe emit an event

          // Emit run ended event on successful completion
          await runtime.emitEvent(EventType.RUN_ENDED, {
            runtime,
            runId,
            messageId: message.id,
            roomId: message.roomId,
            entityId: message.entityId,
            startTime,
            status: 'off',
            endTime: Date.now(),
            duration: Date.now() - startTime,
            source: 'messageHandler',
          });
          return;
        }

        if (
          agentUserState === 'MUTED' &&
          !message.content.text?.toLowerCase().includes(runtime.character.name.toLowerCase())
        ) {
          runtime.logger.debug(`[Bootstrap] Ignoring muted room ${message.roomId}`);
          // Emit run ended event on successful completion
          await runtime.emitEvent(EventType.RUN_ENDED, {
            runtime,
            runId,
            messageId: message.id,
            roomId: message.roomId,
            entityId: message.entityId,
            startTime,
            status: 'muted',
            endTime: Date.now(),
            duration: Date.now() - startTime,
            source: 'messageHandler',
          });
          return;
        }

        let state = await runtime.composeState(
          message,
          ['ANXIETY', 'SHOULD_RESPOND', 'ENTITIES', 'CHARACTER', 'RECENT_MESSAGES', 'ACTIONS'],
          true
        );

      
        let responseContent: Content | null = null;
        let responseMessages: Memory[] = [];

       
        const result = await runMultiStepCore({ runtime, message, state, callback });

        responseContent = result.responseContent;
        responseMessages = result.responseMessages;
        state = result.state;

        // Race check before we send anything
        // IMPORTANT: Bypass race check for job requests (x402 paid API)
        // Job requests are one-off operations that must always complete
        const isJobRequest = (message.content.metadata as Record<string, unknown>)?.isJobMessage === true;
        
        if (!isJobRequest) {
          const currentResponseId = agentResponses.get(message.roomId);
          if (currentResponseId !== responseId) {
            runtime.logger.info(
              `Response discarded - newer message being processed for agent: ${runtime.agentId}, room: ${message.roomId}`
            );
            return;
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
            // Log provider usage for simple responses
            if (responseContent.providers && responseContent.providers.length > 0) {
              runtime.logger.debug(
                { providers: responseContent.providers },
                '[Bootstrap] Simple response used providers'
              );
            }
            // without actions there can't be more than one message
            if (callback) {
              await callback(responseContent);
            }
          } else if (mode === 'actions') {
            await runtime.processActions(message, responseMessages, state, async (content) => {
              runtime.logger.debug({ content }, 'action callback');
              responseContent!.actionCallbacks = content;
              if (callback) {
                return callback(content);
              }
              return [];
            });
          }
        }
        

        // Clean up the response ID since we handled it
        agentResponses.delete(message.roomId);
        if (agentResponses.size === 0) {
          latestResponseIds.delete(runtime.agentId);
        }

        await runtime.evaluate(
          message,
          state,
          true,
          async (content) => {
            runtime.logger.debug({ content }, 'evaluate callback');
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

        // ok who are they
        let entityName = 'noname';
        if (message.metadata && 'entityName' in message.metadata) {
          entityName = (message.metadata as any).entityName;
        }

        const isDM = message.content?.channelType === ChannelType.DM;
        let roomName = entityName;
        if (!isDM) {
          const roomDatas = await runtime.getRoomsByIds([message.roomId]);
          if (roomDatas?.length) {
            const roomData = roomDatas[0];
            if (roomData.name) {
              // server/guild name?
              roomName = roomData.name;
            }
            // how do I get worldName
            if (roomData.worldId) {
              const worldData = await runtime.getWorld(roomData.worldId);
              if (worldData) {
                roomName = worldData.name + '-' + roomName;
              }
            }
          }
        }

        const date = new Date();

        // get available actions
        const availableActions = state.data?.providers?.ACTIONS?.data?.actionsData?.map(
          (a: Action) => a.name
        ) || [-1];

        // generate data of interest
        const logData = {
          at: date.toString(),
          timestamp: parseInt('' + date.getTime() / 1000),
          messageId: message.id, // can extract roomId or whatever
          userEntityId: message.entityId,
          input: message.content.text,
          thought: responseContent?.thought,
          simple: responseContent?.simple,
          availableActions,
          actions: responseContent?.actions,
          providers: responseContent?.providers,
          irt: responseContent?.inReplyTo,
          output: responseContent?.text,
          // to strip out
          entityName,
          source: message.content.source,
          channelType: message.content.channelType,
          roomName,
        };

        // Emit run ended event on successful completion
        await runtime.emitEvent(EventType.RUN_ENDED, {
          runtime,
          runId,
          messageId: message.id,
          roomId: message.roomId,
          entityId: message.entityId,
          startTime,
          status: 'completed',
          endTime: Date.now(),
          duration: Date.now() - startTime,
          source: 'messageHandler',
          entityName,
          responseContent,
          metadata: logData,
        });
      } catch (error: any) {
        console.error('error is', error);
        // Emit run ended event with error
        await runtime.emitEvent(EventType.RUN_ENDED, {
          runtime,
          runId,
          messageId: message.id,
          roomId: message.roomId,
          entityId: message.entityId,
          startTime,
          status: 'error',
          endTime: Date.now(),
          duration: Date.now() - startTime,
          error: error.message,
          source: 'messageHandler',
        });
      }
    })();

    await Promise.race([processingPromise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId);
    onComplete?.();
  }
};

type StrategyMode = 'simple' | 'actions' | 'none';
type StrategyResult = {
  responseContent: Content | null;
  responseMessages: Memory[];
  state: any;
  mode: StrategyMode;
};

async function runMultiStepCore({ runtime, message, state, callback }: { runtime: IAgentRuntime, message: Memory, state: State, callback?: HandlerCallback }): Promise<StrategyResult> {
  const traceActionResult: MultiStepActionResult[] = [];
  let accumulatedState: State = state;
  const maxIterations = parseInt(runtime.getSetting('MAX_MULTISTEP_ITERATIONS') || '6');
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

  // Standard multi-step loop (wallet already exists)
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
      template: runtime.character.templates?.multiStepDecisionTemplate || multiStepDecisionTemplate,
    });

    // Retry logic for parsing failures
    const maxParseRetries = parseInt(runtime.getSetting('MULTISTEP_PARSE_RETRIES') || '5');
    let stepResultRaw: string = '';
    let parsedStep: any = null;
    
    for (let parseAttempt = 1; parseAttempt <= maxParseRetries; parseAttempt++) {
      try {
        runtime.logger.debug(
          `[MultiStep] Decision step model call attempt ${parseAttempt}/${maxParseRetries} for iteration ${iterationCount}`
        );
        stepResultRaw = await runtime.useModel(ModelType.TEXT_LARGE, { prompt });
        parsedStep = parseKeyValueXml(stepResultRaw);
        
        if (parsedStep) {
          runtime.logger.debug(
            `[MultiStep] Successfully parsed decision step on attempt ${parseAttempt}`
          );
          break;
        } else {
          runtime.logger.warn(
            `[MultiStep] Failed to parse XML on attempt ${parseAttempt}/${maxParseRetries}. Raw response: ${stepResultRaw.substring(0, 200)}...`
          );
          
          if (parseAttempt < maxParseRetries) {
            // Small delay before retry
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        }
      } catch (error) {
        runtime.logger.error(
          `[MultiStep] Error during model call attempt ${parseAttempt}/${maxParseRetries}: ${error}`
        );
        if (parseAttempt >= maxParseRetries) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    if (!parsedStep) {
      runtime.logger.warn(
        `[MultiStep] Failed to parse step result after ${maxParseRetries} attempts at iteration ${iterationCount}`
      );
      traceActionResult.push({
        data: { actionName: 'parse_error' },
        success: false,
        error: `Failed to parse step result after ${maxParseRetries} attempts`,
      });
      break;
    }

    const { thought, action, isFinish, parameters } = parsedStep as any;

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
      // ensure workingMemory exists on accumulatedState
      if (!accumulatedState.data) accumulatedState.data = {} as any;
      if (!accumulatedState.data.workingMemory) accumulatedState.data.workingMemory = {} as any;

      // Parse and store parameters if provided
      let actionParams = {};
      if (parameters) {
        if (typeof parameters === 'string') {
          try {
            actionParams = JSON.parse(parameters);
            runtime.logger.debug(`[MultiStep] Parsed parameters: ${JSON.stringify(actionParams)}`);
          } catch (e) {
            runtime.logger.warn(`[MultiStep] Failed to parse parameters JSON: ${parameters}`);
          }
        } else if (typeof parameters === 'object') {
          actionParams = parameters;
          runtime.logger.debug(`[MultiStep] Using parameters object: ${JSON.stringify(actionParams)}`);
        }
      }

      // Store parameters in state for action to consume
      if (action && Object.keys(actionParams).length > 0) {
        accumulatedState.data.actionParams = actionParams;
        
        // Also support action-specific namespaces for backwards compatibility
        // e.g., webSearch for WEB_SEARCH action
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
        const actionContent = {
          text: ` Executing action: ${action}`,
          actions: [action],
          thought: thought ?? '',
        };
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

        const cachedState = (runtime as any).stateCache.get(`${message.id}_action_results`);
        const actionResults = cachedState?.values?.actionResults || [];
        const result = actionResults.length > 0 ? actionResults[0] : null;
        const success = result?.success ?? false;

        traceActionResult.push({
          data: { actionName: action },
          success,
          text: result?.text,
          values: result?.values,
          error: success ? undefined : result?.text,
        });

        // Refresh state after action execution to keep prompts and action results in sync
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
      runtime.logger.info(`[MultiStep] Task marked as complete at iteration ${iterationCount} after executing action`);
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
    runtime.logger.warn(
      `[MultiStep] Reached maximum iterations (${maxIterations}), forcing completion`
    );
  }

  accumulatedState = await runtime.composeState(message, ['RECENT_MESSAGES', 'ACTION_STATE']);
  const summaryPrompt = composePromptFromState({
    state: accumulatedState,
    template: runtime.character.templates?.multiStepSummaryTemplate || multiStepSummaryTemplate,
  });

  // Retry logic for summary parsing failures
  const maxSummaryRetries = parseInt(runtime.getSetting('MULTISTEP_SUMMARY_PARSE_RETRIES') || '5');
  let finalOutput: string = '';
  let summary: any = null;
  
  for (let summaryAttempt = 1; summaryAttempt <= maxSummaryRetries; summaryAttempt++) {
    try {
      runtime.logger.debug(
        `[MultiStep] Summary generation attempt ${summaryAttempt}/${maxSummaryRetries}`
      );
      finalOutput = await runtime.useModel(ModelType.TEXT_LARGE, { prompt: summaryPrompt });
      summary = parseKeyValueXml(finalOutput);
      
      if (summary?.text) {
        runtime.logger.debug(
          `[MultiStep] Successfully parsed summary on attempt ${summaryAttempt}`
        );
        break;
      } else {
        runtime.logger.warn(
          `[MultiStep] Failed to parse summary XML on attempt ${summaryAttempt}/${maxSummaryRetries}. Raw response: ${finalOutput.substring(0, 200)}...`
        );
        
        if (summaryAttempt < maxSummaryRetries) {
          // Small delay before retry
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
    } catch (error) {
      runtime.logger.error(
        `[MultiStep] Error during summary generation attempt ${summaryAttempt}/${maxSummaryRetries}: ${error}`
      );
      if (summaryAttempt >= maxSummaryRetries) {
        runtime.logger.warn('[MultiStep] Failed to generate summary after all retries, using fallback');
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  let responseContent: Content | null = null;
  if (summary?.text) {
    responseContent = {
      actions: ['MULTI_STEP_SUMMARY'],
      text: summary.text,
      thought: summary.thought || 'Final user-facing message after task completion.',
      simple: true,
    };
  } else {
    runtime.logger.warn(
      `[MultiStep] No valid summary generated after ${maxSummaryRetries} attempts, using fallback`
    );
    // Fallback response when summary generation fails
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
 * Handles message deletion events by removing the corresponding memory from the agent's memory store.
 *
 * @param {Object} params - The parameters for the function.
 * @param {IAgentRuntime} params.runtime - The agent runtime object.
 * @param {Memory} params.message - The message memory that was deleted.
 * @returns {void}
 */
const messageDeletedHandler = async ({
  runtime,
  message,
}: {
  runtime: IAgentRuntime;
  message: Memory;
}) => {
  try {
    if (!message.id) {
      runtime.logger.error('[Bootstrap] Cannot delete memory: message ID is missing');
      return;
    }

    runtime.logger.info(
      '[Bootstrap] Deleting memory for message',
      message.id,
      'from room',
      message.roomId
    );
    await runtime.deleteMemory(message.id);
    runtime.logger.debug(
      { messageId: message.id },
      '[Bootstrap] Successfully deleted memory for message'
    );
  } catch (error: unknown) {
    runtime.logger.error({ error }, '[Bootstrap] Error in message deleted handler:');
  }
};

/**
 * Handles channel cleared events by removing all message memories from the specified room.
 *
 * @param {Object} params - The parameters for the function.
 * @param {IAgentRuntime} params.runtime - The agent runtime object.
 * @param {UUID} params.roomId - The room ID to clear message memories from.
 * @param {string} params.channelId - The original channel ID.
 * @param {number} params.memoryCount - Number of memories found.
 * @returns {void}
 */
const channelClearedHandler = async ({
  runtime,
  roomId,
  channelId,
  memoryCount,
}: {
  runtime: IAgentRuntime;
  roomId: UUID;
  channelId: string;
  memoryCount: number;
}) => {
  try {
    runtime.logger.info(
      `[Bootstrap] Clearing ${memoryCount} message memories from channel ${channelId} -> room ${roomId}`
    );

    // Get all message memories for this room
    const memories = await runtime.getMemoriesByRoomIds({
      tableName: 'messages',
      roomIds: [roomId],
    });

    // Delete each message memory
    let deletedCount = 0;
    for (const memory of memories) {
      if (memory.id) {
        try {
          await runtime.deleteMemory(memory.id);
          deletedCount++;
        } catch (error) {
          runtime.logger.warn(
            { error, memoryId: memory.id },
            `[Bootstrap] Failed to delete message memory ${memory.id}:`
          );
        }
      }
    }

    runtime.logger.info(
      `[Bootstrap] Successfully cleared ${deletedCount}/${memories.length} message memories from channel ${channelId}`
    );
  } catch (error: unknown) {
    runtime.logger.error({ error }, '[Bootstrap] Error in channel cleared handler:');
  }
};

/**
 * Syncs a single user into an entity
 */
/**
 * Asynchronously sync a single user with the specified parameters.
 *
 * @param {UUID} entityId - The unique identifier for the entity.
 * @param {IAgentRuntime} runtime - The runtime environment for the agent.
 * @param {any} user - The user object to sync.
 * @param {string} serverId - The unique identifier for the server.
 * @param {string} channelId - The unique identifier for the channel.
 * @param {ChannelType} type - The type of channel.
 * @param {string} source - The source of the user data.
 * @returns {Promise<void>} A promise that resolves once the user is synced.
 */
const syncSingleUser = async (
  entityId: UUID,
  runtime: IAgentRuntime,
  serverId: string,
  channelId: string,
  type: ChannelType,
  source: string
) => {
  try {
    const entity = await runtime.getEntityById(entityId);
    runtime.logger.info(`[Bootstrap] Syncing user: ${entity?.metadata?.username || entityId}`);

    // Ensure we're not using WORLD type and that we have a valid channelId
    if (!channelId) {
      runtime.logger.warn(`[Bootstrap] Cannot sync user ${entity?.id} without a valid channelId`);
      return;
    }

    const roomId = createUniqueUuid(runtime, channelId);
    const worldId = createUniqueUuid(runtime, serverId);

    // Create world with ownership metadata for DM connections (onboarding)
    const worldMetadata =
      type === ChannelType.DM
        ? {
            ownership: {
              ownerId: entityId,
            },
            roles: {
              [entityId]: Role.OWNER,
            },
            settings: {}, // Initialize empty settings for onboarding
          }
        : undefined;

    runtime.logger.info(
      `[Bootstrap] syncSingleUser - type: ${type}, isDM: ${type === ChannelType.DM}, worldMetadata: ${JSON.stringify(worldMetadata)}`
    );

    await runtime.ensureConnection({
      entityId,
      roomId,
      name: (entity?.metadata?.name || entity?.metadata?.username || `User${entityId}`) as
        | undefined
        | string,
      source,
      channelId,
      serverId,
      type,
      worldId,
      metadata: worldMetadata,
    });

    // Verify the world was created with proper metadata
    try {
      const createdWorld = await runtime.getWorld(worldId);
      runtime.logger.info(
        `[Bootstrap] Created world check - ID: ${worldId}, metadata: ${JSON.stringify(createdWorld?.metadata)}`
      );
    } catch (error) {
      runtime.logger.error(`[Bootstrap] Failed to verify created world: ${error}`);
    }

    runtime.logger.success(`[Bootstrap] Successfully synced user: ${entity?.id}`);
  } catch (error) {
    runtime.logger.error(
      `[Bootstrap] Error syncing user: ${error instanceof Error ? error.message : String(error)}`
    );
  }
};

/**
 * Handles standardized server data for both WORLD_JOINED and WORLD_CONNECTED events
 */
const handleServerSync = async ({
  runtime,
  world,
  rooms,
  entities,
  source,
  onComplete,
}: WorldPayload) => {
  runtime.logger.debug(`[Bootstrap] Handling server sync event for server: ${world.name}`);
  try {
    await runtime.ensureConnections(entities, rooms, source, world);
    runtime.logger.debug(`Successfully synced standardized world structure for ${world.name}`);
    onComplete?.();
  } catch (error) {
    runtime.logger.error(
      `Error processing standardized server data: ${error instanceof Error ? error.message : String(error)}`
    );
  }
};

/**
 * Handles control messages for enabling or disabling UI elements in the frontend
 * @param {Object} params - Parameters for the handler
 * @param {IAgentRuntime} params.runtime - The runtime instance
 * @param {Object} params.message - The control message
 * @param {string} params.source - Source of the message
 */
const controlMessageHandler = async ({
  runtime,
  message,
}: {
  runtime: IAgentRuntime;
  message: ControlMessage;
  source: string;
}) => {
  try {
    runtime.logger.debug(
      `[controlMessageHandler] Processing control message: ${message.payload.action} for room ${message.roomId}`
    );

    // Here we would use a WebSocket service to send the control message to the frontend
    // This would typically be handled by a registered service with sendMessage capability

    // Get any registered WebSocket service
    const serviceNames = Array.from(runtime.getAllServices().keys()) as string[];
    const websocketServiceName = serviceNames.find(
      (name: string) =>
        name.toLowerCase().includes('websocket') || name.toLowerCase().includes('socket')
    );

    if (websocketServiceName) {
      const websocketService = runtime.getService(websocketServiceName);
      if (websocketService && 'sendMessage' in websocketService) {
        // Send the control message through the WebSocket service
        await (websocketService as any).sendMessage({
          type: 'controlMessage',
          payload: {
            action: message.payload.action,
            target: message.payload.target,
            roomId: message.roomId,
          },
        });

        runtime.logger.debug(
          `[controlMessageHandler] Control message ${message.payload.action} sent successfully`
        );
      } else {
        runtime.logger.error(
          '[controlMessageHandler] WebSocket service does not have sendMessage method'
        );
      }
    } else {
      runtime.logger.error(
        '[controlMessageHandler] No WebSocket service found to send control message'
      );
    }
  } catch (error) {
    runtime.logger.error(`[controlMessageHandler] Error processing control message: ${error}`);
  }
};

const events: PluginEvents = {
  [EventType.MESSAGE_RECEIVED]: [
    async (payload: MessagePayload) => {
      if (!payload.callback) {
        payload.runtime.logger.error('No callback provided for message');
        return;
      }
      await messageReceivedHandler(payload);
    },
  ],

  [EventType.VOICE_MESSAGE_RECEIVED]: [
    async (payload: MessagePayload) => {
      if (!payload.callback) {
        payload.runtime.logger.error('No callback provided for voice message');
        return;
      }
      await messageReceivedHandler(payload);
    },
  ],


  [EventType.MESSAGE_DELETED]: [
    async (payload: MessagePayload) => {
      await messageDeletedHandler(payload);
    },
  ],

  [EventType.CHANNEL_CLEARED]: [
    async (payload: EventPayload & { roomId: UUID; channelId: string; memoryCount: number }) => {
      await channelClearedHandler({
        runtime: payload.runtime,
        roomId: payload.roomId,
        channelId: payload.channelId,
        memoryCount: payload.memoryCount,
      });
    },
  ],

  [EventType.WORLD_JOINED]: [
    async (payload: WorldPayload) => {
      await handleServerSync(payload);
    },
  ],

  [EventType.WORLD_CONNECTED]: [
    async (payload: WorldPayload) => {
      await handleServerSync(payload);
    },
  ],

  [EventType.ENTITY_JOINED]: [
    async (payload: EntityPayload) => {
      payload.runtime.logger.debug(
        `[Bootstrap] ENTITY_JOINED event received for entity ${payload.entityId}`
      );

      if (!payload.worldId) {
        payload.runtime.logger.error('[Bootstrap] No worldId provided for entity joined');
        return;
      }
      if (!payload.roomId) {
        payload.runtime.logger.error('[Bootstrap] No roomId provided for entity joined');
        return;
      }
      if (!payload.metadata?.type) {
        payload.runtime.logger.error('[Bootstrap] No type provided for entity joined');
        return;
      }

      await syncSingleUser(
        payload.entityId,
        payload.runtime,
        payload.worldId,
        payload.roomId,
        payload.metadata.type,
        payload.source
      );
    },
  ],

  [EventType.ENTITY_LEFT]: [
    async (payload: EntityPayload) => {
      try {
        // Update entity to inactive
        const entity = await payload.runtime.getEntityById(payload.entityId);
        if (entity) {
          entity.metadata = {
            ...entity.metadata,
            status: 'INACTIVE',
            leftAt: Date.now(),
          };
          await payload.runtime.updateEntity(entity);
        }
        payload.runtime.logger.info(
          `[Bootstrap] User ${payload.entityId} left world ${payload.worldId}`
        );
      } catch (error: any) {
        payload.runtime.logger.error(
          '[Bootstrap] Error handling user left:',
          error instanceof Error ? error.message : String(error)
        );
      }
    },
  ],

  [EventType.ACTION_STARTED]: [
    async (payload: ActionEventPayload) => {
      try {
        const messageBusService = payload.runtime.getService('message-bus-service') as any;
        if (messageBusService) {
          await messageBusService.notifyActionStart(
            payload.roomId,
            payload.world,
            payload.content,
            payload.messageId
          );
        }
      } catch (error) {
        logger.error(`[Bootstrap] Error sending refetch request: ${error}`);
      }
    },
  ],

  [EventType.ACTION_COMPLETED]: [
    async (payload: ActionEventPayload) => {
      try {
        const messageBusService = payload.runtime.getService('message-bus-service') as any;
        if (messageBusService) {
          await messageBusService.notifyActionUpdate(
            payload.roomId,
            payload.world,
            payload.content,
            payload.messageId
          );
        }
      } catch (error) {
        logger.error(`[Bootstrap] Error sending refetch request: ${error}`);
      }
    },
  ],

  [EventType.EVALUATOR_STARTED]: [
    async (payload: EvaluatorEventPayload) => {
      logger.debug(
        `[Bootstrap] Evaluator started: ${payload.evaluatorName} (${payload.evaluatorId})`
      );
    },
  ],

  [EventType.EVALUATOR_COMPLETED]: [
    async (payload: EvaluatorEventPayload) => {
      const status = payload.error ? `failed: ${payload.error.message}` : 'completed';
      logger.debug(
        `[Bootstrap] Evaluator ${status}: ${payload.evaluatorName} (${payload.evaluatorId})`
      );
    },
  ],

  [EventType.RUN_STARTED]: [
    async (payload: RunEventPayload) => {
      try {
        await payload.runtime.log({
          entityId: payload.entityId,
          roomId: payload.roomId,
          type: 'run_event',
          body: {
            runId: payload.runId,
            status: payload.status,
            messageId: payload.messageId,
            roomId: payload.roomId,
            entityId: payload.entityId,
            startTime: payload.startTime,
            source: payload.source || 'unknown',
          },
        });
        logger.debug(`[Bootstrap] Logged RUN_STARTED event for run ${payload.runId}`);
      } catch (error) {
        logger.error(`[Bootstrap] Failed to log RUN_STARTED event: ${error}`);
      }
    },
  ],

  [EventType.RUN_ENDED]: [
    async (payload: RunEventPayload) => {
      try {
        await payload.runtime.log({
          entityId: payload.entityId,
          roomId: payload.roomId,
          type: 'run_event',
          body: {
            runId: payload.runId,
            status: payload.status,
            messageId: payload.messageId,
            roomId: payload.roomId,
            entityId: payload.entityId,
            startTime: payload.startTime,
            endTime: payload.endTime,
            duration: payload.duration,
            error: payload.error,
            source: payload.source || 'unknown',
          },
        });
        logger.debug(
          `[Bootstrap] Logged RUN_ENDED event for run ${payload.runId} with status ${payload.status}`
        );
      } catch (error) {
        logger.error(`[Bootstrap] Failed to log RUN_ENDED event: ${error}`);
      }
    },
  ],

  [EventType.RUN_TIMEOUT]: [
    async (payload: RunEventPayload) => {
      try {
        await payload.runtime.log({
          entityId: payload.entityId,
          roomId: payload.roomId,
          type: 'run_event',
          body: {
            runId: payload.runId,
            status: payload.status,
            messageId: payload.messageId,
            roomId: payload.roomId,
            entityId: payload.entityId,
            startTime: payload.startTime,
            endTime: payload.endTime,
            duration: payload.duration,
            error: payload.error,
            source: payload.source || 'unknown',
          },
        });
        logger.debug(`[Bootstrap] Logged RUN_TIMEOUT event for run ${payload.runId}`);
      } catch (error) {
        logger.error(`[Bootstrap] Failed to log RUN_TIMEOUT event: ${error}`);
      }
    },
  ],

  CONTROL_MESSAGE: [controlMessageHandler],
};

export const bootstrapPlugin: Plugin = {
  name: 'bootstrap',
  description: 'Agent bootstrap with basic actions and evaluators',
  actions: [
    // actions.replyAction,
    // actions.ignoreAction,
  ],
  events: events,
  evaluators: [evaluators.reflectionEvaluator],
  providers: [
    providers.evaluatorsProvider,
    providers.timeProvider,
    providers.providersProvider,
    providers.actionsProvider,
    providers.actionStateProvider,
    providers.characterProvider,
    providers.recentMessagesProvider,
  ],
  services: [TaskService, EmbeddingGenerationService],
};

export default bootstrapPlugin;
