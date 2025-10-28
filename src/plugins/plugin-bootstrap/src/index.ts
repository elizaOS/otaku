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

export const multiStepDecisionTemplate = `<task>
Determine the next step the assistant should take in this conversation to help the user reach their goal.
</task>

{{system}}

---

{{time}}

---

{{recentMessages}}

---

# Current Execution Context
**Current Step**: {{iterationCount}} of {{maxIterations}} maximum iterations
**Actions Completed in THIS Execution Round**: {{traceActionResult.length}}

{{#if traceActionResult.length}}
⚠️ You have ALREADY taken {{traceActionResult.length}} action(s) in this execution round. Review them carefully before deciding next steps.
{{else}}
✓ This is your FIRST decision step - no actions have been taken yet in this round.
{{/if}}

---

# Decision Process (Follow in Order)

## 1. Understand Current State
- **Latest user message**: What is the user asking for RIGHT NOW? This is your primary objective.
- **Actions taken THIS round**: Review ***Actions Completed in This Round*** below. What have YOU already executed in THIS execution?
- **Completion check**: Has the user's request ALREADY been fulfilled in this round? If yes, set \`isFinish: true\`.

## 2. Check for Redundancy (CRITICAL - STOP CONDITION)
- **IF this is step 1 (no prior actions)**: Proceed with the user's request if it requires action.
- **IF you've already taken actions in THIS round**: 
  * Did you ALREADY complete what the user asked for?
  * If YES → Set \`isFinish: true\` immediately. Do NOT repeat the action.
  * If NO → Only proceed if the user's request requires MULTIPLE different actions.

## 3. Identify Missing Information
- Does the user's request require information you don't have?
- Have you already gathered this in a prior step of THIS round?

## 4. Choose Next Action
- Based on what you've ALREADY done in THIS round, what (if anything) is still needed?
- If the user asked for ONE action and you've completed it successfully → Set \`isFinish: true\`
- If the user asked for MULTIPLE things and some remain → Continue with the next action
- Extract parameters from the **latest user message first**, then results from THIS round.

---

{{actionsWithParams}}

---

# Actions Completed in This Round

{{#if traceActionResult.length}}
You have executed the following actions in THIS multi-step execution round:

{{actionResults}}

⚠️ **CRITICAL**: These are actions YOU took in this execution, not from earlier in the conversation.
- If the user's request has been satisfied by these actions, set \`isFinish: true\`
- Do NOT repeat an action unless it failed or the user explicitly asked for multiple executions

{{else}}
No actions have been executed yet in this round. This is your first decision step.
{{/if}}

---

# Decision Rules

1. **Step Awareness**: You are on step {{iterationCount}} of {{maxIterations}}. If step > 1, check what you've already done.
2. **Single vs Multiple Actions**: 
   - User says "send 0.05 ETH" → ONE action needed, once executed successfully, set isFinish: true
   - User says "get price of BTC and ETH then swap" → MULTIPLE actions needed, only set isFinish: true when ALL are done
3. **Check Before Acting**: Before executing ANY action, check if you've already done it in THIS round
4. **When to Finish**: Set isFinish: true when the ENTIRE user request is satisfied by actions in THIS round, not just one action
5. **Ground in Evidence**: Parameters must come from the latest message, not from prior round results

---

<keys>
"thought" 
START WITH: "Step {{iterationCount}}/{{maxIterations}}. Actions taken this round: {{traceActionResult.length}}."
THEN: Quote the latest user request.
THEN: If actions > 0, state "I have already completed: [list actions]. Remaining tasks: [list what's left, or 'none']."
THEN: Explain your decision:
  - If all tasks complete: "All requirements satisfied, setting isFinish: true to generate final response."
  - If more work needed: "Next action: [action name] because [reason]."
CRITICAL: Only set isFinish: true when the COMPLETE user request is fulfilled.

"action" Name of the action to execute (empty string "" if setting isFinish: true or if no action needed)
"parameters" JSON object with exact parameter names. Empty object {} if action has no parameters.
"isFinish" Set to true ONLY when the user's ENTIRE request is satisfied by actions taken in THIS round
</keys>

⚠️ CRITICAL STOP-CONDITION CHECKS:
- What step am I on? ({{iterationCount}}/{{maxIterations}})
- How many actions have I taken THIS round? ({{traceActionResult.length}})
- If > 0 actions: Have I completed ALL parts of the user's request? → If YES, set isFinish: true to exit loop
- Am I about to repeat an action I JUST did in THIS round? → If YES, STOP and set isFinish: true instead
- Does the user's request require ONE action or MULTIPLE? 
  * ONE action (e.g., "send ETH"): Execute → Next step set isFinish: true
  * MULTIPLE actions (e.g., "get price then swap"): Execute all → Then set isFinish: true

Your final output MUST be in this XML format:

<output>
<response>
  <thought>Step {{iterationCount}}/{{maxIterations}}. Actions taken this round: {{traceActionResult.length}}. [Your reasoning]</thought>
  <action>ACTION_NAME or ""</action>
  <parameters>
    {
      "param1": "value1",
      "param2": value2
    }
  </parameters>
  <isFinish>true | false</isFinish>
</response>
</output>`;

export const multiStepSummaryTemplate = `<task>
Generate a final, user-facing response based on what the assistant accomplished and the results obtained.
</task>

{{bio}}

---

{{system}}

---

{{messageDirections}}

---

{{time}}

---

{{recentMessages}}

---

{{actionResults}}

**These are the steps taken and their results. Use successful results to answer the user; acknowledge failures if relevant.**

---

{{actionsWithDescriptions}}

---

# Assistant's Last Reasoning Step
{{recentThought}}

---

# Instructions

1. **Review the latest user message**: What did they originally ask for?
2. **Check execution results**: What data/outcomes did the actions produce? Focus on successful results.
3. **Synthesize answer**: Provide a clear, direct response using the information gathered. If results are insufficient or actions failed, explain what happened and suggest next steps.
4. **Be concise and helpful**: Users want answers, not a list of what you did. Lead with the result, not the process.

**Tone**: Professional, direct, and focused on delivering value. Avoid overly technical jargon unless the user expects it.

Your final output MUST be in this XML format:
<output>
<response>
  <thought>Briefly summarize the user's request and the key results obtained. Note any gaps or issues.</thought>
  <text>Your direct, helpful answer to the user based on the results. Lead with the information they asked for.</text>
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
