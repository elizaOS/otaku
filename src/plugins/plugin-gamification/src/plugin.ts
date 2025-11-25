import type { Plugin } from '@elizaos/core';
import { logger } from '@elizaos/core';
import type { IAgentRuntime } from '@elizaos/core';
import type { Request, Response } from 'express';
import { gamificationSchema } from './schema';
import { GamificationService } from './services/GamificationService';
import { ReferralService } from './services/ReferralService';
import { LeaderboardService } from './services/LeaderboardService';
import { pointsProvider } from './providers/pointsProvider';
import { leaderboardProvider } from './providers/leaderboardProvider';
import { getPointsSummaryAction } from './actions/getPointsSummary';
import { getReferralCodeAction } from './actions/getReferralCode';
import { getLeaderboardAction } from './actions/getLeaderboard';
import { gamificationEvents } from './events/eventHandlers';

// Leaderboard route handlers
async function handleGetLeaderboard(req: Request, res: Response, runtime: IAgentRuntime) {
  try {
    const scope = (req.query.scope as 'weekly' | 'all_time') || 'weekly';
    
    // Validate and limit input
    const rawLimit = parseInt(req.query.limit as string) || 50;
    const limit = Math.min(Math.max(1, rawLimit), 100); // Clamp between 1 and 100
    
    const userId = req.query.userId as string | undefined;

    // Validate scope
    if (scope !== 'weekly' && scope !== 'all_time') {
      return res.status(400).json({ error: 'Invalid scope. Must be "weekly" or "all_time"' });
    }

    const gamificationService = runtime.getService('gamification') as GamificationService;
    if (!gamificationService) {
      return res.status(503).json({ error: 'Gamification service not available' });
    }

    const entries = await gamificationService.getLeaderboard(scope, limit);
    
    let userRank = 0;
    if (userId) {
      userRank = await gamificationService.getUserRank(userId as any, scope);
    }

    res.json({
      scope,
      entries,
      userRank,
      limit,
    });
  } catch (error) {
    logger.error({ error }, '[GamificationPlugin] Error fetching leaderboard');
    res.status(500).json({ error: 'Error fetching leaderboard' });
  }
}

// User summary route handler
async function handleGetUserSummary(req: Request, res: Response, runtime: IAgentRuntime) {
  try {
    const userId = req.query.userId as string | undefined;

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const gamificationService = runtime.getService('gamification') as GamificationService;
    if (!gamificationService) {
      return res.status(503).json({ error: 'Gamification service not available' });
    }

    const summary = await gamificationService.getUserSummary(userId as any);
    res.json(summary);
  } catch (error) {
    logger.error({ error }, '[GamificationPlugin] Error fetching user summary');
    res.status(500).json({ error: 'Error fetching user summary' });
  }
}

export const gamificationPlugin: Plugin = {
  name: 'gamification',
  description: 'Points economy, leaderboards, and referral system for Otaku',

  schema: gamificationSchema,

  async init() {
    logger.info('*** Initializing Gamification plugin ***');
  },

  services: [GamificationService, ReferralService, LeaderboardService],

  actions: [getPointsSummaryAction, getReferralCodeAction, getLeaderboardAction],

  providers: [pointsProvider, leaderboardProvider],

  events: gamificationEvents,

  // Note: Plugin routes are automatically protected by the general API rate limit middleware
  // (1000 requests per 15 minutes per IP) applied in createApiRouter.
  // Additional input validation is performed in the handlers themselves.
  routes: [
    {
      path: '/leaderboard',
      type: 'GET',
      handler: handleGetLeaderboard,
    },
    {
      path: '/summary',
      type: 'GET',
      handler: handleGetUserSummary,
    },
  ],
};

export default gamificationPlugin;

