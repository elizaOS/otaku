import type { ElizaOS, UUID, Memory, MemoryMetadata } from '@elizaos/core';
import { MemoryType, createUniqueUuid } from '@elizaos/core';
import { validateUuid, logger } from '@elizaos/core';
import express from 'express';
import { sendError, sendSuccess } from '../shared/response-utils';
import { requireAuthenticated, checkRoomAccess, type AuthenticatedRequest } from '../../middleware';

/**
 * Agent memory management functionality
 */
export function createAgentMemoryRouter(elizaOS: ElizaOS, _serverInstance?: any): express.Router {
  const router = express.Router();

  // Get memories for a specific room
  // Authorization: User must be a participant of the room (or admin)
  router.get('/:agentId/rooms/:roomId/memories', requireAuthenticated(), async (req: AuthenticatedRequest, res) => {
    const agentId = validateUuid(req.params.agentId);
    const roomId = validateUuid(req.params.roomId);

    if (!agentId || !roomId) {
      return sendError(res, 400, 'INVALID_ID', 'Invalid agent ID or room ID format');
    }

    // Authorization check
    const authResult = await checkRoomAccess(elizaOS, req.userId, agentId, roomId, { isAdmin: req.isAdmin });
    if (!authResult.authorized) {
      logger.warn(`[MEMORIES GET] User ${req.userId} denied access to room ${roomId} memories`);
      return sendError(res, 403, 'FORBIDDEN', authResult.error || 'Access denied');
    }

    const runtime = elizaOS.getAgent(agentId);

    if (!runtime) {
      return sendError(res, 404, 'NOT_FOUND', 'Agent not found');
    }

    try {
      const limit = req.query.limit ? Number.parseInt(req.query.limit as string, 10) : 20;
      const before = req.query.before
        ? Number.parseInt(req.query.before as string, 10)
        : Date.now();
      const includeEmbedding = req.query.includeEmbedding === 'true';
      const tableName = (req.query.tableName as string) || 'messages';

      const memories = await runtime.getMemories({
        tableName,
        roomId,
        count: limit,
        end: before,
      });

      const cleanMemories = includeEmbedding
        ? memories
        : memories.map((memory) => ({
            ...memory,
            embedding: undefined,
          }));

      sendSuccess(res, { memories: cleanMemories });
    } catch (error) {
      logger.error(
        '[MEMORIES GET] Error retrieving memories for room:',
        error instanceof Error ? error.message : String(error)
      );
      sendError(
        res,
        500,
        '500',
        'Failed to retrieve memories',
        error instanceof Error ? error.message : String(error)
      );
    }
  });

  // Get all memories for an agent
  // Authorization: If roomId/channelId specified, user must be participant. Otherwise, only returns memories from user's rooms.
  router.get('/:agentId/memories', requireAuthenticated(), async (req: AuthenticatedRequest, res) => {
    const agentId = validateUuid(req.params.agentId);

    if (!agentId) {
      return sendError(res, 400, 'INVALID_ID', 'Invalid agent ID');
    }

    const runtime = elizaOS.getAgent(agentId);
    if (!runtime) {
      return sendError(res, 404, 'NOT_FOUND', 'Agent not found');
    }

    try {
      const tableName = (req.query.tableName as string) || 'messages';
      const includeEmbedding = req.query.includeEmbedding === 'true';

      // Handle both roomId and channelId parameters
      let roomIdToUse: UUID | undefined;

      if (req.query.channelId) {
        // Convert channelId to the agent's unique roomId
        const channelId = validateUuid(req.query.channelId as string);
        if (!channelId) {
          return sendError(res, 400, 'INVALID_ID', 'Invalid channel ID format');
        }
        // Use createUniqueUuid to generate the same roomId the agent uses
        roomIdToUse = createUniqueUuid(runtime, channelId);
        logger.info(
          `[AGENT MEMORIES] Converting channelId ${channelId} to roomId ${roomIdToUse} for agent ${agentId}`
        );
      } else if (req.query.roomId) {
        // Backward compatibility: still accept roomId directly
        const roomId = validateUuid(req.query.roomId as string);
        if (!roomId) {
          return sendError(res, 400, 'INVALID_ID', 'Invalid room ID format');
        }
        roomIdToUse = roomId;
      }

      // Authorization: If specific room requested, check access
      if (roomIdToUse) {
        const authResult = await checkRoomAccess(elizaOS, req.userId, agentId, roomIdToUse, { isAdmin: req.isAdmin });
        if (!authResult.authorized) {
          logger.warn(`[AGENT MEMORIES] User ${req.userId} denied access to room ${roomIdToUse} memories`);
          return sendError(res, 403, 'FORBIDDEN', authResult.error || 'Access denied');
        }
      }

      // Get memories
      let memories = await runtime.getMemories({
        agentId,
        tableName,
        roomId: roomIdToUse,
      });

      // Authorization: If no specific room, filter to only user's rooms (unless admin)
      if (!roomIdToUse && !req.isAdmin && req.userId) {
        const userRoomIds = await runtime.getRoomsForParticipant(req.userId as UUID);
        memories = memories.filter(m => m.roomId && userRoomIds.includes(m.roomId));
        logger.debug(`[AGENT MEMORIES] Filtered memories to ${memories.length} from user's ${userRoomIds.length} rooms`);
      }

      const cleanMemories = includeEmbedding
        ? memories
        : memories.map((memory) => ({
            ...memory,
            embedding: undefined,
          }));
      sendSuccess(res, { memories: cleanMemories });
    } catch (error) {
      logger.error(
        `[AGENT MEMORIES] Error retrieving memories for agent ${agentId}:`,
        error instanceof Error ? error.message : String(error)
      );
      sendError(
        res,
        500,
        'MEMORY_ERROR',
        'Error retrieving agent memories',
        error instanceof Error ? error.message : String(error)
      );
    }
  });

  // Update a specific memory for an agent
  // Authorization: User must be a participant of the memory's room (or admin)
  router.patch('/:agentId/memories/:memoryId', requireAuthenticated(), async (req: AuthenticatedRequest, res) => {
    const agentId = validateUuid(req.params.agentId);
    const memoryId = validateUuid(req.params.memoryId);

    const { id: _idFromData, ...restOfMemoryData } = req.body;

    if (!agentId || !memoryId) {
      return sendError(res, 400, 'INVALID_ID', 'Invalid agent ID or memory ID format');
    }

    const runtime = elizaOS.getAgent(agentId);
    if (!runtime) {
      return sendError(res, 404, 'NOT_FOUND', 'Agent not found');
    }

    try {
      // First, get the memory to check authorization
      const existingMemories = await runtime.getMemories({ agentId });
      const existingMemory = existingMemories.find(m => m.id === memoryId);
      
      if (!existingMemory) {
        return sendError(res, 404, 'NOT_FOUND', 'Memory not found');
      }

      // Authorization: Check if user can access the memory's room
      // Memories without roomId are restricted to admins only (no room = no participant check possible)
      if (!existingMemory.roomId) {
        if (!req.isAdmin) {
          logger.warn(`[MEMORY UPDATE] User ${req.userId} denied access to update orphan memory ${memoryId} (no roomId)`);
          return sendError(res, 403, 'FORBIDDEN', 'Cannot modify memories without room association');
        }
      } else {
        const authResult = await checkRoomAccess(elizaOS, req.userId, agentId, existingMemory.roomId, { isAdmin: req.isAdmin });
        if (!authResult.authorized) {
          logger.warn(`[MEMORY UPDATE] User ${req.userId} denied access to update memory ${memoryId}`);
          return sendError(res, 403, 'FORBIDDEN', authResult.error || 'Access denied');
        }
      }

      // Construct memoryToUpdate ensuring it satisfies Partial<Memory> & { id: UUID }
      const memoryToUpdate: Partial<Memory> & { id: UUID; metadata?: MemoryMetadata } = {
        // Explicitly set the required id using the validated path parameter
        id: memoryId,
        // Spread other properties from the request body.
        // Cast to Partial<Memory> to align with the base type.
        ...(restOfMemoryData as Partial<Memory>),
        // If specific fields from restOfMemoryData need type assertion (e.g., to UUID),
        // they should be handled here or ensured by upstream validation.
        // For example, if agentId from body is always expected as UUID:
        agentId: restOfMemoryData.agentId
          ? validateUuid(restOfMemoryData.agentId as string) || undefined
          : agentId,
        roomId: restOfMemoryData.roomId
          ? validateUuid(restOfMemoryData.roomId as string) || undefined
          : undefined,
        entityId: restOfMemoryData.entityId
          ? validateUuid(restOfMemoryData.entityId as string) || undefined
          : undefined,
        worldId: restOfMemoryData.worldId
          ? validateUuid(restOfMemoryData.worldId as string) || undefined
          : undefined,
        // Ensure metadata, if provided, conforms to MemoryMetadata
        metadata: restOfMemoryData.metadata as MemoryMetadata | undefined,
      };

      // Remove undefined fields that might have been explicitly set to undefined by casting above,
      // if the updateMemory implementation doesn't handle them gracefully.
      Object.keys(memoryToUpdate).forEach((key) => {
        if ((memoryToUpdate as any)[key] === undefined) {
          delete (memoryToUpdate as any)[key];
        }
      });

      await runtime.updateMemory(memoryToUpdate);

      logger.success(`[MEMORY UPDATE] Successfully updated memory ${memoryId}`);
      sendSuccess(res, { id: memoryId, message: 'Memory updated successfully' });
    } catch (error) {
      logger.error(
        `[MEMORY UPDATE] Error updating memory ${memoryId}:`,
        error instanceof Error ? error.message : String(error)
      );
      sendError(
        res,
        500,
        'UPDATE_ERROR',
        'Failed to update memory',
        error instanceof Error ? error.message : String(error)
      );
    }
  });

  // Delete all memories for an agent
  // Authorization: ADMIN ONLY - this is a destructive operation across all rooms
  router.delete('/:agentId/memories', requireAuthenticated(), async (req: AuthenticatedRequest, res) => {
    try {
      const agentId = validateUuid(req.params.agentId);

      if (!agentId) {
        return sendError(res, 400, 'INVALID_ID', 'Invalid agent ID');
      }

      // Authorization: Admin only for bulk delete
      if (!req.isAdmin) {
        logger.warn(`[DELETE ALL AGENT MEMORIES] Non-admin user ${req.userId} attempted bulk memory delete`);
        return sendError(res, 403, 'FORBIDDEN', 'Administrator privileges required to delete all agent memories');
      }

      const runtime = elizaOS.getAgent(agentId);
      if (!runtime) {
        return sendError(res, 404, 'NOT_FOUND', 'Agent not found');
      }

      const deleted = (await runtime.getAllMemories()).length;
      await runtime.clearAllAgentMemories();

      logger.info(`[DELETE ALL AGENT MEMORIES] Admin ${req.username} deleted ${deleted} memories for agent ${agentId}`);
      sendSuccess(res, { deleted, message: 'All agent memories cleared successfully' });
    } catch (error) {
      logger.error(
        '[DELETE ALL AGENT MEMORIES] Error deleting all agent memories:',
        error instanceof Error ? error.message : String(error)
      );
      sendError(
        res,
        500,
        'DELETE_ERROR',
        'Error deleting all agent memories',
        error instanceof Error ? error.message : String(error)
      );
    }
  });

  // Delete all memories for a room
  // Authorization: User must be a participant of the room (or admin)
  router.delete('/:agentId/memories/all/:roomId', requireAuthenticated(), async (req: AuthenticatedRequest, res) => {
    try {
      const agentId = validateUuid(req.params.agentId);
      const roomId = validateUuid(req.params.roomId);

      if (!agentId) {
        return sendError(res, 400, 'INVALID_ID', 'Invalid agent ID');
      }

      if (!roomId) {
        return sendError(res, 400, 'INVALID_ID', 'Invalid room ID');
      }

      // Authorization check
      const authResult = await checkRoomAccess(elizaOS, req.userId, agentId, roomId, { isAdmin: req.isAdmin });
      if (!authResult.authorized) {
        logger.warn(`[DELETE ALL MEMORIES] User ${req.userId} denied access to delete room ${roomId} memories`);
        return sendError(res, 403, 'FORBIDDEN', authResult.error || 'Access denied');
      }

      const runtime = elizaOS.getAgent(agentId);
      if (!runtime) {
        return sendError(res, 404, 'NOT_FOUND', 'Agent not found');
      }

      await runtime.deleteAllMemories(roomId, MemoryType.MESSAGE);
      await runtime.deleteAllMemories(roomId, MemoryType.DOCUMENT);

      logger.info(`[DELETE ALL MEMORIES] User ${req.userId} deleted all memories for room ${roomId}`);
      res.status(204).send();
    } catch (error) {
      logger.error(
        '[DELETE ALL MEMORIES] Error deleting all memories:',
        error instanceof Error ? error.message : String(error)
      );
      sendError(
        res,
        500,
        'DELETE_ERROR',
        'Error deleting all memories',
        error instanceof Error ? error.message : String(error)
      );
    }
  });

  // Delete a specific memory for an agent
  // Authorization: User must be a participant of the memory's room (or admin)
  router.delete('/:agentId/memories/:memoryId', requireAuthenticated(), async (req: AuthenticatedRequest, res) => {
    try {
      const agentId = validateUuid(req.params.agentId);
      const memoryId = validateUuid(req.params.memoryId);

      if (!agentId || !memoryId) {
        return sendError(res, 400, 'INVALID_ID', 'Invalid agent ID or memory ID format');
      }

      const runtime = elizaOS.getAgent(agentId);
      if (!runtime) {
        return sendError(res, 404, 'NOT_FOUND', 'Agent not found');
      }

      // First, get the memory to check authorization
      const existingMemories = await runtime.getMemories({ agentId });
      const existingMemory = existingMemories.find(m => m.id === memoryId);
      
      if (!existingMemory) {
        return sendError(res, 404, 'NOT_FOUND', 'Memory not found');
      }

      // Authorization: Check if user can access the memory's room
      // Memories without roomId are restricted to admins only (no room = no participant check possible)
      if (!existingMemory.roomId) {
        if (!req.isAdmin) {
          logger.warn(`[DELETE MEMORY] User ${req.userId} denied access to delete orphan memory ${memoryId} (no roomId)`);
          return sendError(res, 403, 'FORBIDDEN', 'Cannot delete memories without room association');
        }
      } else {
        const authResult = await checkRoomAccess(elizaOS, req.userId, agentId, existingMemory.roomId, { isAdmin: req.isAdmin });
        if (!authResult.authorized) {
          logger.warn(`[DELETE MEMORY] User ${req.userId} denied access to delete memory ${memoryId}`);
          return sendError(res, 403, 'FORBIDDEN', authResult.error || 'Access denied');
        }
      }

      // Delete the specific memory
      await runtime.deleteMemory(memoryId);

      logger.info(`[DELETE MEMORY] User ${req.userId} deleted memory ${memoryId}`);
      sendSuccess(res, { message: 'Memory deleted successfully' });
    } catch (error) {
      logger.error(
        `[DELETE MEMORY] Error deleting memory ${req.params.memoryId}:`,
        error instanceof Error ? error.message : String(error)
      );
      sendError(
        res,
        500,
        'DELETE_ERROR',
        'Error deleting memory',
        error instanceof Error ? error.message : String(error)
      );
    }
  });

  return router;
}
