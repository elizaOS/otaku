import type { Action, IAgentRuntime, Memory, State, HandlerCallback, ActionResult } from '@elizaos/core';
import { GamificationService } from '../services/GamificationService';

export const getPointsSummaryAction: Action = {
  name: 'GET_POINTS_SUMMARY',
  description: "Get the user's current points, level, streak, and recent awards",
  similes: ['CHECK_POINTS', 'MY_POINTS', 'POINTS_BALANCE', 'SHOW_LEVEL'],

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

      const summary = await gamificationService.getUserSummary(message.entityId);

      const text = `**Your Points Summary**
- **Total Points:** ${summary.allTimePoints.toLocaleString()}
- **This Week:** ${summary.weeklyPoints.toLocaleString()}
- **Level:** ${summary.levelName} (${summary.level})
- **Daily Streak:** ${summary.streakDays} days${
        summary.nextMilestone
          ? `\n- **Next Milestone:** ${summary.nextMilestone.pointsNeeded.toLocaleString()} points to ${summary.nextMilestone.levelName}`
          : ''
      }`;

      await callback?.({
        text,
        data: summary,
      });

      return {
        text,
        success: true,
        data: summary,
      };
    } catch (error) {
      const errorText = 'Error fetching points summary';
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

