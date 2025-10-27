import { Entity, logger, validateUuid } from '@elizaos/core';
import express from 'express';
import type { AgentServer } from '../../index';
import { sendError, sendSuccess } from '../shared/response-utils';
import { requireAuth, type AuthenticatedRequest } from '../../middleware';

/**
 * Entity management endpoints
 */
export function entitiesRouter(serverInstance: AgentServer): express.Router {
  const router = express.Router();
  const db = serverInstance?.database;

  // GET /entities/:entityId - Get entity by ID
  // SECURITY: Users can only get their own entity unless they're admin
  router.get('/:entityId', requireAuth, async (req: AuthenticatedRequest, res) => {
    const entityId = validateUuid(req.params.entityId);
    if (!entityId) {
      return sendError(res, 400, 'INVALID_ID', 'Invalid entity ID format');
    }

    if (!db) {
      return sendError(res, 500, 'DB_ERROR', 'Database not available');
    }

    // SECURITY: Check if user is requesting their own entity or is admin
    if (!req.isAdmin && entityId !== req.userId) {
      logger.warn(`[ENTITY GET] User ${req.userId} attempted to access entity ${entityId}`);
      return sendError(res, 403, 'FORBIDDEN', 'You can only access your own entity');
    }

    try {
      const entities = await db.getEntitiesByIds([entityId]);
      
      if (!entities || entities.length === 0) {
        return sendError(res, 404, 'NOT_FOUND', 'Entity not found');
      }

      sendSuccess(res, { entity: entities[0] });
    } catch (error) {
      logger.error(
        '[ENTITY GET] Error retrieving entity:',
        error instanceof Error ? error.message : String(error)
      );
      sendError(
        res,
        500,
        'INTERNAL_ERROR',
        'Error retrieving entity',
        error instanceof Error ? error.message : String(error)
      );
    }
  });

  // POST /entities - Create a new entity
  // SECURITY: Users can only create entities for themselves unless they're admin
  router.post('/', requireAuth, async (req: AuthenticatedRequest, res) => {
    const { id, agentId, names, metadata } = req.body;

    if (!id) {
      return sendError(res, 400, 'INVALID_REQUEST', 'Entity ID is required');
    }

    const entityId = validateUuid(id);
    if (!entityId) {
      return sendError(res, 400, 'INVALID_ID', 'Invalid entity ID format');
    }

    // SECURITY: Check if user is creating their own entity or is admin
    if (!req.isAdmin && entityId !== req.userId) {
      logger.warn(`[ENTITY CREATE] User ${req.userId} attempted to create entity ${entityId}`);
      return sendError(res, 403, 'FORBIDDEN', 'You can only create your own entity');
    }

    if (!agentId) {
      return sendError(res, 400, 'INVALID_REQUEST', 'Agent ID is required');
    }

    const validAgentId = validateUuid(agentId);
    if (!validAgentId) {
      return sendError(res, 400, 'INVALID_ID', 'Invalid agent ID format');
    }

    if (!db) {
      return sendError(res, 500, 'DB_ERROR', 'Database not available');
    }

    try {
      const entity: Entity = {
        id: entityId,
        agentId: validAgentId,
        names: names || [],
        metadata: metadata || {},
      };

      const result = await db.createEntities([entity]);
      
      if (!result) {
        return sendError(res, 500, 'CREATE_FAILED', 'Failed to create entity');
      }

      sendSuccess(res, { entity }, 201);
    } catch (error) {
      logger.error(
        '[ENTITY CREATE] Error creating entity:',
        error instanceof Error ? error.message : String(error)
      );
      sendError(
        res,
        500,
        'INTERNAL_ERROR',
        'Error creating entity',
        error instanceof Error ? error.message : String(error)
      );
    }
  });

  // PATCH /entities/:entityId - Update an entity
  // SECURITY: Users can only update their own entity unless they're admin
  router.patch('/:entityId', requireAuth, async (req: AuthenticatedRequest, res) => {
    const entityId = validateUuid(req.params.entityId);
    if (!entityId) {
      return sendError(res, 400, 'INVALID_ID', 'Invalid entity ID format');
    }

    // SECURITY: Check if user is updating their own entity or is admin
    if (!req.isAdmin && entityId !== req.userId) {
      logger.warn(`[ENTITY UPDATE] User ${req.userId} attempted to update entity ${entityId}`);
      return sendError(res, 403, 'FORBIDDEN', 'You can only update your own entity');
    }

    if (!db) {
      return sendError(res, 500, 'DB_ERROR', 'Database not available');
    }

    try {
      // First, check if entity exists
      const existing = await db.getEntitiesByIds([entityId]);
      
      if (!existing || existing.length === 0) {
        return sendError(res, 404, 'NOT_FOUND', 'Entity not found');
      }

      const existingEntity = existing[0];

      // Merge updates with existing entity
      const updatedEntity: Entity = {
        ...existingEntity,
        ...req.body,
        id: entityId, // Ensure ID doesn't change
      };

      await db.updateEntity(updatedEntity);

      // Fetch updated entity
      const updated = await db.getEntitiesByIds([entityId]);
      
      sendSuccess(res, { entity: updated?.[0] });
    } catch (error) {
      logger.error(
        '[ENTITY UPDATE] Error updating entity:',
        error instanceof Error ? error.message : String(error)
      );
      sendError(
        res,
        500,
        'INTERNAL_ERROR',
        'Error updating entity',
        error instanceof Error ? error.message : String(error)
      );
    }
  });

  // DELETE /entities/:entityId - Delete an entity
  // TODO: Uncomment when deleteEntity is added to DatabaseAdapter interface
  /*
  router.delete('/:entityId', async (req, res) => {
    const entityId = validateUuid(req.params.entityId);
    if (!entityId) {
      return sendError(res, 400, 'INVALID_ID', 'Invalid entity ID format');
    }

    if (!db) {
      return sendError(res, 500, 'DB_ERROR', 'Database not available');
    }

    try {
      await db.deleteEntity(entityId);
      sendSuccess(res, { success: true });
    } catch (error) {
      logger.error(
        '[ENTITY DELETE] Error deleting entity:',
        error instanceof Error ? error.message : String(error)
      );
      sendError(
        res,
        500,
        'INTERNAL_ERROR',
        'Error deleting entity',
        error instanceof Error ? error.message : String(error)
      );
    }
  });
  */

  return router;
}

