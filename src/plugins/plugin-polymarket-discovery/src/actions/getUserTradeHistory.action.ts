/**
 * GET_POLYMARKET_TRADE_HISTORY Action
 *
 * Get user's trade history on Polymarket
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
import type { Trade } from "../types";
import {
  validatePolymarketService,
  getPolymarketService,
  extractActionParams,
  isValidEthereumAddress,
} from "../utils/actionHelpers";

interface GetUserTradeHistoryParams {
  walletAddress?: string;
  limit?: string | number;
}

type GetUserTradeHistoryInput = {
  walletAddress?: string;
  limit?: number;
};

type GetUserTradeHistoryActionResult = ActionResult & { input: GetUserTradeHistoryInput };

export const getUserTradeHistoryAction: Action = {
  name: "GET_POLYMARKET_TRADE_HISTORY",
  similes: [
    "POLYMARKET_TRADES",
    "MY_TRADES",
    "TRADE_HISTORY",
    "POLYMARKET_ACTIVITY",
    "RECENT_TRADES",
    "TRADING_HISTORY",
    "SHOW_TRADES",
  ],
  description:
    "Get user's trade history on Polymarket. Shows recent buy and sell activity with prices and timestamps.",

  parameters: {
    walletAddress: {
      type: "string",
      description: "Wallet address (EOA or proxy) to check trade history for",
      required: false,
    },
    limit: {
      type: "number",
      description: "Maximum number of trades to return (default: 20, max: 100)",
      required: false,
    },
  },

  validate: async (runtime: IAgentRuntime, message: Memory, state?: State) => {
    return validatePolymarketService(runtime, "GET_POLYMARKET_TRADE_HISTORY", state, message);
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    try {
      logger.info("[GET_POLYMARKET_TRADE_HISTORY] Getting user trade history");

      // Read parameters from state
      const params = await extractActionParams<GetUserTradeHistoryParams>(runtime, message);

      // Extract wallet address
      const walletAddress = params.walletAddress?.trim();

      if (!walletAddress) {
        const errorMsg = "Wallet address is required";
        logger.error(`[GET_POLYMARKET_TRADE_HISTORY] ${errorMsg}`);
        const errorResult: GetUserTradeHistoryActionResult = {
          text: ` ${errorMsg}. Please provide a wallet address to check trade history.`,
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

      // Validate address format (basic Ethereum address check)
      if (!isValidEthereumAddress(walletAddress)) {
        const errorMsg = `Invalid wallet address format: ${walletAddress}`;
        logger.error(`[GET_POLYMARKET_TRADE_HISTORY] ${errorMsg}`);
        const errorResult: GetUserTradeHistoryActionResult = {
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

      // Parse limit parameter
      let limit = 20; // default
      if (params.limit) {
        const parsedLimit =
          typeof params.limit === "string" ? parseInt(params.limit, 10) : params.limit;
        if (!isNaN(parsedLimit) && parsedLimit > 0) {
          limit = Math.min(parsedLimit, 100); // cap at 100
        }
      }

      const inputParams: GetUserTradeHistoryInput = { walletAddress, limit };

      // Get service
      const service = getPolymarketService(runtime);

      if (!service) {
        const errorMsg = "Polymarket service not available";
        logger.error(`[GET_POLYMARKET_TRADE_HISTORY] ${errorMsg}`);
        const errorResult: GetUserTradeHistoryActionResult = {
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

      // Fetch user trade history
      logger.info(`[GET_POLYMARKET_TRADE_HISTORY] Fetching ${limit} trades for ${walletAddress}`);
      const trades = await service.getUserTrades(walletAddress, limit);

      if (trades.length === 0) {
        const result: GetUserTradeHistoryActionResult = {
          text: ` No trade history found for wallet ${walletAddress}.`,
          success: true,
          data: { trades: [], count: 0 },
          input: inputParams,
        };
        return result;
      }

      // Format response
      let text = ` **Polymarket Trade History for ${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}**\n\n`;
      text += `Found ${trades.length} recent trade${trades.length > 1 ? "s" : ""}:\n\n`;

      trades.forEach((trade: Trade, index: number) => {
        const date = new Date(trade.timestamp * 1000);
        const price = parseFloat(trade.price);
        const size = parseFloat(trade.size);
        const total = price * size;

        const sideEmoji = trade.side === "BUY" ? "🟢" : "🔴";
        text += `**${index + 1}. ${sideEmoji} ${trade.side} ${trade.outcome}**\n`;
        text += `   Market: ${trade.market}\n`;
        text += `   Size: ${size.toFixed(2)} shares @ ${(price * 100).toFixed(1)}%\n`;
        text += `   Total: $${total.toFixed(2)}\n`;
        text += `   Date: ${date.toLocaleString()}\n`;

        if (trade.transaction_hash) {
          text += `   Tx: \`${trade.transaction_hash.slice(0, 10)}...${trade.transaction_hash.slice(-8)}\`\n`;
        }

        text += "\n";
      });

      // Calculate summary stats
      const buyTrades = trades.filter((t: Trade) => t.side === "BUY");
      const sellTrades = trades.filter((t: Trade) => t.side === "SELL");
      const totalVolume = trades.reduce((sum: number, t: Trade) => {
        return sum + parseFloat(t.price) * parseFloat(t.size);
      }, 0);

      text += `**Summary:**\n`;
      text += `   Buy Trades: ${buyTrades.length}\n`;
      text += `   Sell Trades: ${sellTrades.length}\n`;
      text += `   Total Volume: $${totalVolume.toFixed(2)}\n`;

      const result: GetUserTradeHistoryActionResult = {
        text,
        success: true,
        data: {
          trades: trades.map((t: Trade) => ({
            id: t.id,
            market: t.market,
            condition_id: t.condition_id,
            outcome: t.outcome,
            side: t.side,
            size: t.size,
            price: t.price,
            timestamp: t.timestamp,
            transaction_hash: t.transaction_hash,
          })),
          count: trades.length,
          buy_count: buyTrades.length,
          sell_count: sellTrades.length,
          total_volume: totalVolume.toFixed(2),
        },
        input: inputParams,
      };

      logger.info(
        `[GET_POLYMARKET_TRADE_HISTORY] Successfully fetched ${trades.length} trades`
      );
      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`[GET_POLYMARKET_TRADE_HISTORY] Error: ${errorMsg}`);
      const errorResult: ActionResult = {
        text: ` Failed to get trade history: ${errorMsg}`,
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
          text: "show my polymarket trade history for 0x1234567890123456789012345678901234567890",
        },
      },
      {
        name: "{{agent}}",
        content: {
          text: " Getting your trade history...",
          action: "GET_POLYMARKET_TRADE_HISTORY",
          walletAddress: "0x1234567890123456789012345678901234567890",
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: { text: "what are my recent polymarket trades?" },
      },
      {
        name: "{{agent}}",
        content: {
          text: " Fetching your recent trades...",
          action: "GET_POLYMARKET_TRADE_HISTORY",
          walletAddress: "0x1234567890123456789012345678901234567890",
          limit: 20,
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: { text: "show me my last 10 polymarket trades" },
      },
      {
        name: "{{agent}}",
        content: {
          text: " Getting your last 10 trades...",
          action: "GET_POLYMARKET_TRADE_HISTORY",
          walletAddress: "0x1234567890123456789012345678901234567890",
          limit: 10,
        },
      },
    ],
  ],
};

export default getUserTradeHistoryAction;
