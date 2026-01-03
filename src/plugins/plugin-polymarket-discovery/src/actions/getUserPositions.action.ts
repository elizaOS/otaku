/**
 * GET_POLYMARKET_POSITIONS Action
 *
 * Get user's current positions in Polymarket prediction markets
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
import type { Position as PolymarketPosition } from "../types";
import {
  validatePolymarketService,
  getPolymarketService,
  extractActionParams,
  isValidEthereumAddress,
  truncateAddress,
} from "../utils/actionHelpers";

interface GetUserPositionsParams {
  walletAddress?: string;
}

type GetUserPositionsInput = {
  walletAddress?: string;
};

type GetUserPositionsActionResult = ActionResult & { input: GetUserPositionsInput };

export const getUserPositionsAction: Action = {
  name: "GET_POLYMARKET_POSITIONS",
  similes: [
    "POLYMARKET_PORTFOLIO",
    "MY_POSITIONS",
    "POLYMARKET_HOLDINGS",
    "SHOW_POSITIONS",
    "MY_BETS",
    "PORTFOLIO_POSITIONS",
    "WHAT_AM_I_HOLDING",
  ],
  description:
    "Get user's current positions in Polymarket prediction markets. Shows active positions with current values and PnL.",

  parameters: {
    walletAddress: {
      type: "string",
      description: "Wallet address (EOA or proxy) to check positions for",
      required: false,
    },
  },

  validate: async (runtime: IAgentRuntime, message: Memory, state?: State) => {
    return validatePolymarketService(runtime, "GET_POLYMARKET_POSITIONS", state, message);
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    try {
      logger.info("[GET_POLYMARKET_POSITIONS] Getting user positions");

      // Read parameters from state
      const params = await extractActionParams<GetUserPositionsParams>(runtime, message);

      // Extract wallet address
      const walletAddress = params.walletAddress?.trim();

      if (!walletAddress) {
        const errorMsg = "Wallet address is required";
        logger.error(`[GET_POLYMARKET_POSITIONS] ${errorMsg}`);
        const errorResult: GetUserPositionsActionResult = {
          text: ` ${errorMsg}. Please provide a wallet address to check positions.`,
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
        logger.error(`[GET_POLYMARKET_POSITIONS] ${errorMsg}`);
        const errorResult: GetUserPositionsActionResult = {
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

      const inputParams: GetUserPositionsInput = { walletAddress };

      // Get service
      const service = getPolymarketService(runtime);

      if (!service) {
        const errorMsg = "Polymarket service not available";
        logger.error(`[GET_POLYMARKET_POSITIONS] ${errorMsg}`);
        const errorResult: GetUserPositionsActionResult = {
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

      // Fetch user positions
      logger.info(`[GET_POLYMARKET_POSITIONS] Fetching positions for ${walletAddress}`);
      const positions = await service.getUserPositions(walletAddress);

      if (positions.length === 0) {
        const result: GetUserPositionsActionResult = {
          text: ` No open positions found for wallet ${walletAddress}.`,
          success: true,
          data: { positions: [], count: 0 },
          input: inputParams,
        };
        return result;
      }

      // Format response
      let text = ` **Polymarket Positions for ${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}**\n\n`;
      text += `Found ${positions.length} active position${positions.length > 1 ? "s" : ""}:\n\n`;

      // Calculate totals
      let totalValue = 0;
      let totalPnl = 0;

      positions.forEach((position: PolymarketPosition, index: number) => {
        const value = position.currentValue || 0;
        const pnl = position.cashPnl || 0;

        totalValue += value;
        totalPnl += pnl;

        text += `**${index + 1}. ${position.outcome} - ${position.title}**\n`;
        text += `   Size: ${position.size.toFixed(2)} shares @ ${(position.avgPrice * 100).toFixed(1)}% avg\n`;
        text += `   Current: ${(position.curPrice * 100).toFixed(1)}% | Value: $${value.toFixed(2)}\n`;

        const pnlSign = pnl >= 0 ? "+" : "";
        const pnlPercent = position.percentPnl?.toFixed(2) || "0.00";
        text += `   PnL: ${pnlSign}$${pnl.toFixed(2)} (${pnlSign}${pnlPercent}%)\n`;

        text += `   Condition ID: \`${position.conditionId}\`\n`;
        text += "\n";
      });

      text += `**Summary:**\n`;
      text += `   Total Value: $${totalValue.toFixed(2)}\n`;
      const pnlSign = totalPnl >= 0 ? "+" : "";
      text += `   Total PnL: ${pnlSign}$${totalPnl.toFixed(2)}\n`;

      const result: GetUserPositionsActionResult = {
        text,
        success: true,
        data: {
          positions: positions.map((p) => ({
            title: p.title,
            conditionId: p.conditionId,
            outcome: p.outcome,
            size: p.size,
            avgPrice: p.avgPrice,
            curPrice: p.curPrice,
            currentValue: p.currentValue,
            cashPnl: p.cashPnl,
            percentPnl: p.percentPnl,
            realizedPnl: p.realizedPnl,
          })),
          count: positions.length,
          total_value: totalValue.toFixed(2),
          total_pnl: totalPnl.toFixed(2),
        },
        input: inputParams,
      };

      logger.info(
        `[GET_POLYMARKET_POSITIONS] Successfully fetched ${positions.length} positions`
      );
      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`[GET_POLYMARKET_POSITIONS] Error: ${errorMsg}`);
      const errorResult: ActionResult = {
        text: ` Failed to get positions: ${errorMsg}`,
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
          text: "show my polymarket positions for 0x1234567890123456789012345678901234567890",
        },
      },
      {
        name: "{{agent}}",
        content: {
          text: " Getting your Polymarket positions...",
          action: "GET_POLYMARKET_POSITIONS",
          walletAddress: "0x1234567890123456789012345678901234567890",
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: { text: "what am I holding on polymarket?" },
      },
      {
        name: "{{agent}}",
        content: {
          text: " Checking your Polymarket portfolio...",
          action: "GET_POLYMARKET_POSITIONS",
          walletAddress: "0x1234567890123456789012345678901234567890",
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: { text: "check my polymarket bets" },
      },
      {
        name: "{{agent}}",
        content: {
          text: " Fetching your active positions...",
          action: "GET_POLYMARKET_POSITIONS",
          walletAddress: "0x1234567890123456789012345678901234567890",
        },
      },
    ],
  ],
};

export default getUserPositionsAction;
