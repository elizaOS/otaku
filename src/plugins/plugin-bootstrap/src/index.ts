import {
  type ActionEventPayload,
  asUUID,
  ChannelType,
  composePromptFromState,
  type Content,
  type ControlMessage,
  ContentType,
  createUniqueUuid,
  type EntityPayload,
  type EvaluatorEventPayload,
  type EventPayload,
  EventType,
  type IAgentRuntime,
  imageDescriptionTemplate,
  logger,
  type Media,
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
  getLocalServerUrl,
  type State,
  Action,
  HandlerCallback,
  Provider,
} from '@elizaos/core';
import { v4 } from 'uuid';

// import * as actions from './actions/index.ts';
import * as evaluators from './evaluators/index.ts';
import * as providers from './providers/index.ts';

import { TaskService } from './services/task.ts';
import { EmbeddingGenerationService } from './services/embedding.ts';

export * from './actions/index.ts';
export * from './evaluators/index.ts';
export * from './providers/index.ts';

export const walletCreationTemplate = `<task>
The user does not have a Coinbase CDP wallet configured.
Your job is to guide them to create one or, if they explicitly express intent, set isCreateWallet to true for this step.
</task>

{{recentMessages}}

# Wallet Context (CDP)
This indicates whether the user has a configured Coinbase CDP wallet and includes basic details (address, provider, chain). If no wallet is present, on-chain actions (transfers, swaps, bridging) are unavailable until a wallet is created.
{{walletState}}

# What is a CDP wallet?
A CDP wallet is an EVM-compatible account created via Coinbase Developer Platform that the agent uses to perform on-chain actions (transfers, swaps, balance checks). It's required before any blockchain operations.

# How to create it
Say: "Create wallet" to proceed. If the user expresses intent to create, set \`isCreateWallet\` to true in this step. If the user does not express intent, set \`isCreateWallet\` to false and prompt them to create the wallet.

---

# Capabilities overview (internal)
Use the lists below only to understand capabilities for later steps and to craft a concise introduction. Do not include these lists verbatim in the user-facing message. In this step, you only set \`isCreateWallet\` appropriately and provide the \`response\` text.

{{actionsWithDescriptions}}

<keys>
"thought" Explain whether the user has shown intent and your next step.
"isCreateWallet" Set to true only if the user explicitly shows intent to create a wallet now. Otherwise set to false.
"text" A brief, user-facing message. If intent is absent, introduce CDP and capabilities at a high level and ask the user to say "Create wallet" to proceed. Keep it concise.
</keys>

<output>
<response>
  <thought>Your thought here</thought>
  <isCreateWallet>true | false</isCreateWallet>
  <text>Politely prompt to create a wallet if no intent; otherwise acknowledge creation intent.</text>
</response>
</output>`;

export const multiStepDecisionTemplate = `<task>
Determine the next step the assistant should take in this conversation to help the user reach their goal.
</task>

{{system}}

---

# Wallet Context (CDP)
This indicates whether the user has a configured Coinbase CDP wallet and includes basic details (address, provider, chain). If no wallet is present, on-chain actions (transfers, swaps, bridging) are unavailable until a wallet is created.
{{walletState}}

{{recentMessages}}

# Multi-Step Workflow

In each step, decide:

1. **Which action (if any)** should be executed after providers return.
2. Decide whether the task is complete. If so, set \`isFinish: true\`.

You can select at most **one action** per step.

If the task is fully resolved and no further steps are needed, mark the step as \`isFinish: true\`.

---

{{actionsWithDescriptions}}

These are the actions calls that have already been used in this run. Use this to avoid redundancy and guide your next move.

{{actionResults}}

<keys>
"thought" Clearly explain your reasoning for the selected providers and/or action, and how this step contributes to resolving the user's request.
"action"  Name of the action to execute after providers return (must be selected from the list of **Available Actions** shown above; can be empty if no action is needed).
"isFinish" Set to true only if the task is fully complete.
"searchQuery" If the selected action is WEB_SEARCH, optionally provide the precise web search query to run.
</keys>

⚠️ IMPORTANT: Do **not** mark the task as \`isFinish: true\` immediately after calling an action. Wait for the action to complete before deciding the task is finished.

- Your final output MUST be in this XML format:

<output>
<response>
  <thought>Your thought here</thought>
  <action>ACTION</action>
  <isFinish>true | false</isFinish>
  <searchQuery>Optional specific query for WEB_SEARCH</searchQuery>
</response>
</output>`;

export const multiStepSummaryTemplate = `<task>
Summarize what the assistant has done so far and provide a final response to the user based on the completed steps.
</task>

# Context Information
{{bio}}

---

{{system}}

---

{{messageDirections}}

---
# Wallet Context (CDP)
This indicates whether the user has a configured Coinbase CDP wallet and includes basic details (address, provider, chain). If no wallet is present, on-chain actions (transfers, swaps, bridging) are unavailable until a wallet is created.
{{walletState}}

{{recentMessages}}

# Execution Trace
Here are the actions taken by the assistant to fulfill the request:
{{actionResults}}

{{actionsWithDescriptions}}

# Assistant’s Last Reasoning Step
{{recentMessage}}

# Instructions

- Generate a concise, helpful message that acknowledges the agent's capabilities and next best steps.

- Your final output MUST be in this XML format:
<output>
<response>
  <thought>Your thought here</thought>
  <text>Your final message to the user</text>
</response>
</output>
`;



/**
 * Represents media data containing a buffer of data and the media type.
 * @typedef {Object} MediaData
 * @property {Buffer} data - The buffer of data.
 * @property {string} mediaType - The type of media.
 */
type MediaData = {
  data: Buffer;
  mediaType: string;
};

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
 * Escapes special characters in a string to make it JSON-safe.
 */
/* // Removing JSON specific helpers
function escapeForJson(input: string): string {
  return input
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/```/g, '\\`\\`\\`');
}

function sanitizeJson(rawJson: string): string {
  try {
    // Try parsing directly
    JSON.parse(rawJson);
    return rawJson; // Already valid
  } catch {
    // Continue to sanitization
  }

  // first, replace all newlines with \n
  const sanitized = rawJson
    .replace(/\n/g, '\\n')

    // then, replace all backticks with \\\`
    .replace(/`/g, '\\\`');

  // Regex to find and escape the "text" field
  const fixed = sanitized.replace(/"text"\s*:\s*"([\s\S]*?)"\s*,\s*"simple"/, (_match, group) => {
    const escapedText = escapeForJson(group);
    return `"text": "${escapedText}", "simple"`;
  });

  // Validate that the result is actually parseable
  try {
    JSON.parse(fixed);
    return fixed;
  } catch (e) {
    throw new Error(`Failed to sanitize JSON: ${e.message}`);
  }
}
*/

/**
 * Fetches media data from a list of attachments, supporting both HTTP URLs and local file paths.
 *
 * @param attachments Array of Media objects containing URLs or file paths to fetch media from
 * @returns Promise that resolves with an array of MediaData objects containing the fetched media data and content type
 */
/**
 * Fetches media data from given attachments.
 * @param {Media[]} attachments - Array of Media objects to fetch data from.
 * @returns {Promise<MediaData[]>} - A Promise that resolves with an array of MediaData objects.
 */
export async function fetchMediaData(attachments: Media[]): Promise<MediaData[]> {
  return Promise.all(
    attachments.map(async (attachment: Media) => {
      if (/^(http|https):\/\//.test(attachment.url)) {
        // Handle HTTP URLs
        const response = await fetch(attachment.url);
        if (!response.ok) {
          throw new Error(`Failed to fetch file: ${attachment.url}`);
        }
        const mediaBuffer = Buffer.from(await response.arrayBuffer());
        const mediaType = attachment.contentType || 'image/png';
        return { data: mediaBuffer, mediaType };
      }
      // if (fs.existsSync(attachment.url)) {
      //   // Handle local file paths
      //   const mediaBuffer = await fs.promises.readFile(path.resolve(attachment.url));
      //   const mediaType = attachment.contentType || 'image/png';
      //   return { data: mediaBuffer, mediaType };
      // }
      throw new Error(`File not found: ${attachment.url}. Make sure the path is correct.`);
    })
  );
}

/**
 * Processes attachments by generating descriptions for supported media types.
 * Currently supports image description generation.
 *
 * @param {Media[]} attachments - Array of attachments to process
 * @param {IAgentRuntime} runtime - The agent runtime for accessing AI models
 * @returns {Promise<Media[]>} - Returns a new array of processed attachments with added description, title, and text properties
 */
export async function processAttachments(
  attachments: Media[],
  runtime: IAgentRuntime
): Promise<Media[]> {
  if (!attachments || attachments.length === 0) {
    return [];
  }
  runtime.logger.debug(`[Bootstrap] Processing ${attachments.length} attachment(s)`);

  const processedAttachments: Media[] = [];

  for (const attachment of attachments) {
    try {
      // Start with the original attachment
      const processedAttachment: Media = { ...attachment };

      const isRemote = /^(http|https):\/\//.test(attachment.url);
      const url = isRemote ? attachment.url : getLocalServerUrl(attachment.url);
      // Only process images that don't already have descriptions
      if (attachment.contentType === ContentType.IMAGE && !attachment.description) {
        runtime.logger.debug(`[Bootstrap] Generating description for image: ${attachment.url}`);

        let imageUrl = url;

        if (!isRemote) {
          // Only convert local/internal media to base64
          const res = await fetch(url);
          if (!res.ok) throw new Error(`Failed to fetch image: ${res.statusText}`);

          const arrayBuffer = await res.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);
          const contentType = res.headers.get('content-type') || 'application/octet-stream';
          imageUrl = `data:${contentType};base64,${buffer.toString('base64')}`;
        }

        try {
          const response = await runtime.useModel(ModelType.IMAGE_DESCRIPTION, {
            prompt: imageDescriptionTemplate,
            imageUrl,
          });

          if (typeof response === 'string') {
            // Parse XML response
            const parsedXml = parseKeyValueXml(response);

            if (parsedXml && (parsedXml.description || parsedXml.text)) {
              processedAttachment.description = parsedXml.description || '';
              processedAttachment.title = parsedXml.title || 'Image';
              processedAttachment.text = parsedXml.text || parsedXml.description || '';

              runtime.logger.debug(
                `[Bootstrap] Generated description: ${processedAttachment.description?.substring(0, 100)}...`
              );
            } else {
              // Fallback: Try simple regex parsing if parseKeyValueXml fails
              const responseStr = response as string;
              const titleMatch = responseStr.match(/<title>([^<]+)<\/title>/);
              const descMatch = responseStr.match(/<description>([^<]+)<\/description>/);
              const textMatch = responseStr.match(/<text>([^<]+)<\/text>/);

              if (titleMatch || descMatch || textMatch) {
                processedAttachment.title = titleMatch?.[1] || 'Image';
                processedAttachment.description = descMatch?.[1] || '';
                processedAttachment.text = textMatch?.[1] || descMatch?.[1] || '';

                runtime.logger.debug(
                  `[Bootstrap] Used fallback XML parsing - description: ${processedAttachment.description?.substring(0, 100)}...`
                );
              } else {
                runtime.logger.warn(
                  `[Bootstrap] Failed to parse XML response for image description`
                );
              }
            }
          } else if (response && typeof response === 'object' && 'description' in response) {
            // Handle object responses for backwards compatibility
            processedAttachment.description = response.description;
            processedAttachment.title = response.title || 'Image';
            processedAttachment.text = response.description;

            runtime.logger.debug(
              `[Bootstrap] Generated description: ${processedAttachment.description?.substring(0, 100)}...`
            );
          } else {
            runtime.logger.warn(`[Bootstrap] Unexpected response format for image description`);
          }
        } catch (error) {
          runtime.logger.error({ error }, `[Bootstrap] Error generating image description:`);
          // Continue processing without description
        }
      } else if (attachment.contentType === ContentType.DOCUMENT && !attachment.text) {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Failed to fetch document: ${res.statusText}`);

        const contentType = res.headers.get('content-type') || '';
        const isPlainText = contentType.startsWith('text/plain');

        if (isPlainText) {
          runtime.logger.debug(`[Bootstrap] Processing plain text document: ${attachment.url}`);

          const textContent = await res.text();
          processedAttachment.text = textContent;
          processedAttachment.title = processedAttachment.title || 'Text File';

          runtime.logger.debug(
            `[Bootstrap] Extracted text content (first 100 chars): ${processedAttachment.text?.substring(0, 100)}...`
          );
        } else {
          runtime.logger.warn(`[Bootstrap] Skipping non-plain-text document: ${contentType}`);
        }
      }

      processedAttachments.push(processedAttachment);
    } catch (error) {
      runtime.logger.error(
        { error, attachmentUrl: attachment.url },
        `[Bootstrap] Failed to process attachment ${attachment.url}:`
      );
      // Add the original attachment if processing fails
      processedAttachments.push(attachment);
    }
  }

  return processedAttachments;
}

/**
 * Determines whether to skip the shouldRespond logic based on room type and message source.
 * Supports both default values and runtime-configurable overrides via env settings.
 */
export function shouldBypassShouldRespond(
  runtime: IAgentRuntime,
  room?: Room,
  source?: string
): boolean {
  if (!room) return false;

  function normalizeEnvList(value: unknown): string[] {
    if (!value || typeof value !== 'string') return [];

    const cleaned = value.trim().replace(/^\[|\]$/g, '');
    return cleaned
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
  }

  const defaultBypassTypes = [
    ChannelType.DM,
    ChannelType.VOICE_DM,
    ChannelType.SELF,
    ChannelType.API,
  ];

  const defaultBypassSources = ['client_chat'];

  const bypassTypesSetting = normalizeEnvList(runtime.getSetting('SHOULD_RESPOND_BYPASS_TYPES'));
  const bypassSourcesSetting = normalizeEnvList(
    runtime.getSetting('SHOULD_RESPOND_BYPASS_SOURCES')
  );

  const bypassTypes = new Set(
    [...defaultBypassTypes.map((t) => t.toString()), ...bypassTypesSetting].map((s: string) =>
      s.trim().toLowerCase()
    )
  );

  const bypassSources = [...defaultBypassSources, ...bypassSourcesSetting].map((s: string) =>
    s.trim().toLowerCase()
  );

  const roomType = room.type?.toString().toLowerCase();
  const sourceStr = source?.toLowerCase() || '';

  return bypassTypes.has(roomType) || bypassSources.some((pattern) => sourceStr.includes(pattern));
}

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
  const useMultiStep = true;
  const timeoutDuration = 60 * 60 * 1000; // 1 hour
  let timeoutId: NodeJS.Timeout | undefined = undefined;

  try {
    runtime.logger.info(
      `[Bootstrap] Message received from ${message.entityId} in room ${message.roomId}`
    );

    // Generate a new response ID
    const responseId = v4();
    // Get or create the agent-specific map
    if (!latestResponseIds.has(runtime.agentId)) {
      latestResponseIds.set(runtime.agentId, new Map<string, string>());
    }
    const agentResponses = latestResponseIds.get(runtime.agentId);
    if (!agentResponses) throw new Error('Agent responses map not found');

    // Log when we're updating the response ID
    const previousResponseId = agentResponses.get(message.roomId);
    if (previousResponseId) {
      logger.warn(
        `[Bootstrap] Updating response ID for room ${message.roomId} from ${previousResponseId} to ${responseId} - this may discard in-progress responses`
      );
    }

    // Set this as the latest response ID for this agent+room
    agentResponses.set(message.roomId, responseId);

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

        let shouldRespond = true;

        // I don't think we need these right now
        //runtime.logger.debug('shouldRespond is', shouldRespond);
        //runtime.logger.debug('shouldSkipShouldRespond', shouldSkipShouldRespond);

        let responseContent: Content | null = null;
        let responseMessages: Memory[] = [];

        if (shouldRespond) {
          const result = useMultiStep
            ? await runMultiStepCore({ runtime, message, state, callback })
            : await runSingleShotCore({ runtime, message, state });

          responseContent = result.responseContent;
          responseMessages = result.responseMessages;
          state = result.state;

          // Race check before we send anything
          const currentResponseId = agentResponses.get(message.roomId);
          if (currentResponseId !== responseId) {
            runtime.logger.info(
              `Response discarded - newer message being processed for agent: ${runtime.agentId}, room: ${message.roomId}`
            );
            return;
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
        } else {
          // Handle the case where the agent decided not to respond
          runtime.logger.debug(
            '[Bootstrap] Agent decided not to respond (shouldRespond is false).'
          );

          // Check if we still have the latest response ID
          const currentResponseId = agentResponses.get(message.roomId);
          // helpful for swarms
          const keepResp = parseBooleanFromText(runtime.getSetting('BOOTSTRAP_KEEP_RESP'));
          if (currentResponseId !== responseId && !keepResp) {
            runtime.logger.info(
              `Ignore response discarded - newer message being processed for agent: ${runtime.agentId}, room: ${message.roomId}`
            );
            // Emit run ended event on successful completion
            await runtime.emitEvent(EventType.RUN_ENDED, {
              runtime,
              runId,
              messageId: message.id,
              roomId: message.roomId,
              entityId: message.entityId,
              startTime,
              status: 'replaced',
              endTime: Date.now(),
              duration: Date.now() - startTime,
              source: 'messageHandler',
            });
            return; // Stop processing if a newer message took over
          }

          if (!message.id) {
            runtime.logger.error(
              '[Bootstrap] Message ID is missing, cannot create ignore response.'
            );
            // Emit run ended event on successful completion
            await runtime.emitEvent(EventType.RUN_ENDED, {
              runtime,
              runId,
              messageId: message.id,
              roomId: message.roomId,
              entityId: message.entityId,
              startTime,
              status: 'noMessageId',
              endTime: Date.now(),
              duration: Date.now() - startTime,
              source: 'messageHandler',
            });
            return;
          }

          // Construct a minimal content object indicating ignore, include a generic thought
          const ignoreContent: Content = {
            thought: 'Agent decided not to respond to this message.',
            actions: ['IGNORE'],
            simple: true, // Treat it as simple for callback purposes
            inReplyTo: createUniqueUuid(runtime, message.id), // Reference original message
          };

          // Call the callback directly with the ignore content
          if (callback) {
            await callback(ignoreContent);
          }

          // Also save this ignore action/thought to memory
          const ignoreMemory: Memory = {
            id: asUUID(v4()),
            entityId: runtime.agentId,
            agentId: runtime.agentId,
            content: ignoreContent,
            roomId: message.roomId,
            createdAt: Date.now(),
          };
          await runtime.createMemory(ignoreMemory, 'messages');
          runtime.logger.debug(
            '[Bootstrap] Saved ignore response to memory',
            `memoryId: ${ignoreMemory.id}`
          );

          // Optionally, evaluate the decision to ignore (if relevant evaluators exist)
          // await runtime.evaluate(message, state, shouldRespond, callback, []);
        }

        // Clean up the response ID since we handled it
        agentResponses.delete(message.roomId);
        if (agentResponses.size === 0) {
          latestResponseIds.delete(runtime.agentId);
        }

        await runtime.evaluate(
          message,
          state,
          shouldRespond,
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

async function runSingleShotCore({ runtime, message, state }: { runtime: IAgentRuntime, message: Memory, state: State }): Promise<StrategyResult> {
  state = await runtime.composeState(message, ['ACTIONS']);

  if (!state.values?.actionNames) {
    runtime.logger.warn('actionNames data missing from state, even though it was requested');
  }

  const prompt = composePromptFromState({
    state,
    template: runtime.character.templates?.messageHandlerTemplate || messageHandlerTemplate,
  });

  let responseContent: Content | null = null;

  // Retry if missing required fields
  let retries = 0;
  const maxRetries = 3;

  while (retries < maxRetries && (!responseContent?.thought || !responseContent?.actions)) {
    const response = await runtime.useModel(ModelType.TEXT_LARGE, { prompt });

    runtime.logger.debug({ response }, '[Bootstrap] *** Raw LLM Response ***');

    // Attempt to parse the XML response
    const parsedXml = parseKeyValueXml(response);
    runtime.logger.debug({ parsedXml }, '[Bootstrap] *** Parsed XML Content ***');

    // Map parsed XML to Content type, handling potential missing fields
    if (parsedXml) {
      responseContent = {
        ...parsedXml,
        thought: parsedXml.thought || '',
        actions: parsedXml.actions || ['IGNORE'],
        providers: parsedXml.providers || [],
        text: parsedXml.text || '',
        simple: parsedXml.simple || false,
      };
    } else {
      responseContent = null;
    }

    retries++;
    if (!responseContent?.thought || !responseContent?.actions) {
      runtime.logger.warn(
        { response, parsedXml, responseContent },
        '[Bootstrap] *** Missing required fields (thought or actions), retrying... ***'
      );
    }
  }

  if (!responseContent) {
    return { responseContent: null, responseMessages: [], state, mode: 'none' };
  }

  // --- LLM IGNORE/REPLY ambiguity handling ---
  // Sometimes the LLM outputs actions like ["REPLY", "IGNORE"], which breaks isSimple detection
  // and triggers unnecessary large LLM calls. We clarify intent here:
  // - If IGNORE is present with other actions:
  //    - If text is empty, we assume the LLM intended to IGNORE and drop all other actions.
  //    - If text is present, we assume the LLM intended to REPLY and remove IGNORE from actions.
  // This ensures consistent, clear behavior and preserves reply speed optimizations.
  if (responseContent.actions && responseContent.actions.length > 1) {
    // filter out all NONE actions, there's nothing to be done with them
    // oh but there is a none action in bootstrap
    //responseContent.actions = responseContent.actions.filter(a => a !== 'NONE')

    // Helper function to safely check if an action is IGNORE
    const isIgnore = (a: unknown) => typeof a === 'string' && a.toUpperCase() === 'IGNORE';

    // Check if any action is IGNORE
    const hasIgnore = responseContent.actions.some(isIgnore);

    if (hasIgnore) {
      if (!responseContent.text || responseContent.text.trim() === '') {
        // No text, truly meant to IGNORE
        responseContent.actions = ['IGNORE'];
      } else {
        // Text present, LLM intended to reply, remove IGNORE
        const filtered = responseContent.actions.filter((a) => !isIgnore(a));
        // Ensure we don't end up with an empty actions array when text is present
        // If all actions were IGNORE, default to REPLY
        responseContent.actions = filtered.length ? filtered : ['REPLY'];
      }
    }
  }

  // Automatically determine if response is simple based on providers and actions
  // Simple = REPLY action with no providers used
  const isSimple =
    responseContent.actions?.length === 1 &&
    typeof responseContent.actions[0] === 'string' &&
    responseContent.actions[0].toUpperCase() === 'REPLY' &&
    (!responseContent.providers || responseContent.providers.length === 0);

  responseContent.simple = isSimple;

  const responseMessages: Memory[] = [
    {
      id: asUUID(v4()),
      entityId: runtime.agentId,
      agentId: runtime.agentId,
      content: responseContent,
      roomId: message.roomId,
      createdAt: Date.now(),
    },
  ];

  return {
    responseContent,
    responseMessages,
    state,
    mode: isSimple && responseContent.text ? 'simple' : 'actions',
  };
}

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

  // Short-circuit wallet flow outside the loop
  const hasWallet: boolean = !!accumulatedState?.data?.providers?.WALLET_STATE?.data?.hasWallet;
  if (!hasWallet) {
    const wcPrompt = composePromptFromState({
      state: accumulatedState,
      template: runtime.character.templates?.walletCreationTemplate || walletCreationTemplate,
    });
    const wcRaw = await runtime.useModel(ModelType.TEXT_LARGE, { prompt: wcPrompt });
    const wc = parseKeyValueXml(wcRaw) || {};
    const { isCreateWallet, thought, text } = wc as any;

    if (isCreateWallet === 'true' || isCreateWallet === true) {
      const actionContent = {
        text: `🔎 Executing action: CDP_CREATE_WALLET`,
        actions: ['CDP_CREATE_WALLET'],
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
        data: { actionName: 'CDP_CREATE_WALLET' },
        success,
        text: result?.text,
        values: result?.values,
        error: success ? undefined : result?.text,
      });

      // After creation, go straight to summary
      const summaryPromptAfterWallet = composePromptFromState({
        state: await runtime.composeState(message, [
          'RECENT_MESSAGES',
          'ACTION_STATE',
          'ACTIONS',
          'PROVIDERS',
          'WALLET_STATE',
        ]),
        template: runtime.character.templates?.multiStepSummaryTemplate || multiStepSummaryTemplate,
      });
      const finalOutputAfterWallet = await runtime.useModel(ModelType.TEXT_LARGE, { prompt: summaryPromptAfterWallet });
      const summaryAfterWallet = parseKeyValueXml(finalOutputAfterWallet);

      if (summaryAfterWallet?.text) {
        const responseContent: Content = {
          actions: ['MULTI_STEP_SUMMARY'],
          text: summaryAfterWallet.text,
          thought: summaryAfterWallet.thought || 'Final user-facing message after wallet creation.',
          simple: true,
        };
        const responseMessages: Memory[] = [
          {
            id: asUUID(v4()),
            entityId: runtime.agentId,
            agentId: runtime.agentId,
            content: responseContent,
            roomId: message.roomId,
            createdAt: Date.now(),
          },
        ];
        return { responseContent, responseMessages, state: accumulatedState, mode: 'simple' };
      }

      return { responseContent: null, responseMessages: [], state: accumulatedState, mode: 'none' };
    }

    // No intent: immediate reply
    const replyText = typeof text === 'string' ? text : '';
    const replyContent: Content = {
      actions: ['MULTI_STEP_SUMMARY'],
      text: replyText,
      thought: thought || 'Prompting user to create a wallet before proceeding.',
      simple: true,
    };
    const responseMessages: Memory[] = [
      {
        id: asUUID(v4()),
        entityId: runtime.agentId,
        agentId: runtime.agentId,
        content: replyContent,
        roomId: message.roomId,
        createdAt: Date.now(),
      },
    ];
    return { responseContent: replyContent, responseMessages, state: accumulatedState, mode: 'simple' };
  }

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

    const prompt = composePromptFromState({
      state: accumulatedState,
      template: runtime.character.templates?.multiStepDecisionTemplate || multiStepDecisionTemplate,
    });

    const stepResultRaw = await runtime.useModel(ModelType.TEXT_LARGE, { prompt });
    const parsedStep = parseKeyValueXml(stepResultRaw);

    if (!parsedStep) {
      runtime.logger.warn(`[MultiStep] Failed to parse step result at iteration ${iterationCount}`);
      traceActionResult.push({
        data: { actionName: 'parse_error' },
        success: false,
        error: 'Failed to parse step result',
      });
      break;
    }

    const { thought, providers = [], action, isFinish, searchQuery } = parsedStep as any;

    // Check for completion condition
    if (isFinish === 'true' || isFinish === true) {
      runtime.logger.info(`[MultiStep] Task marked as complete at iteration ${iterationCount}`);
      if (callback) {
        await callback({
          text: '',
          thought: thought ?? '',
        });
      }
      break;
    }

    // Validate that we have something to do in this step
    if ((!providers || providers.length === 0) && !action) {
      runtime.logger.warn(
        `[MultiStep] No providers or action specified at iteration ${iterationCount}, forcing completion`
      );
      break;
    }

    try {
      // ensure workingMemory exists on accumulatedState
      if (!accumulatedState.data) accumulatedState.data = {} as any;
      if (!accumulatedState.data.workingMemory) accumulatedState.data.workingMemory = {} as any;

      // If action is WEB_SEARCH and we have an explicit searchQuery from the template, store it
      if (typeof action === 'string' && action.toUpperCase() === 'WEB_SEARCH' && searchQuery) {
        accumulatedState.data.webSearch = {
          query: String(searchQuery),
          source: 'multiStepDecisionTemplate',
          timestamp: Date.now(),
        };
      }
      for (const providerName of providers) {
        const provider = runtime.providers.find((p: Provider) => p.name === providerName);
        if (!provider) {
          runtime.logger.warn(`[MultiStep] Provider not found: ${providerName}`);
          traceActionResult.push({
            data: { actionName: providerName },
            success: false,
            error: `Provider not found: ${providerName}`,
          });
          continue;
        }

        const providerResult = await provider.get(runtime, message, state);
        if (!providerResult) {
          runtime.logger.warn(`[MultiStep] Provider returned no result: ${providerName}`);
          traceActionResult.push({
            data: { actionName: providerName },
            success: false,
            error: `Provider returned no result`,
          });
          continue;
        }

        const success = !!providerResult.text;

        traceActionResult.push({
          data: { actionName: providerName },
          success,
          text: success ? providerResult.text : undefined,
          error: success ? undefined : providerResult?.text,
        });
        // if (callback) {
        //   await callback({
        //     text: `🔎 Provider executed: ${providerName}`,
        //     actions: [providerName],
        //     thought: thought ?? '',
        //   });
        // }
      }

      if (action) {
        const actionContent = {
          text: `🔎 Executing action: ${action}`,
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
      }
    } catch (err) {
      runtime.logger.error({ err }, '[MultiStep] Error executing step');
      traceActionResult.push({
        data: { actionName: action || 'unknown' },
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
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

  const finalOutput = await runtime.useModel(ModelType.TEXT_LARGE, { prompt: summaryPrompt });
  const summary = parseKeyValueXml(finalOutput);

  let responseContent: Content | null = null;
  if (summary?.text) {
    responseContent = {
      actions: ['MULTI_STEP_SUMMARY'],
      text: summary.text,
      thought: summary.thought || 'Final user-facing message after task completion.',
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
    async (payload: any) => {
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
        // Only notify for client_chat messages
        if (payload.content?.source === 'client_chat') {
          const messageBusService = payload.runtime.getService('message-bus-service') as any;
          if (messageBusService) {
            await messageBusService.notifyActionStart(
              payload.roomId,
              payload.world,
              payload.content,
              payload.messageId
            );
          }
        }
      } catch (error) {
        logger.error(`[Bootstrap] Error sending refetch request: ${error}`);
      }
    },
    async (payload: ActionEventPayload) => {
      try {
        await payload.runtime.log({
          entityId: payload.runtime.agentId,
          roomId: payload.roomId,
          type: 'action_event',
          body: {
            runId: payload.content?.runId,
            actionId: payload.content?.actionId,
            actionName: payload.content?.actions?.[0],
            roomId: payload.roomId,
            messageId: payload.messageId,
            timestamp: Date.now(),
            planStep: payload.content?.planStep,
            source: 'actionHandler',
          },
        });
        logger.debug(
          `[Bootstrap] Logged ACTION_STARTED event for action ${payload.content?.actions?.[0]}`
        );
      } catch (error) {
        logger.error(`[Bootstrap] Failed to log ACTION_STARTED event: ${error}`);
      }
    },
  ],

  [EventType.ACTION_COMPLETED]: [
    async (payload: ActionEventPayload) => {
      try {
        // Only notify for client_chat messages
        if (payload.content?.source === 'client_chat') {
          const messageBusService = payload.runtime.getService('message-bus-service') as any;
          if (messageBusService) {
            await messageBusService.notifyActionUpdate(
              payload.roomId,
              payload.world,
              payload.content,
              payload.messageId
            );
          }
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
    // providers.timeProvider,
    providers.providersProvider,
    providers.actionsProvider,
    providers.actionStateProvider,
    providers.characterProvider,
    providers.recentMessagesProvider,
  ],
  services: [TaskService, EmbeddingGenerationService],
};

export default bootstrapPlugin;
