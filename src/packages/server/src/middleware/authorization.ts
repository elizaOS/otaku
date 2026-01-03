import type { Response, NextFunction } from 'express';
import type { UUID, ElizaOS } from '@elizaos/core';
import { logger, validateUuid } from '@elizaos/core';
import type { AuthenticatedRequest } from './jwt';

/**
 * Authorization middleware for resource-based access control.
 * 
 * Authentication verifies WHO you are (identity).
 * Authorization verifies WHAT you can do (permissions).
 * 
 * This module provides middleware for:
 * - Self-or-admin access (users can only access their own resources)
 * - Room participant access (users can only access rooms they're in)
 * - Generic resource ownership checks
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Function to get the owner/participant IDs for a resource
 */
type ResourceOwnerResolver = (
  req: AuthenticatedRequest,
  resourceId: UUID
) => Promise<UUID | UUID[] | null>;

/**
 * Options for authorization middleware
 */
interface AuthorizationOptions {
  /** Allow admins to bypass the check */
  allowAdmin?: boolean;
  /** Custom error message */
  errorMessage?: string;
  /** Log level for access denials */
  logLevel?: 'warn' | 'info' | 'debug';
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Send a 403 Forbidden response
 */
function sendForbidden(res: Response, message: string): void {
  res.status(403).json({
    success: false,
    error: {
      code: 'FORBIDDEN',
      message,
    },
  });
}

/**
 * Send a 400 Bad Request response
 */
function sendBadRequest(res: Response, message: string): void {
  res.status(400).json({
    success: false,
    error: {
      code: 'BAD_REQUEST',
      message,
    },
  });
}

// ============================================================================
// Utility Functions (for in-handler authorization checks)
// ============================================================================

/**
 * Result of a room authorization check
 */
export interface RoomAuthorizationResult {
  authorized: boolean;
  error?: string;
}

/**
 * Check if a user is authorized to access a room.
 * 
 * Use this utility function for in-handler authorization checks when you need
 * more control than the middleware provides.
 * 
 * @param elizaOS - The ElizaOS instance
 * @param userId - The user ID to check
 * @param agentId - The agent ID for the room
 * @param roomId - The room ID to check access for
 * @param options - Authorization options
 * 
 * @example
 * const authResult = await checkRoomAccess(elizaOS, req.userId, agentId, roomId);
 * if (!authResult.authorized) {
 *   return sendError(res, 403, 'FORBIDDEN', authResult.error);
 * }
 */
export async function checkRoomAccess(
  elizaOS: ElizaOS,
  userId: string | undefined,
  agentId: UUID,
  roomId: UUID,
  options: { isAdmin?: boolean } = {}
): Promise<RoomAuthorizationResult> {
  // Admins can access everything
  if (options.isAdmin) {
    return { authorized: true };
  }

  if (!userId) {
    return { authorized: false, error: 'Authentication required' };
  }

  const runtime = elizaOS.getAgent(agentId);
  if (!runtime) {
    return { authorized: false, error: 'Agent not found' };
  }

  try {
    // Check if room exists
    const room = await runtime.getRoom(roomId);
    if (!room) {
      return { authorized: false, error: 'Room not found' };
    }

    // Check if user is a participant
    const participants = await runtime.getParticipantsForRoom(roomId);
    const participantIds = participants.map(p => p.id);
    const isParticipant = participantIds.includes(userId as UUID);
    const isCreator = room.metadata?.createdBy === userId;

    if (isParticipant || isCreator) {
      return { authorized: true };
    }

    return { authorized: false, error: 'You are not a participant of this room' };
  } catch (error) {
    logger.error('[Authorization] Error checking room access:', error);
    return { authorized: false, error: 'Unable to verify room access' };
  }
}

// ============================================================================
// Core Authorization Middleware
// ============================================================================

/**
 * Require that the authenticated user is accessing their own resource or is an admin.
 * 
 * Use this for user-specific data like profiles, settings, personal data.
 * 
 * @param userIdParam - The request parameter containing the user ID to check (default: 'userId')
 * @param options - Authorization options
 * 
 * @example
 * // User can only get their own profile
 * router.get('/users/:userId/profile', requireAuth, requireSelfOrAdmin('userId'), handler);
 * 
 * // User can only update their own settings
 * router.patch('/users/:userId/settings', requireAuth, requireSelfOrAdmin('userId'), handler);
 */
export function requireSelfOrAdmin(
  userIdParam: string = 'userId',
  options: AuthorizationOptions = {}
) {
  const { allowAdmin = true, errorMessage, logLevel = 'warn' } = options;

  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const targetUserId = req.params[userIdParam] || req.query[userIdParam] as string;
    
    if (!targetUserId) {
      return sendBadRequest(res, `Missing required parameter: ${userIdParam}`);
    }

    const validTargetId = validateUuid(targetUserId);
    if (!validTargetId) {
      return sendBadRequest(res, `Invalid ${userIdParam} format`);
    }

    // Check if user is accessing their own resource
    if (req.userId === validTargetId) {
      return next();
    }

    // Check if admin bypass is allowed
    if (allowAdmin && req.isAdmin) {
      logger[logLevel === 'warn' ? 'debug' : logLevel](
        `[Authorization] Admin ${req.username} accessing user ${validTargetId} resource`
      );
      return next();
    }

    // Access denied
    logger[logLevel](
      `[Authorization] User ${req.userId} denied access to user ${validTargetId} resource`
    );
    
    return sendForbidden(
      res,
      errorMessage || 'You can only access your own resources'
    );
  };
}

/**
 * Require that the authenticated user is a participant of the specified room.
 * 
 * Use this for room-based resources like messages, memories, room settings.
 * 
 * @param elizaOS - The ElizaOS instance to check participants
 * @param roomIdParam - The request parameter containing the room ID (default: 'roomId')
 * @param agentIdParam - The request parameter containing the agent ID (default: 'agentId')
 * @param options - Authorization options
 * 
 * @example
 * // User can only access memories in rooms they're a participant of
 * router.get('/:agentId/rooms/:roomId/memories', 
 *   requireAuth, 
 *   requireRoomParticipant(elizaOS), 
 *   handler
 * );
 */
export function requireRoomParticipant(
  elizaOS: ElizaOS,
  roomIdParam: string = 'roomId',
  agentIdParam: string = 'agentId',
  options: AuthorizationOptions = {}
) {
  const { allowAdmin = true, errorMessage, logLevel = 'warn' } = options;

  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const roomId = validateUuid(req.params[roomIdParam] || req.query[roomIdParam] as string);
    const agentId = validateUuid(req.params[agentIdParam] || req.query[agentIdParam] as string);

    if (!roomId) {
      return sendBadRequest(res, `Missing or invalid ${roomIdParam}`);
    }

    if (!agentId) {
      return sendBadRequest(res, `Missing or invalid ${agentIdParam}`);
    }

    // Admin bypass
    if (allowAdmin && req.isAdmin) {
      logger.debug(`[Authorization] Admin ${req.username} accessing room ${roomId}`);
      return next();
    }

    // Get the agent runtime
    const runtime = elizaOS.getAgent(agentId);
    if (!runtime) {
      return sendBadRequest(res, 'Agent not found');
    }

    try {
      // Check if the room exists
      const room = await runtime.getRoom(roomId);
      if (!room) {
        return sendForbidden(res, errorMessage || 'Room not found or access denied');
      }

      // Get participants of the room
      const participants = await runtime.getParticipantsForRoom(roomId);
      const participantIds = participants.map(p => p.id);

      // Check if user is a participant
      if (req.userId && participantIds.includes(req.userId as UUID)) {
        return next();
      }

      // Check if user's entity is a participant (user might have a different entity ID)
      // This handles cases where the user's entity in the room has a different ID
      const userEntityIds = participants
        .filter(p => p.metadata?.userId === req.userId)
        .map(p => p.id);
      
      if (userEntityIds.length > 0) {
        return next();
      }

      // Access denied
      logger[logLevel](
        `[Authorization] User ${req.userId} denied access to room ${roomId} - not a participant`
      );
      
      return sendForbidden(
        res,
        errorMessage || 'You must be a participant of this room'
      );
    } catch (error) {
      logger.error(
        '[Authorization] Error checking room participation:',
        error instanceof Error ? error.message : String(error)
      );
      return sendForbidden(res, 'Unable to verify room access');
    }
  };
}

/**
 * Require that the authenticated user owns the resource or is an admin.
 * 
 * Generic middleware for checking resource ownership using a resolver function.
 * 
 * @param resourceIdParam - The request parameter containing the resource ID
 * @param ownerResolver - Function to resolve the owner(s) of the resource
 * @param options - Authorization options
 * 
 * @example
 * // Custom ownership check
 * router.delete('/documents/:documentId',
 *   requireAuth,
 *   requireResourceOwner('documentId', async (req, docId) => {
 *     const doc = await db.getDocument(docId);
 *     return doc?.ownerId;
 *   }),
 *   handler
 * );
 */
export function requireResourceOwner(
  resourceIdParam: string,
  ownerResolver: ResourceOwnerResolver,
  options: AuthorizationOptions = {}
) {
  const { allowAdmin = true, errorMessage, logLevel = 'warn' } = options;

  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const resourceId = validateUuid(req.params[resourceIdParam] || req.query[resourceIdParam] as string);

    if (!resourceId) {
      return sendBadRequest(res, `Missing or invalid ${resourceIdParam}`);
    }

    // Admin bypass
    if (allowAdmin && req.isAdmin) {
      logger.debug(`[Authorization] Admin ${req.username} accessing resource ${resourceId}`);
      return next();
    }

    try {
      const ownerIds = await ownerResolver(req, resourceId);

      if (ownerIds === null) {
        return sendForbidden(res, errorMessage || 'Resource not found or access denied');
      }

      const ownerIdArray = Array.isArray(ownerIds) ? ownerIds : [ownerIds];

      if (req.userId && ownerIdArray.includes(req.userId as UUID)) {
        return next();
      }

      // Access denied
      logger[logLevel](
        `[Authorization] User ${req.userId} denied access to resource ${resourceId}`
      );
      
      return sendForbidden(
        res,
        errorMessage || 'You do not have access to this resource'
      );
    } catch (error) {
      logger.error(
        '[Authorization] Error checking resource ownership:',
        error instanceof Error ? error.message : String(error)
      );
      return sendForbidden(res, 'Unable to verify resource access');
    }
  };
}

/**
 * Require that the user is accessing their own entity data.
 * 
 * Convenience wrapper for entity-specific checks where entityId should match userId.
 * 
 * @param entityIdParam - The request parameter containing the entity ID (default: 'entityId')
 * @param options - Authorization options
 */
export function requireOwnEntity(
  entityIdParam: string = 'entityId',
  options: AuthorizationOptions = {}
) {
  return requireSelfOrAdmin(entityIdParam, {
    ...options,
    errorMessage: options.errorMessage || 'You can only access your own entity',
  });
}

// Note: requireAll/requireAny were removed as they added complexity with mock responses.
// For composing authorization checks, use the utility functions (checkRoomAccess, etc.)
// directly in your handlers, or chain middleware in route definitions.
