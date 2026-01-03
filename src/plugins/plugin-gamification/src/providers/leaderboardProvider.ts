import type { Provider, IAgentRuntime, Memory, State, ProviderResult } from '@elizaos/core';
import { GamificationService } from '../services/GamificationService';

export const leaderboardProvider: Provider = {
  name: 'LEADERBOARD',
  description: 'Provides top users for leaderboard awareness',

  dynamic: true,
  get: async (runtime: IAgentRuntime, message: Memory, state?: State): Promise<ProviderResult> => {
    try {
      const gamificationService = runtime.getService('gamification') as GamificationService;
      if (!gamificationService) {
        return {
          text: 'Gamification service not available',
          values: {},
        };
      }

      const topUsers = await gamificationService.getLeaderboard('weekly', 5);
      const userRank = await gamificationService.getUserRank(message.entityId, 'weekly');

      return {
        text: `Current weekly leaderboard top 5. User's rank: #${userRank}`,
        values: { topUsers, userRank },
        data: {
          topUsers: topUsers.map((user) => ({
            rank: user.rank,
            points: user.points,
            level: user.level,
            levelName: user.levelName,
            username: user.username || `User #${user.rank}`,
          })),
          userRank,
        },
      };
    } catch (error) {
      return {
        text: 'Unable to fetch leaderboard',
        values: {},
      };
    }
  },
};

