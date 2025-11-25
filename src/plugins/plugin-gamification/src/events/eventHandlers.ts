import type { PluginEvents, ActionEventPayload, RunEventPayload, EntityPayload, ActionResult, UUID, Memory } from '@elizaos/core';
import { EventType, logger } from '@elizaos/core';
import { GamificationEventType } from '../constants';
import { GamificationService } from '../services/GamificationService';
import { ReferralService } from '../services/ReferralService';

interface ActionResultWithValues extends ActionResult {
  values?: {
    volumeUsd?: number;
    valueUsd?: number;
    destinationChain?: string;
    toChain?: string;
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
  } catch (error) {
    logger.error({ error }, '[Gamification] Error recording transfer points');
  }
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

    if (input.length < 200) return;

    const gamificationService = payload.runtime.getService('gamification') as GamificationService;
    if (!gamificationService) return;

    await gamificationService.recordEvent({
      userId: payload.entityId,
      actionType: GamificationEventType.MEANINGFUL_CHAT,
      metadata: { inputLength: input.length },
      sourceEventId: payload.messageId,
    });
  } catch (error) {
    logger.error({ error }, '[Gamification] Error recording chat points');
  }
}

async function recordAccountCreationPoints(payload: EntityPayload): Promise<void> {
  try {
    const gamificationService = payload.runtime.getService('gamification') as GamificationService;
    if (!gamificationService) return;

    await gamificationService.recordEvent({
      userId: payload.entityId,
      actionType: GamificationEventType.ACCOUNT_CREATION,
      metadata: { source: payload.source },
    });
  } catch (error) {
    logger.error({ error }, '[Gamification] Error recording account creation points');
  }
}

export const gamificationEvents: PluginEvents = {
  [EventType.ACTION_COMPLETED]: [
    async (payload: ActionEventPayload) => {
      const actionName = payload.content?.actions?.[0];

      if (actionName === 'USER_WALLET_SWAP') {
        await recordSwapPoints(payload);
      } else if (actionName === 'EXECUTE_RELAY_BRIDGE' || actionName === 'RELAY_BRIDGE') {
        await recordBridgePoints(payload);
      } else if (actionName === 'USER_WALLET_TOKEN_TRANSFER' || actionName === 'USER_WALLET_NFT_TRANSFER') {
        await recordTransferPoints(payload);
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

