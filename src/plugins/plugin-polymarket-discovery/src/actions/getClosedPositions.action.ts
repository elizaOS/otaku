/**
 * GET_POLYMARKET_CLOSED_POSITIONS Action
 *
 * Get user's historical closed positions (resolved markets)
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
import type { ClosedPosition } from "../types";
import {
  validatePolymarketService,
  getPolymarketService,
  extractActionParams,
  isValidEthereumAddress,
  truncateAddress,
} from "../utils/actionHelpers";

interface GetClosedPositionsParams {
  walletAddress?: string;
}

type GetClosedPositionsInput = {
  walletAddress?: string;
};

type GetClosedPositionsActionResult = ActionResult & { input: GetClosedPositionsInput };

export const getClosedPositionsAction: Action = {
  name: "GET_POLYMARKET_CLOSED_POSITIONS",
  similes: [
    "POLYMARKET_HISTORY",
    "PAST_POSITIONS",
    "CLOSED_BETS",
    "RESOLVED_POSITIONS",
    "HISTORICAL_POLYMARKET",
    "PAST_TRADES",
  ],
  description:
    "Get user's historical closed positions in resolved Polymarket prediction markets. Shows past outcomes with win/loss and payouts.",

  parameters: {
    walletAddress: {
      type: "string",
      description: "Wallet address (EOA or proxy) to check closed positions for",
      required: false,
    },
  },

  validate: async (runtime: IAgentRuntime, message: Memory, state?: State) => {
    return validatePolymarketService(runtime, "GET_POLYMARKET_CLOSED_POSITIONS", state, message);
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    try {
      logger.info("[GET_POLYMARKET_CLOSED_POSITIONS] Getting closed positions");

      // Read parameters from state
      const params = await extractActionParams<GetClosedPositionsParams>(runtime, message);

      // Extract wallet address
      const walletAddress = params.walletAddress?.trim();

      if (!walletAddress) {
        const errorMsg = "Wallet address is required";
        logger.error(`[GET_POLYMARKET_CLOSED_POSITIONS] ${errorMsg}`);
        const errorResult: GetClosedPositionsActionResult = {
          text: ` ${errorMsg}. Please provide a wallet address to check closed positions.`,
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
        logger.error(`[GET_POLYMARKET_CLOSED_POSITIONS] ${errorMsg}`);
        const errorResult: GetClosedPositionsActionResult = {
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

      const inputParams: GetClosedPositionsInput = { walletAddress };

      // Get service
      const service = getPolymarketService(runtime);

      if (!service) {
        const errorMsg = "Polymarket service not available";
        logger.error(`[GET_POLYMARKET_CLOSED_POSITIONS] ${errorMsg}`);
        const errorResult: GetClosedPositionsActionResult = {
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

      // Fetch closed positions
      logger.info(`[GET_POLYMARKET_CLOSED_POSITIONS] Fetching closed positions for ${walletAddress}`);
      const closedPositions = await service.getClosedPositions(walletAddress);

      if (closedPositions.length === 0) {
        const result: GetClosedPositionsActionResult = {
          text: ` No closed positions found for wallet ${walletAddress}.`,
          success: true,
          data: { positions: [], count: 0 },
          input: inputParams,
        };
        return result;
      }

      // Format response
      let text = ` **Historical Polymarket Positions for ${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}**\n\n`;
      text += `Found ${closedPositions.length} resolved position${closedPositions.length > 1 ? "s" : ""}:\n\n`;

      // Calculate totals
      let totalPayout = 0;
      let totalPnl = 0;
      let winCount = 0;

      closedPositions.forEach((position: ClosedPosition, index: number) => {
        const payout = parseFloat(position.payout);
        const pnl = parseFloat(position.pnl);
        const won = position.won;

        totalPayout += payout;
        totalPnl += pnl;
        if (won) winCount++;

        const outcome = won ? "WON" : "LOST";
        const icon = won ? "✅" : "❌";

        text += `**${index + 1}. ${icon} ${outcome} - ${position.outcome} - ${position.market}**\n`;
        text += `   Size: ${parseFloat(position.size).toFixed(2)} shares @ ${(parseFloat(position.avg_price) * 100).toFixed(1)}% avg\n`;
        text += `   Settlement: ${(parseFloat(position.settlement_price) * 100).toFixed(0)}% | Payout: $${payout.toFixed(2)}\n`;

        const pnlSign = pnl >= 0 ? "+" : "";
        const pnlPercent = position.pnl_percentage;
        text += `   PnL: ${pnlSign}$${pnl.toFixed(2)} (${pnlSign}${pnlPercent}%)\n`;

        const closedDate = new Date(position.closed_at * 1000).toLocaleDateString();
        text += `   Closed: ${closedDate}\n`;
        text += "\n";
      });

      const winRate = ((winCount / closedPositions.length) * 100).toFixed(1);
      text += `**Summary:**\n`;
      text += `   Total Positions: ${closedPositions.length} (${winCount} won, ${closedPositions.length - winCount} lost)\n`;
      text += `   Win Rate: ${winRate}%\n`;
      text += `   Total Payout: $${totalPayout.toFixed(2)}\n`;
      const pnlSign = totalPnl >= 0 ? "+" : "";
      text += `   Total PnL: ${pnlSign}$${totalPnl.toFixed(2)}\n`;

      const result: GetClosedPositionsActionResult = {
        text,
        success: true,
        data: {
          positions: closedPositions.map((p) => ({
            market: p.market,
            condition_id: p.condition_id,
            outcome: p.outcome,
            size: p.size,
            avg_price: p.avg_price,
            settlement_price: p.settlement_price,
            pnl: p.pnl,
            pnl_percentage: p.pnl_percentage,
            payout: p.payout,
            won: p.won,
            closed_at: p.closed_at,
          })),
          count: closedPositions.length,
          win_count: winCount,
          win_rate: winRate,
          total_payout: totalPayout.toFixed(2),
          total_pnl: totalPnl.toFixed(2),
        },
        input: inputParams,
      };

      logger.info(
        `[GET_POLYMARKET_CLOSED_POSITIONS] Successfully fetched ${closedPositions.length} closed positions`
      );
      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`[GET_POLYMARKET_CLOSED_POSITIONS] Error: ${errorMsg}`);
      const errorResult: ActionResult = {
        text: ` Failed to get closed positions: ${errorMsg}`,
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
          text: "show my polymarket history for 0x1234567890123456789012345678901234567890",
        },
      },
      {
        name: "{{agent}}",
        content: {
          text: " Getting your closed Polymarket positions...",
          action: "GET_POLYMARKET_CLOSED_POSITIONS",
          walletAddress: "0x1234567890123456789012345678901234567890",
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: { text: "what were my past polymarket bets?" },
      },
      {
        name: "{{agent}}",
        content: {
          text: " Checking your historical positions...",
          action: "GET_POLYMARKET_CLOSED_POSITIONS",
          walletAddress: "0x1234567890123456789012345678901234567890",
        },
      },
    ],
  ],
};

export default getClosedPositionsAction;
