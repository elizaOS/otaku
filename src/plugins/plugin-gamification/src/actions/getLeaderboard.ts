import type { Action, IAgentRuntime, Memory, State, HandlerCallback, ActionResult } from '@elizaos/core';
import { GamificationService } from '../services/GamificationService';

export const getLeaderboardAction: Action = {
  name: 'GET_LEADERBOARD',
  description: 'Get the current leaderboard rankings',
  similes: ['LEADERBOARD', 'RANKINGS', 'TOP_USERS', 'LEADERBOARD_RANKINGS'],

  validate: async (runtime: IAgentRuntime, message: Memory): Promise<boolean> => {
    return true;
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    options?: Record<string, unknown>,
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    try {
      const gamificationService = runtime.getService('gamification') as GamificationService;
      if (!gamificationService) {
        const errorText = 'Gamification service not available';
        await callback?.({
          text: errorText,
        });
        return {
          text: errorText,
          success: false,
        };
      }

      // Default to weekly, but could parse scope from message
      const scope = (options?.scope as 'weekly' | 'all_time') || 'weekly';
      const limit = (options?.limit as number) || 10;

      const entries = await gamificationService.getLeaderboard(scope, limit);
      const userRank = await gamificationService.getUserRank(message.entityId, scope);

      let text = `**${scope === 'weekly' ? 'Weekly' : 'All-Time'} Leaderboard (Top ${limit}):**\n\n`;
      entries.forEach((entry) => {
        const displayName = entry.username || entry.levelName || `User ${entry.userId.substring(0, 8)}`;
        text += `${entry.rank}. ${displayName} - ${entry.points.toLocaleString()} pts\n`;
      });

      if (userRank > 0) {
        text += `\n**Your Rank:** #${userRank}`;
      }

      const data = { entries, userRank, scope };

      await callback?.({
        text,
        data,
      });

      return {
        text,
        success: true,
        data,
      };
    } catch (error) {
      const errorText = 'Error fetching leaderboard';
      await callback?.({
        text: errorText,
      });
      return {
        text: errorText,
        success: false,
      };
    }
  },
};

