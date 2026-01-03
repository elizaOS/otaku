import type { ElizaOS, UUID, Memory, MemoryMetadata } from '@elizaos/core';
import { MemoryType, createUniqueUuid } from '@elizaos/core';
import { validateUuid, logger } from '@elizaos/core';
import express from 'express';
import { sendError, sendSuccess } from '../shared/response-utils';
import { requireAuthenticated, type AuthenticatedRequest } from '../../middleware';

/**
 * Agent memory management functionality
 * 
 * Security:
 * - All endpoints require authentication
 * - Users can only access/modify their own memories
 * - Admin users and server-authenticated requests can access all memories
 */
export function createAgentMemoryRouter(elizaOS: ElizaOS, _serverInstance?: any): express.Router {
  const router = express.Router();

  /**
   * Helper to check if user has access to memories
   * Returns true if user can access all memories (admin/server), false for regular users
   */
  function hasUnrestrictedAccess(req: AuthenticatedRequest): boolean {
    return req.isServerAuthenticated === true || req.isAdmin === true;
  }

  /**
   * Filter memories to only include those belonging to the authenticated user
   * Admins and server-authenticated requests get all memories
   */
  function filterMemoriesByUser(memories: Memory[], req: AuthenticatedRequest): Memory[] {
    if (hasUnrestrictedAccess(req)) {
      return memories;
    }
    
    const userId = req.userId;
    if (!userId) {
      return [];
    }
    
    // Filter to only memories where the user is involved
    // Memories can be associated with a user via entityId or metadata.userId
    return memories.filter(memory => {
      // Check if the memory's entityId matches the user
      if (memory.entityId === userId) {
        return true;
      }
      // Check metadata for userId
      if (memory.metadata && (memory.metadata as any).userId === userId) {
        return true;
      }
      // Check if content contains source metadata with userId
      if (memory.content && typeof memory.content === 'object') {
        const content = memory.content as any;
        if (content.source?.userId === userId || content.authorId === userId) {
          return true;
        }
      }
      return false;
    });
  }

  /**
   * Check if user owns a specific memory
   */
  async function verifyMemoryOwnership(
    runtime: any,
    memoryId: UUID,
    req: AuthenticatedRequest
  ): Promise<{ owned: boolean; memory?: Memory }> {
    if (hasUnrestrictedAccess(req)) {
      return { owned: true };
    }
    
    const userId = req.userId;
    if (!userId) {
      return { owned: false };
    }
    
    // Try to get the memory to check ownership
    try {
      const memories = await runtime.getMemories({ agentId: runtime.agentId });
      const memory = memories.find((m: Memory) => m.id === memoryId);
      
      if (!memory) {
        // Memory not found - will be handled by caller
        return { owned: true, memory: undefined };
      }
      
      // Check ownership
      if (memory.entityId === userId) {
        return { owned: true, memory };
      }
      if (memory.metadata && (memory.metadata as any).userId === userId) {
        return { owned: true, memory };
      }
      if (memory.content && typeof memory.content === 'object') {
        const content = memory.content as any;
        if (content.source?.userId === userId || content.authorId === userId) {
          return { owned: true, memory };
        }
      }
      
      logger.warn(`[MEMORY ACCESS] User ${userId.substring(0, 8)}... denied access to memory ${memoryId}`);
      return { owned: false, memory };
    } catch (error) {
      logger.error('[MEMORY ACCESS] Error checking memory ownership:', error);
      return { owned: false };
    }
  }

  /**
   * Get memories for a specific room
   * GET /api/memory/:agentId/rooms/:roomId/memories
   * 
   * Security: Returns only memories belonging to the authenticated user,
   * unless the user is an admin or server-authenticated.
   */
  router.get('/:agentId/rooms/:roomId/memories', requireAuthenticated(), async (req: AuthenticatedRequest, res) => {
    const agentId = validateUuid(req.params.agentId);
    const roomId = validateUuid(req.params.roomId);

    if (!agentId || !roomId) {
      return sendError(res, 400, 'INVALID_ID', 'Invalid agent ID or room ID format');
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

      let memories = await runtime.getMemories({
        tableName,
        roomId,
        count: limit,
        end: before,
      });

      // Filter memories to only show user's own memories
      memories = filterMemoriesByUser(memories, req);

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

  /**
   * Get all memories for an agent
   * GET /api/memory/:agentId/memories
   * 
   * Security: Returns only memories belonging to the authenticated user,
   * unless the user is an admin or server-authenticated.
   */
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

      let memories = await runtime.getMemories({
        agentId,
        tableName,
        roomId: roomIdToUse,
      });

      // Filter memories to only show user's own memories
      memories = filterMemoriesByUser(memories, req);

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

  /**
   * Update a specific memory for an agent
   * PATCH /api/memory/:agentId/memories/:memoryId
   * 
   * Security: Users can only update their own memories.
   * Admins and server-authenticated requests can update any memory.
   */
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
      // Verify user owns this memory before allowing update
      const { owned } = await verifyMemoryOwnership(runtime, memoryId, req);
      if (!owned) {
        return sendError(res, 403, 'FORBIDDEN', 'You do not have permission to modify this memory');
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

  /**
   * Delete all memories for an agent
   * DELETE /api/memory/:agentId/memories
   * 
   * Security: Only admin users or server-authenticated requests can delete all memories.
   * Regular users cannot use this endpoint.
   */
  router.delete('/:agentId/memories', requireAuthenticated(), async (req: AuthenticatedRequest, res) => {
    try {
      const agentId = validateUuid(req.params.agentId);

      if (!agentId) {
        return sendError(res, 400, 'INVALID_ID', 'Invalid agent ID');
      }

      // Only allow admins/server to clear all memories
      if (!hasUnrestrictedAccess(req)) {
        logger.warn(`[DELETE ALL MEMORIES] User ${req.userId?.substring(0, 8)}... attempted to clear all agent memories`);
        return sendError(res, 403, 'FORBIDDEN', 'Only administrators can clear all agent memories');
      }

      const runtime = elizaOS.getAgent(agentId);
      if (!runtime) {
        return sendError(res, 404, 'NOT_FOUND', 'Agent not found');
      }

      const deleted = (await runtime.getAllMemories()).length;
      await runtime.clearAllAgentMemories();

      logger.info(`[DELETE ALL MEMORIES] Admin/server cleared ${deleted} memories for agent ${agentId}`);
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

  /**
   * Delete all memories for a room
   * DELETE /api/memory/:agentId/memories/all/:roomId
   * 
   * Security: Only admin users or server-authenticated requests can delete all room memories.
   * Regular users cannot use this endpoint.
   */
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

      // Only allow admins/server to clear all room memories
      if (!hasUnrestrictedAccess(req)) {
        logger.warn(`[DELETE ALL ROOM MEMORIES] User ${req.userId?.substring(0, 8)}... attempted to clear all room memories`);
        return sendError(res, 403, 'FORBIDDEN', 'Only administrators can clear all room memories');
      }

      const runtime = elizaOS.getAgent(agentId);
      if (!runtime) {
        return sendError(res, 404, 'NOT_FOUND', 'Agent not found');
      }

      await runtime.deleteAllMemories(roomId, MemoryType.MESSAGE);
      await runtime.deleteAllMemories(roomId, MemoryType.DOCUMENT);

      logger.info(`[DELETE ALL ROOM MEMORIES] Admin/server cleared memories for room ${roomId}`);
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

  /**
   * Delete a specific memory for an agent
   * DELETE /api/memory/:agentId/memories/:memoryId
   * 
   * Security: Users can only delete their own memories.
   * Admins and server-authenticated requests can delete any memory.
   */
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

      // Verify user owns this memory before allowing deletion
      const { owned } = await verifyMemoryOwnership(runtime, memoryId, req);
      if (!owned) {
        return sendError(res, 403, 'FORBIDDEN', 'You do not have permission to delete this memory');
      }

      // Delete the specific memory
      await runtime.deleteMemory(memoryId);

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
