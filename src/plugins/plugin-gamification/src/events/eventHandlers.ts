import type { PluginEvents, ActionEventPayload, RunEventPayload, EntityPayload, ActionResult, UUID, Memory } from '@elizaos/core';
import { EventType, logger } from '@elizaos/core';
import { GamificationEventType, MESSAGE_LENGTH_TIERS, MIN_CHAT_LENGTH, MIN_TRANSFER_VALUE_USD } from '../constants';
import { GamificationService } from '../services/GamificationService';
import { ReferralService } from '../services/ReferralService';
import { checkContentQuality } from '../utils/contentQuality';

interface ActionResultWithValues extends ActionResult {
  values?: {
    volumeUsd?: number;
    valueUsd?: number;
    destinationChain?: string;
    toChain?: string;
    swapSuccess?: boolean;
  };
}

/**
 * Validate and sanitize volume USD value
 * Returns 0 for invalid/negative values
 */
function validateVolumeUsd(volume: unknown): number {
  const num = Number(volume);
  return Number.isFinite(num) && num >= 0 ? num : 0;
}

async function getUserIdFromMessage(runtime: ActionEventPayload['runtime'], messageId?: UUID, roomId?: UUID, entityId?: UUID): Promise<UUID | null> {
  // Helper to resolve the actual user ID from an entity (handles agent-scoped entities)
  const resolveActualUserId = async (id: UUID): Promise<UUID | null> => {
    try {
      const entity = await runtime.getEntityById(id);
      if (!entity) return null;
      
      // If entity has author_id in metadata, it's an agent-scoped entity - use the actual user ID
      if (entity.metadata?.author_id && typeof entity.metadata.author_id === 'string') {
        const actualUserId = entity.metadata.author_id as UUID;
        // Verify the actual user entity exists
        const userEntity = await runtime.getEntityById(actualUserId);
        if (userEntity) {
          return actualUserId;
        }
      }
      
      // Otherwise, use the entity ID directly (it's already the user entity)
      return id;
    } catch {
      return null;
    }
  };

  // Check entityId first (most efficient)
  if (entityId) {
    return await resolveActualUserId(entityId);
  }
  
  if (!messageId || !roomId) return null;
  
  try {
    // Try to get message directly if possible (more efficient than fetching 100)
    // For now, fallback to fetching memories, but limit to smaller count
    const memories = await runtime.getMemories({
      tableName: 'messages',
      roomId,
      count: 50, // Reduced from 100
    });
    const message = memories.find((m: Memory) => m.id === messageId);
    if (!message?.entityId) return null;
    
    return await resolveActualUserId(message.entityId);
  } catch {
    return null;
  }
}

async function recordSwapPoints(payload: ActionEventPayload): Promise<boolean> {
  try {
    const gamificationService = payload.runtime.getService('gamification') as GamificationService;
    if (!gamificationService) return false;

    // Handle both actionResults (array) and actionResult (single) formats
    const actionResults = payload.content?.actionResults;
    const actionResultSingle = payload.content?.actionResult;
    const actionResult: ActionResultWithValues | undefined = 
      Array.isArray(actionResults) && actionResults.length > 0 
        ? (actionResults[0] as ActionResultWithValues)
        : actionResultSingle 
          ? (actionResultSingle as ActionResultWithValues)
          : undefined;
    
    // Only award points for successful swaps
    if (!actionResult || actionResult.success !== true) {
      logger.debug('[Gamification] Skipping points for unsuccessful swap');
      return false;
    }

    // Also check swapSuccess flag if present (for extra safety)
    if (actionResult.values?.swapSuccess === false) {
      logger.debug('[Gamification] Skipping points for swap marked as unsuccessful');
      return false;
    }
    
    // Validate volumeUsd to prevent negative/NaN values
    // Use ?? instead of || to preserve valid zero values
    const volumeUsd = validateVolumeUsd(actionResult?.values?.volumeUsd ?? actionResult?.values?.valueUsd);

    const userId = await getUserIdFromMessage(payload.runtime, payload.messageId, payload.roomId);
    if (!userId) return false;

    await gamificationService.recordEvent({
      userId,
      actionType: GamificationEventType.SWAP_COMPLETED,
      volumeUsd,
      metadata: { actionResult },
      sourceEventId: payload.messageId,
    });
    
    return true; // Return true to indicate we handled this action
  } catch (error) {
    logger.error({ error }, '[Gamification] Error recording swap points');
    return false;
  }
}

async function recordBridgePoints(payload: ActionEventPayload): Promise<boolean> {
  try {
    const gamificationService = payload.runtime.getService('gamification') as GamificationService;
    if (!gamificationService) return false;

    // Handle both actionResults (array) and actionResult (single) formats
    const actionResults = payload.content?.actionResults;
    const actionResultSingle = payload.content?.actionResult;
    const actionResult: ActionResultWithValues | undefined = 
      Array.isArray(actionResults) && actionResults.length > 0 
        ? (actionResults[0] as ActionResultWithValues)
        : actionResultSingle 
          ? (actionResultSingle as ActionResultWithValues)
          : undefined;
    
    // Only award points for successful bridges
    if (!actionResult || actionResult.success !== true) {
      logger.debug('[Gamification] Skipping points for unsuccessful bridge');
      return false;
    }
    
    // Validate volumeUsd to prevent negative/NaN values
    // Use ?? instead of || to preserve valid zero values
    const volumeUsd = validateVolumeUsd(actionResult?.values?.volumeUsd ?? actionResult?.values?.valueUsd);
    const chain = actionResult?.values?.destinationChain ?? actionResult?.values?.toChain;

    const userId = await getUserIdFromMessage(payload.runtime, payload.messageId, payload.roomId);
    if (!userId) return false;

    await gamificationService.recordEvent({
      userId,
      actionType: GamificationEventType.BRIDGE_COMPLETED,
      volumeUsd,
      chain,
      metadata: { actionResult },
      sourceEventId: payload.messageId,
    });
    
    return true; // Return true to indicate we handled this action
  } catch (error) {
    logger.error({ error }, '[Gamification] Error recording bridge points');
    return false;
  }
}

async function recordTransferPoints(payload: ActionEventPayload): Promise<boolean> {
  try {
    const gamificationService = payload.runtime.getService('gamification') as GamificationService;
    if (!gamificationService) return false;

    // Handle both actionResults (array) and actionResult (single) formats
    const actionResults = payload.content?.actionResults;
    const actionResultSingle = payload.content?.actionResult;
    const actionResult: ActionResultWithValues | undefined = 
      Array.isArray(actionResults) && actionResults.length > 0 
        ? (actionResults[0] as ActionResultWithValues)
        : actionResultSingle 
          ? (actionResultSingle as ActionResultWithValues)
          : undefined;
    
    // Only award points for successful transfers
    if (!actionResult || actionResult.success !== true) {
      logger.debug('[Gamification] Skipping points for unsuccessful transfer');
      return false;
    }
    
    // Validate valueUsd to prevent negative/NaN values
    const valueUsd = validateVolumeUsd(actionResult?.values?.valueUsd);

    // Use constant instead of magic number
    if (valueUsd < MIN_TRANSFER_VALUE_USD) return false;

    const userId = await getUserIdFromMessage(payload.runtime, payload.messageId, payload.roomId);
    if (!userId) return false;

    await gamificationService.recordEvent({
      userId,
      actionType: GamificationEventType.TRANSFER_COMPLETED,
      volumeUsd: valueUsd,
      metadata: { actionResult },
      sourceEventId: payload.messageId,
    });
    
    return true; // Return true to indicate we handled this action
  } catch (error) {
    logger.error({ error }, '[Gamification] Error recording transfer points');
    return false;
  }
}

/**
 * Calculate points based on message length tiers
 */
function calculateChatPoints(messageLength: number): number {
  // Validate input
  if (!Number.isFinite(messageLength) || messageLength < 0) {
    return 0;
  }
  
  if (messageLength < MIN_CHAT_LENGTH) return 0;
  
  for (const tier of MESSAGE_LENGTH_TIERS) {
    if (messageLength >= tier.minLength && messageLength <= tier.maxLength) {
      return tier.points;
    }
  }
  
  return 0;
}

async function recordChatPoints(payload: RunEventPayload): Promise<void> {
  try {
    if (payload.status !== 'completed') return;

    // Get message text from the message itself
    let input = '';
    try {
      if (payload.messageId) {
        // Try to get message directly if possible (more efficient)
        // For now, use smaller count to reduce overhead
        const memories = await payload.runtime.getMemories({
          tableName: 'messages',
          roomId: payload.roomId,
          count: 50, // Reduced from 100
        });
        const message = memories.find((m) => m.id === payload.messageId);
        input = message?.content?.text || '';
      }
    } catch (error) {
      // If we can't get the message, skip
      logger.debug({ error }, '[Gamification] Could not fetch message for chat points');
      return;
    }

    const messageLength = input.length;
    const points = calculateChatPoints(messageLength);
    
    // Skip if message is too short or no points
    if (points === 0) return;

    // Check content quality to prevent spam/copy-pasta from earning points
    const qualityResult = checkContentQuality(input);
    if (!qualityResult.isValid) {
      logger.debug(
        { 
          reason: qualityResult.reason, 
          score: qualityResult.score,
          messagePreview: input.substring(0, 50),
        },
        '[Gamification] Message failed content quality check, no points awarded'
      );
      return;
    }

    const gamificationService = payload.runtime.getService('gamification') as GamificationService;
    if (!gamificationService) return;

    // Resolve actual user ID (handles agent-scoped entities)
    const userId = await getUserIdFromMessage(payload.runtime, payload.messageId, payload.roomId);
    if (!userId) return;

    // Store the calculated points in metadata to override BASE_POINTS
    await gamificationService.recordEvent({
      userId,
      actionType: GamificationEventType.MEANINGFUL_CHAT,
      metadata: { 
        inputLength: messageLength,
        tier: points,
        contentQualityScore: qualityResult.score,
      },
      sourceEventId: payload.messageId,
    });
  } catch (error) {
    logger.error({ error }, '[Gamification] Error recording chat points');
  }
}

async function recordAgentActionPoints(payload: ActionEventPayload): Promise<void> {
  try {
    const gamificationService = payload.runtime.getService('gamification') as GamificationService;
    if (!gamificationService) return;

    // Handle both actionResults (array) and actionResult (single) formats
    const actionResults = payload.content?.actionResults;
    const actionResultSingle = payload.content?.actionResult;
    const actionResult: ActionResultWithValues | undefined = 
      Array.isArray(actionResults) && actionResults.length > 0 
        ? (actionResults[0] as ActionResultWithValues)
        : actionResultSingle 
          ? (actionResultSingle as ActionResultWithValues)
          : undefined;
    
    // Only award points for successful actions
    if (!actionResult || actionResult.success !== true) {
      return;
    }

    const userId = await getUserIdFromMessage(payload.runtime, payload.messageId, payload.roomId);
    if (!userId) return;

    const actionName = payload.content?.actions?.[0] || 'unknown';

    await gamificationService.recordEvent({
      userId,
      actionType: GamificationEventType.AGENT_ACTION,
      metadata: { 
        actionName,
        actionResult,
      },
      sourceEventId: payload.messageId,
    });
  } catch (error) {
    logger.error({ error }, '[Gamification] Error recording agent action points');
  }
}

async function recordAccountCreationPoints(payload: EntityPayload): Promise<void> {
  try {
    // Resolve actual user ID (handles agent-scoped entities)
    const userId = await getUserIdFromMessage(payload.runtime, undefined, undefined, payload.entityId);
    if (!userId) return;

    const gamificationService = payload.runtime.getService('gamification') as GamificationService;
    if (gamificationService) {
      await gamificationService.recordEvent({
        userId,
        actionType: GamificationEventType.ACCOUNT_CREATION,
        metadata: { source: payload.source },
      });
    }

    // Process referral if present
    const referralService = payload.runtime.getService('referral') as ReferralService;
    if (referralService) {
      try {
        // Use the actual user entity for referral processing
        const entity = await payload.runtime.getEntityById(userId);
        const referredBy = entity?.metadata?.referredBy;
        
        if (referredBy && typeof referredBy === 'string') {
          logger.info(`[Gamification] Processing referral code ${referredBy} for user ${userId}`);
          await referralService.processReferralSignup(userId, referredBy);
        }
      } catch (err) {
        logger.error({ error: err }, '[Gamification] Error processing referral in account creation');
      }
    }
  } catch (error) {
    logger.error({ error }, '[Gamification] Error recording account creation points');
  }
}

/**
 * Action names that trigger swap points
 * - USER_WALLET_SWAP: Legacy CDP swap
 * - MEE_FUSION_SWAP: Biconomy gasless cross-chain swap
 */
const SWAP_ACTIONS = ['USER_WALLET_SWAP', 'MEE_FUSION_SWAP'];

/**
 * Action names that trigger bridge points
 * - EXECUTE_RELAY_BRIDGE, RELAY_BRIDGE: Relay bridge actions
 */
const BRIDGE_ACTIONS = ['EXECUTE_RELAY_BRIDGE', 'RELAY_BRIDGE'];

/**
 * Action names that trigger transfer points
 * - USER_WALLET_TOKEN_TRANSFER, USER_WALLET_NFT_TRANSFER: Legacy CDP transfers
 * - BICONOMY_WITHDRAW: Biconomy withdrawal to external address
 */
const TRANSFER_ACTIONS = ['USER_WALLET_TOKEN_TRANSFER', 'USER_WALLET_NFT_TRANSFER', 'BICONOMY_WITHDRAW'];

export const gamificationEvents: PluginEvents = {
  [EventType.ACTION_COMPLETED]: [
    async (payload: ActionEventPayload) => {
      const actionName = payload.content?.actions?.[0];

      // Award specific action points
      let handled = false;
      if (actionName && SWAP_ACTIONS.includes(actionName)) {
        handled = await recordSwapPoints(payload);
      } else if (actionName && BRIDGE_ACTIONS.includes(actionName)) {
        handled = await recordBridgePoints(payload);
      } else if (actionName && TRANSFER_ACTIONS.includes(actionName)) {
        handled = await recordTransferPoints(payload);
      }

      // Only award generic 10 points if no specific handler processed this action
      if (!handled) {
        await recordAgentActionPoints(payload);
      }
    },
  ],

  [EventType.RUN_ENDED]: [
    async (payload: RunEventPayload) => {
      if (payload.status === 'completed') {
        await recordChatPoints(payload);
      }
    },
  ],

  [EventType.ENTITY_JOINED]: [
    async (payload: EntityPayload) => {
      await recordAccountCreationPoints(payload);
    },
  ],
};

