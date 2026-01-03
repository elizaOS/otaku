import {
  type ActionEventPayload,
  ChannelType,
  type Content,
  type ControlMessage,
  createUniqueUuid,
  type EntityPayload,
  type EvaluatorEventPayload,
  EventType,
  type IAgentRuntime,
  logger,
  type Plugin,
  PluginEvents,
  Role,
  type RunEventPayload,
  Service,
  type UUID,
  type WorldPayload,
} from '@elizaos/core';

import * as evaluators from './evaluators/index.js';
import * as providers from './providers/index.js';

import { TaskService } from './services/task.js';
import { EmbeddingGenerationService } from './services/embedding.js';
import { OtakuMessageService } from './services/otaku-message-service.js';

// Export the message service for external use
export { OtakuMessageService };

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

/**
 * NOTE: Message handling has been migrated to service-based architecture.
 * 
 * MESSAGE_RECEIVED, VOICE_MESSAGE_RECEIVED, MESSAGE_DELETED, and CHANNEL_CLEARED
 * events are no longer handled here. Instead, the OtakuMessageService handles
 * all message processing directly via runtime.messageService.
 * 
 * This aligns with ElizaOS 1.7.0+ architecture where DefaultMessageService
 * (or custom implementations like OtakuMessageService) handle the message flow.
 */

const events: PluginEvents = {
  // Message handling events removed - now handled by OtakuMessageService directly
  // See OtakuMessageService.handleMessage(), .deleteMessage(), .clearChannel()

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
        payload.metadata.type as ChannelType,
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

/**
 * Service that installs OtakuMessageService after runtime.initialize() completes.
 * 
 * IMPORTANT: This must be a service (not plugin.init) because:
 * - Plugin.init runs during runtime.initialize()
 * - runtime.initialize() overwrites messageService with DefaultMessageService AFTER all plugins init
 * - Service.start() runs AFTER runtime.initialize() completes
 * 
 * This ensures our custom message service is the final assignment and isn't overwritten.
 */
class MessageServiceInstaller extends Service {
  static serviceType = 'otaku-message-installer';
  capabilityDescription = 'Installs the custom OtakuMessageService after runtime initialization';

  static async start(runtime: IAgentRuntime): Promise<Service> {
    const service = new MessageServiceInstaller(runtime);
    
    // Replace DefaultMessageService with our custom implementation
    // This runs AFTER runtime.initialize() so it won't be overwritten
    runtime.logger.info('[Bootstrap] Installing OtakuMessageService (post-initialization)');
    runtime.messageService = new OtakuMessageService();
    runtime.logger.info('[Bootstrap] OtakuMessageService installed successfully');
    
    return service;
  }

  static async stop(_runtime: IAgentRuntime): Promise<void> {
    // Nothing to clean up
  }

  // Instance stop method required by Service abstract class
  async stop(): Promise<void> {
    // Nothing to clean up
  }
}

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
  // MessageServiceInstaller MUST be first to install our custom service before other services start
  services: [MessageServiceInstaller, TaskService, EmbeddingGenerationService],
};

export default bootstrapPlugin;
