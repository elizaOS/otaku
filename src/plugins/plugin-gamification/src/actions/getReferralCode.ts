import type { Action, IAgentRuntime, Memory, State, HandlerCallback, ActionResult } from '@elizaos/core';
import { ReferralService } from '../services/ReferralService';

export const getReferralCodeAction: Action = {
  name: 'GET_REFERRAL_CODE',
  description: "Generate or retrieve the user's unique referral code",
  similes: ['REFERRAL_CODE', 'MY_REFERRAL', 'INVITE_LINK', 'SHARE_CODE'],

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
      const referralService = runtime.getService('referral') as ReferralService;
      if (!referralService) {
        const errorText = 'Referral service not available';
        await callback?.({
          text: errorText,
        });
        return {
          text: errorText,
          success: false,
        };
      }

      const { code, stats } = await referralService.getOrCreateCode(message.entityId);

      const text = `**Your Referral Code:** \`${code}\`

Share this link: https://otaku.so/?ref=${code}

**Stats:**
- Signups: ${stats.totalReferrals}
- Activated: ${stats.activatedReferrals}
- Points Earned: ${stats.totalPointsEarned.toLocaleString()}`;

      const data = { code, stats };

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
      const errorText = 'Error fetching referral code';
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

