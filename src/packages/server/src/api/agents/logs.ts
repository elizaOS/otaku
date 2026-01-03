import type { ElizaOS, UUID, Log } from '@elizaos/core';
import { validateUuid, logger } from '@elizaos/core';
import express from 'express';
import { sendError, sendSuccess } from '../shared/response-utils';
import { requireAuth, requireAdmin, type AuthenticatedRequest } from '../../middleware';

/**
 * Agent logs management
 * 
 * Security:
 * - All endpoints require authentication
 * - GET logs requires auth (returns only user's relevant logs for regular users)
 * - DELETE logs requires admin privileges
 */
export function createAgentLogsRouter(elizaOS: ElizaOS): express.Router {
  const router = express.Router();

  /**
   * Get Agent Logs
   * GET /api/agents/:agentId/logs
   * 
   * Security: Requires authentication. Logs contain sensitive operational data.
   */
  router.get('/:agentId/logs', requireAuth, async (req: AuthenticatedRequest, res) => {
    const agentId = validateUuid(req.params.agentId);
    const { roomId, type, count, offset, excludeTypes } = req.query;
    if (!agentId) {
      return sendError(res, 400, 'INVALID_ID', 'Invalid agent ID format');
    }

    const runtime = elizaOS.getAgent(agentId);
    if (!runtime) {
      return sendError(res, 404, 'NOT_FOUND', 'Agent not found');
    }

    if (roomId) {
      const roomIdValidated = validateUuid(roomId as string);
      if (!roomIdValidated) {
        return sendError(res, 400, 'INVALID_ID', 'Invalid room ID format');
      }
    }

    try {
      const logs: Log[] = await runtime.getLogs({
        entityId: agentId,
        roomId: roomId ? (roomId as UUID) : undefined,
        type: type ? (type as string) : undefined,
        count: count ? Number(count) : undefined,
        offset: offset ? Number(offset) : undefined,
      });

      // Filter out excluded types if specified
      let filteredLogs = logs;
      if (excludeTypes) {
        const excludeTypesArray = Array.isArray(excludeTypes)
          ? (excludeTypes as string[])
          : [excludeTypes as string];

        filteredLogs = logs.filter((log) => {
          // Check the log type
          if (log.type && excludeTypesArray.includes(log.type)) {
            return false;
          }

          // Check the modelType in the log body for model-related operations
          if (log.body && typeof log.body === 'object') {
            const body = log.body as any;
            if (
              body.modelType &&
              excludeTypesArray.some((excludeType) =>
                body.modelType.toLowerCase().includes(excludeType.toLowerCase())
              )
            ) {
              return false;
            }
          }

          return true;
        });
      }

      // For non-admin users, filter logs to only show their own interactions
      const userId = req.userId;
      if (!req.isAdmin && userId) {
        filteredLogs = filteredLogs.filter((log) => {
          // Keep logs that are related to this user
          if (log.entityId === userId) return true;
          if (log.body && typeof log.body === 'object') {
            const body = log.body as any;
            if (body.userId === userId || body.entityId === userId) return true;
          }
          return false;
        });
      }

      logger.debug(`[AGENT LOGS] User ${userId?.substring(0, 8)}... retrieved ${filteredLogs.length} logs`);
      sendSuccess(res, filteredLogs);
    } catch (error) {
      logger.error(
        `[AGENT LOGS] Error retrieving logs for agent ${agentId}:`,
        error instanceof Error ? error.message : String(error)
      );
      sendError(
        res,
        500,
        'LOG_ERROR',
        'Error retrieving agent logs',
        error instanceof Error ? error.message : String(error)
      );
    }
  });

  /**
   * Delete specific log
   * DELETE /api/agents/:agentId/logs/:logId
   * 
   * Security: Requires admin privileges to prevent log tampering
   */
  router.delete('/:agentId/logs/:logId', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res) => {
    const agentId = validateUuid(req.params.agentId);
    const logId = validateUuid(req.params.logId);
    if (!agentId || !logId) {
      return sendError(res, 400, 'INVALID_ID', 'Invalid agent or log ID format');
    }

    const runtime = elizaOS.getAgent(agentId);
    if (!runtime) {
      return sendError(res, 404, 'NOT_FOUND', 'Agent not found');
    }

    try {
      await runtime.deleteLog(logId);
      logger.info(`[LOG DELETE] Admin ${req.userId?.substring(0, 8)}... deleted log ${logId}`);
      res.status(204).send();
    } catch (error) {
      logger.error(
        `[LOG DELETE] Error deleting log ${logId} for agent ${agentId}:`,
        error instanceof Error ? error.message : String(error)
      );
      sendError(
        res,
        500,
        'DELETE_ERROR',
        'Failed to delete log',
        error instanceof Error ? error.message : String(error)
      );
    }
  });

  return router;
}
