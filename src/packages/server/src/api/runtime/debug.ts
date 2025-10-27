import express from 'express';
import type { AgentServer } from '../../index';
import { requireAuth, requireAdmin, type AuthenticatedRequest } from '../../middleware';

/**
 * Debug and diagnostic endpoints
 * SECURITY: All debug endpoints require admin access
 */
export function createDebugRouter(serverInstance: AgentServer): express.Router {
  const router = express.Router();

  // Require admin for all debug endpoints
  router.use(requireAuth, requireAdmin);

  // Debug endpoint to check message servers - ADMIN ONLY
  router.get('/servers', async (_req: AuthenticatedRequest, res) => {
    try {
      const servers = await serverInstance?.getServers();
      res.json({
        success: true,
        servers: servers || [],
        count: servers?.length || 0,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  return router;
}
