/**
 * GET_POLYMARKET_USER_ACTIVITY Action
 *
 * Get user's on-chain activity log (deposits, withdrawals, trades, redemptions)
 */

import {
  type Action,
  type IAgentRuntime,
  type Memory,
  type State,
  type HandlerCallback,
  type ActionResult,
  logger,
} from "@elizaos/core";
import { PolymarketService } from "../services/polymarket.service";
import { shouldPolymarketPluginBeInContext } from "../../matcher";
import type { UserActivity } from "../types";
import {
  validatePolymarketService,
  getPolymarketService,
  extractActionParams,
  isValidEthereumAddress,
  truncateAddress,
} from "../utils/actionHelpers";

interface GetUserActivityParams {
  walletAddress?: string;
}

type GetUserActivityInput = {
  walletAddress?: string;
};

type GetUserActivityActionResult = ActionResult & { input: GetUserActivityInput };

export const getUserActivityAction: Action = {
  name: "GET_POLYMARKET_USER_ACTIVITY",
  similes: [
    "POLYMARKET_ACTIVITY",
    "TRANSACTION_HISTORY",
    "ACCOUNT_ACTIVITY",
    "WALLET_ACTIVITY",
    "POLYMARKET_LOG",
    "ACCOUNT_HISTORY",
  ],
  description:
    "Get user's on-chain activity log for Polymarket. Shows deposits, withdrawals, trades, and redemptions.",

  parameters: {
    walletAddress: {
      type: "string",
      description: "Wallet address (EOA or proxy) to check activity for",
      required: false,
    },
  },

  validate: async (runtime: IAgentRuntime, message: Memory, state?: State) => {
    return validatePolymarketService(runtime, "GET_POLYMARKET_USER_ACTIVITY", state, message);
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    try {
      logger.info("[GET_POLYMARKET_USER_ACTIVITY] Getting user activity");

      // Read parameters from state
      const params = await extractActionParams<GetUserActivityParams>(runtime, message);

      // Extract wallet address
      const walletAddress = params.walletAddress?.trim();

      if (!walletAddress) {
        const errorMsg = "Wallet address is required";
        logger.error(`[GET_POLYMARKET_USER_ACTIVITY] ${errorMsg}`);
        const errorResult: GetUserActivityActionResult = {
          text: ` ${errorMsg}. Please provide a wallet address to check activity.`,
          success: false,
          error: "missing_wallet_address",
          input: { walletAddress },
        };
        callback?.({
          text: errorResult.text,
          content: { error: "missing_wallet_address", details: errorMsg },
        });
        return errorResult;
      }

      // Validate address format using viem
      if (!isValidEthereumAddress(walletAddress)) {
        const errorMsg = `Invalid wallet address format: ${walletAddress}`;
        logger.error(`[GET_POLYMARKET_USER_ACTIVITY] ${errorMsg}`);
        const errorResult: GetUserActivityActionResult = {
          text: ` ${errorMsg}`,
          success: false,
          error: "invalid_wallet_address",
          input: { walletAddress },
        };
        callback?.({
          text: errorResult.text,
          content: { error: "invalid_wallet_address", details: errorMsg },
        });
        return errorResult;
      }

      const inputParams: GetUserActivityInput = { walletAddress };

      // Get service
      const service = getPolymarketService(runtime);

      if (!service) {
        const errorMsg = "Polymarket service not available";
        logger.error(`[GET_POLYMARKET_USER_ACTIVITY] ${errorMsg}`);
        const errorResult: GetUserActivityActionResult = {
          text: ` ${errorMsg}`,
          success: false,
          error: "service_unavailable",
          input: inputParams,
        };
        callback?.({
          text: errorResult.text,
          content: { error: "service_unavailable", details: errorMsg },
        });
        return errorResult;
      }

      // Fetch user activity
      logger.info(`[GET_POLYMARKET_USER_ACTIVITY] Fetching activity for ${walletAddress}`);
      const activity = await service.getUserActivity(walletAddress);

      if (activity.length === 0) {
        const result: GetUserActivityActionResult = {
          text: ` No activity found for wallet ${walletAddress}.`,
          success: true,
          data: { activity: [], count: 0 },
          input: inputParams,
        };
        return result;
      }

      // Format response
      let text = ` **Polymarket Activity for ${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}**\n\n`;
      text += `Found ${activity.length} transaction${activity.length > 1 ? "s" : ""}:\n\n`;

      // Count by type
      const typeCounts = {
        DEPOSIT: 0,
        WITHDRAWAL: 0,
        TRADE: 0,
        REDEMPTION: 0,
      };

      activity.forEach((entry: UserActivity, index: number) => {
        typeCounts[entry.type]++;

        const icon = {
          DEPOSIT: "💵",
          WITHDRAWAL: "💸",
          TRADE: "🔄",
          REDEMPTION: "💰",
        }[entry.type];

        const date = new Date(entry.timestamp * 1000).toLocaleDateString();
        const time = new Date(entry.timestamp * 1000).toLocaleTimeString();

        text += `**${index + 1}. ${icon} ${entry.type}** - ${date} ${time}\n`;
        text += `   Amount: $${parseFloat(entry.amount).toFixed(2)}\n`;

        if (entry.market) {
          text += `   Market: ${entry.market}\n`;
        }

        if (entry.outcome) {
          text += `   Outcome: ${entry.outcome}\n`;
        }

        text += `   Status: ${entry.status}\n`;
        text += `   Tx: \`${entry.transaction_hash.slice(0, 10)}...${entry.transaction_hash.slice(-8)}\`\n`;
        text += "\n";
      });

      text += `**Summary:**\n`;
      text += `   Total Transactions: ${activity.length}\n`;
      text += `   Deposits: ${typeCounts.DEPOSIT} | Withdrawals: ${typeCounts.WITHDRAWAL}\n`;
      text += `   Trades: ${typeCounts.TRADE} | Redemptions: ${typeCounts.REDEMPTION}\n`;

      const result: GetUserActivityActionResult = {
        text,
        success: true,
        data: {
          activity: activity.map((a) => ({
            id: a.id,
            type: a.type,
            amount: a.amount,
            timestamp: a.timestamp,
            transaction_hash: a.transaction_hash,
            market: a.market,
            outcome: a.outcome,
            status: a.status,
          })),
          count: activity.length,
          type_counts: typeCounts,
        },
        input: inputParams,
      };

      logger.info(
        `[GET_POLYMARKET_USER_ACTIVITY] Successfully fetched ${activity.length} activity entries`
      );
      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`[GET_POLYMARKET_USER_ACTIVITY] Error: ${errorMsg}`);
      const errorResult: ActionResult = {
        text: ` Failed to get user activity: ${errorMsg}`,
        success: false,
        error: errorMsg,
      };
      callback?.({
        text: errorResult.text,
        content: { error: "fetch_failed", details: errorMsg },
      });
      return errorResult;
    }
  },

  examples: [
    [
      {
        name: "{{user}}",
        content: {
          text: "show my polymarket activity for 0x1234567890123456789012345678901234567890",
        },
      },
      {
        name: "{{agent}}",
        content: {
          text: " Getting your Polymarket activity log...",
          action: "GET_POLYMARKET_USER_ACTIVITY",
          walletAddress: "0x1234567890123456789012345678901234567890",
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: { text: "what's my polymarket transaction history?" },
      },
      {
        name: "{{agent}}",
        content: {
          text: " Checking your account activity...",
          action: "GET_POLYMARKET_USER_ACTIVITY",
          walletAddress: "0x1234567890123456789012345678901234567890",
        },
      },
    ],
  ],
};

export default getUserActivityAction;
