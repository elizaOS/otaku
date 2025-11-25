import type { Plugin } from '@elizaos/core';
import { logger } from '@elizaos/core';
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
};

export default gamificationPlugin;

