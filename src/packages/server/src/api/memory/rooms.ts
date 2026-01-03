import type { ElizaOS, Room, UUID } from '@elizaos/core';
import { validateUuid, logger, createUniqueUuid, ChannelType } from '@elizaos/core';
import express from 'express';
import { sendError, sendSuccess } from '../shared/response-utils';
import { requireAuthenticated, checkRoomAccess, type AuthenticatedRequest } from '../../middleware';

interface CustomRequest extends AuthenticatedRequest {
  params: {
    agentId: string;
    roomId?: string;
  };
}

/**
 * Room management functionality for agents
 */
export function createRoomManagementRouter(elizaOS: ElizaOS): express.Router {
  const router = express.Router();

  // Create a new room for an agent
  // Authorization: Any authenticated user can create a room (they become a participant)
  router.post('/:agentId/rooms', requireAuthenticated(), async (req: AuthenticatedRequest, res) => {
    const agentId = validateUuid(req.params.agentId);
    if (!agentId) {
      return sendError(res, 400, 'INVALID_ID', 'Invalid agent ID format');
    }

    const runtime = elizaOS.getAgent(agentId);
    if (!runtime) {
      return sendError(res, 404, 'NOT_FOUND', 'Agent not found');
    }

    try {
      const { name, type = ChannelType.DM, source = 'client', worldId, metadata } = req.body;

      if (!name) {
        return sendError(res, 400, 'MISSING_PARAM', 'Room name is required');
      }

      const roomId = createUniqueUuid(runtime, `room-${Date.now()}`);
      const serverId = req.body.serverId || `server-${Date.now()}`;

      let resolvedWorldId = worldId;
      if (!resolvedWorldId) {
        const worldName = `World for ${name}`;
        resolvedWorldId = createUniqueUuid(runtime, `world-${Date.now()}`);

        await runtime.ensureWorldExists({
          id: resolvedWorldId,
          name: worldName,
          agentId: runtime.agentId,
          serverId: serverId,
          metadata: metadata,
        });
      }

      await runtime.ensureRoomExists({
        id: roomId,
        name: name,
        source: source,
        type: type,
        channelId: roomId,
        serverId: serverId,
        worldId: resolvedWorldId,
        metadata: {
          ...metadata,
          createdBy: req.userId, // Track who created the room
        },
      });

      // Add the agent as a participant
      await runtime.addParticipant(runtime.agentId, roomId);
      await runtime.ensureParticipantInRoom(runtime.agentId, roomId);
      await runtime.setParticipantUserState(roomId, runtime.agentId, 'FOLLOWED');

      // Add the creating user as a participant
      if (req.userId) {
        await runtime.addParticipant(req.userId as UUID, roomId);
        await runtime.ensureParticipantInRoom(req.userId as UUID, roomId);
        logger.info(`[ROOM CREATE] Added user ${req.userId} as participant to room ${roomId}`);
      }

      sendSuccess(
        res,
        {
          id: roomId,
          name: name,
          agentId: agentId,
          createdAt: Date.now(),
          source: source,
          type: type,
          worldId: resolvedWorldId,
          serverId: serverId,
          metadata: metadata,
        },
        201
      );
    } catch (error) {
      logger.error(
        `[ROOM CREATE] Error creating room for agent ${agentId}:`,
        error instanceof Error ? error.message : String(error)
      );
      sendError(
        res,
        500,
        'CREATE_ERROR',
        'Failed to create room',
        error instanceof Error ? error.message : String(error)
      );
    }
  });

  // Get all rooms where the authenticated user is a participant
  // Authorization: Users can only see rooms they are a participant of (or admin sees all)
  router.get('/:agentId/rooms', requireAuthenticated(), async (req: AuthenticatedRequest, res) => {
    const agentId = validateUuid(req.params.agentId);
    if (!agentId) {
      return sendError(res, 400, 'INVALID_ID', 'Invalid agent ID format');
    }

    const runtime = elizaOS.getAgent(agentId);
    if (!runtime) {
      return sendError(res, 404, 'NOT_FOUND', 'Agent not found');
    }

    try {
      const worlds = await runtime.getAllWorlds();
      const agentRooms: Room[] = [];

      // Get rooms where the USER is a participant (not just the agent)
      const userRoomIds = req.userId 
        ? await runtime.getRoomsForParticipant(req.userId as UUID)
        : [];

      for (const world of worlds) {
        const worldRooms = await runtime.getRooms(world.id);
        for (const room of worldRooms) {
          // Authorization: Only include rooms where user is a participant (or admin)
          const isParticipant = userRoomIds.includes(room.id);
          const isCreator = room.metadata?.createdBy === req.userId;
          
          if (req.isAdmin || isParticipant || isCreator) {
            agentRooms.push({
              ...room,
            });
          }
        }
      }

      sendSuccess(res, { rooms: agentRooms });
    } catch (error) {
      logger.error(
        `[ROOMS LIST] Error retrieving rooms for agent ${agentId}:`,
        error instanceof Error ? error.message : String(error)
      );
      sendError(
        res,
        500,
        'RETRIEVAL_ERROR',
        'Failed to retrieve agent rooms',
        error instanceof Error ? error.message : String(error)
      );
    }
  });

  // Get room details
  // Authorization: User must be a participant of the room (or admin)
  router.get('/:agentId/rooms/:roomId', requireAuthenticated(), async (req: CustomRequest, res: express.Response) => {
    const agentId = validateUuid(req.params.agentId);
    const roomId = validateUuid(req.params.roomId);

    if (!agentId || !roomId) {
      return sendError(res, 400, 'INVALID_ID', 'Invalid agent ID or room ID format');
    }

    // Get runtime
    const runtime = elizaOS.getAgent(agentId);
    if (!runtime) {
      return sendError(res, 404, 'NOT_FOUND', 'Agent not found');
    }

    try {
      // Authorization check using centralized utility
      const authResult = await checkRoomAccess(elizaOS, req.userId, agentId, roomId, { isAdmin: req.isAdmin });
      if (!authResult.authorized) {
        logger.warn(`[ROOM DETAILS] User ${req.userId} denied access to room ${roomId} - ${authResult.error}`);
        return sendError(res, 403, 'FORBIDDEN', authResult.error || 'Access denied');
      }

      const room = await runtime.getRoom(roomId);
      if (!room) {
        return sendError(res, 404, 'NOT_FOUND', 'Room not found');
      }

      // Enrich room data with world name
      let worldName: string | undefined;
      if (room.worldId) {
        const world = await runtime.getWorld(room.worldId);
        worldName = world?.name;
      }

      sendSuccess(res, {
        ...room,
        ...(worldName && { worldName }),
      });
    } catch (error) {
      logger.error(
        `[ROOM DETAILS] Error retrieving room ${roomId} for agent ${agentId}:`,
        error instanceof Error ? error.message : String(error)
      );
      sendError(
        res,
        500,
        'RETRIEVAL_ERROR',
        'Failed to retrieve room details',
        error instanceof Error ? error.message : String(error)
      );
    }
  });

  return router;
}
