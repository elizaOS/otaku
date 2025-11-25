import type { PluginEvents, ActionEventPayload, RunEventPayload, EntityPayload, ActionResult, UUID, Memory } from '@elizaos/core';
import { EventType, logger } from '@elizaos/core';
import { GamificationEventType, MESSAGE_LENGTH_TIERS, MIN_CHAT_LENGTH } from '../constants';
import { GamificationService } from '../services/GamificationService';
import { ReferralService } from '../services/ReferralService';

interface ActionResultWithValues extends ActionResult {
  values?: {
    volumeUsd?: number;
    valueUsd?: number;
    destinationChain?: string;
    toChain?: string;
    swapSuccess?: boolean;
  };
}

async function getUserIdFromMessage(runtime: ActionEventPayload['runtime'], messageId?: UUID, roomId?: UUID): Promise<UUID | null> {
  if (!messageId || !roomId) return null;
  
  try {
    const memories = await runtime.getMemories({
      tableName: 'messages',
      roomId,
      count: 100,
    });
    const message = memories.find((m: Memory) => m.id === messageId);
    return message?.entityId || null;
  } catch {
    return null;
  }
}

async function recordSwapPoints(payload: ActionEventPayload): Promise<void> {
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
    
    // Only award points for successful swaps
    if (!actionResult || actionResult.success !== true) {
      logger.debug('[Gamification] Skipping points for unsuccessful swap');
      return;
    }

    // Also check swapSuccess flag if present (for extra safety)
    if (actionResult.values?.swapSuccess === false) {
      logger.debug('[Gamification] Skipping points for swap marked as unsuccessful');
      return;
    }
    
    const volumeUsd = actionResult?.values?.volumeUsd || actionResult?.values?.valueUsd || 0;

    const userId = await getUserIdFromMessage(payload.runtime, payload.messageId, payload.roomId);
    if (!userId) return;

    await gamificationService.recordEvent({
      userId,
      actionType: GamificationEventType.SWAP_COMPLETED,
      volumeUsd,
      metadata: { actionResult },
      sourceEventId: payload.messageId,
    });
    
    return; // Return to prevent duplicate agent action points
  } catch (error) {
    logger.error({ error }, '[Gamification] Error recording swap points');
  }
}

async function recordBridgePoints(payload: ActionEventPayload): Promise<void> {
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
    
    // Only award points for successful bridges
    if (!actionResult || actionResult.success !== true) {
      logger.debug('[Gamification] Skipping points for unsuccessful bridge');
      return;
    }
    
    const volumeUsd = actionResult?.values?.volumeUsd || actionResult?.values?.valueUsd || 0;
    const chain = actionResult?.values?.destinationChain || actionResult?.values?.toChain;

    const userId = await getUserIdFromMessage(payload.runtime, payload.messageId, payload.roomId);
    if (!userId) return;

    await gamificationService.recordEvent({
      userId,
      actionType: GamificationEventType.BRIDGE_COMPLETED,
      volumeUsd,
      chain,
      metadata: { actionResult },
      sourceEventId: payload.messageId,
    });
    
    return; // Return to prevent duplicate agent action points
  } catch (error) {
    logger.error({ error }, '[Gamification] Error recording bridge points');
  }
}

async function recordTransferPoints(payload: ActionEventPayload): Promise<void> {
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
    
    // Only award points for successful transfers
    if (!actionResult || actionResult.success !== true) {
      logger.debug('[Gamification] Skipping points for unsuccessful transfer');
      return;
    }
    
    const valueUsd = actionResult?.values?.valueUsd || 0;

    if (valueUsd < 25) return;

    const userId = await getUserIdFromMessage(payload.runtime, payload.messageId, payload.roomId);
    if (!userId) return;

    await gamificationService.recordEvent({
      userId,
      actionType: GamificationEventType.TRANSFER_COMPLETED,
      volumeUsd: valueUsd,
      metadata: { actionResult },
      sourceEventId: payload.messageId,
    });
    
    return; // Return to prevent duplicate agent action points
  } catch (error) {
    logger.error({ error }, '[Gamification] Error recording transfer points');
  }
}

/**
 * Calculate points based on message length tiers
 */
function calculateChatPoints(messageLength: number): number {
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
        const memories = await payload.runtime.getMemories({
          tableName: 'messages',
          roomId: payload.roomId,
          count: 100,
        });
        const message = memories.find((m) => m.id === payload.messageId);
        input = message?.content?.text || '';
      }
    } catch (error) {
      // If we can't get the message, skip
      return;
    }

    const messageLength = input.length;
    const points = calculateChatPoints(messageLength);
    
    // Skip if message is too short or no points
    if (points === 0) return;

    const gamificationService = payload.runtime.getService('gamification') as GamificationService;
    if (!gamificationService) return;

    // Store the calculated points in metadata to override BASE_POINTS
    await gamificationService.recordEvent({
      userId: payload.entityId,
      actionType: GamificationEventType.MEANINGFUL_CHAT,
      metadata: { 
        inputLength: messageLength,
        tier: points,
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
    const gamificationService = payload.runtime.getService('gamification') as GamificationService;
    if (gamificationService) {
      await gamificationService.recordEvent({
        userId: payload.entityId,
        actionType: GamificationEventType.ACCOUNT_CREATION,
        metadata: { source: payload.source },
      });
    }

    // Process referral if present
    const referralService = payload.runtime.getService('referral') as ReferralService;
    if (referralService) {
      try {
        const entity = await payload.runtime.getEntityById(payload.entityId);
        const referredBy = entity?.metadata?.referredBy;
        
        if (referredBy && typeof referredBy === 'string') {
          logger.info(`[Gamification] Processing referral code ${referredBy} for user ${payload.entityId}`);
          await referralService.processReferralSignup(payload.entityId, referredBy);
        }
      } catch (err) {
        logger.error({ error: err }, '[Gamification] Error processing referral in account creation');
      }
    }
  } catch (error) {
    logger.error({ error }, '[Gamification] Error recording account creation points');
  }
}

export const gamificationEvents: PluginEvents = {
  [EventType.ACTION_COMPLETED]: [
    async (payload: ActionEventPayload) => {
      const actionName = payload.content?.actions?.[0];

      // Award specific action points
      if (actionName === 'USER_WALLET_SWAP') {
        await recordSwapPoints(payload);
        return; // Prevent double-counting
      } else if (actionName === 'EXECUTE_RELAY_BRIDGE' || actionName === 'RELAY_BRIDGE') {
        await recordBridgePoints(payload);
        return; // Prevent double-counting
      } else if (actionName === 'USER_WALLET_TOKEN_TRANSFER' || actionName === 'USER_WALLET_NFT_TRANSFER') {
        await recordTransferPoints(payload);
        return; // Prevent double-counting
      }

      // Award generic 10 points for any other successful action
      await recordAgentActionPoints(payload);
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

