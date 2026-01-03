/**
 * GET_POLYMARKET_ORDERBOOK Action
 *
 * Get orderbook depth for a single token with bid/ask summary
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
import { extractActionParams, validatePolymarketService, getPolymarketService } from "../utils/actionHelpers";

interface GetOrderbookParams {
  tokenId?: string;
  token_id?: string;
  side?: "BUY" | "SELL";
}

type GetOrderbookInput = {
  token_id: string;
  side?: "BUY" | "SELL";
};

type GetOrderbookActionResult = ActionResult & { input: GetOrderbookInput };

export const getOrderbookAction: Action = {
  name: "GET_POLYMARKET_ORDERBOOK",
  similes: [
    "POLYMARKET_ORDERBOOK",
    "CHECK_ORDERBOOK",
    "ORDERBOOK_DEPTH",
    "MARKET_DEPTH",
    "BID_ASK_DEPTH",
  ],
  description:
    "Get orderbook depth (bids/asks) for a Polymarket outcome token. IMPORTANT: Requires token_id (NOT condition_id). Get token_id from SEARCH_POLYMARKETS (yes_token_id/no_token_id fields) or GET_POLYMARKET_DETAIL (tokens.yes_token_id/tokens.no_token_id). Each market has TWO tokens: YES and NO - use the one you want orderbook for.",

  parameters: {
    token_id: {
      type: "string",
      description: "The ERC1155 token ID for YES or NO outcome. This is a large numeric string (e.g., '15974786252393396629980467963784550802583781222733347534844974829144359265969'). Get this from SEARCH_POLYMARKETS or GET_POLYMARKET_DETAIL. This is different from condition_id!",
      required: true,
    },
    side: {
      type: "string",
      description: "Optional: Filter to BUY or SELL side only. BUY shows buyers, SELL shows sellers.",
      required: false,
    },
  },

  validate: async (runtime: IAgentRuntime, message: Memory, state?: State) => {
    return validatePolymarketService(runtime, "GET_POLYMARKET_ORDERBOOK", state, message);
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    try {
      logger.info("[GET_POLYMARKET_ORDERBOOK] Getting orderbook");

      // Extract parameters
      const params = await extractActionParams<GetOrderbookParams>(runtime, message);

      // Normalize token_id (support both snake_case and camelCase)
      const tokenId = (params.token_id || params.tokenId)?.trim();

      if (!tokenId) {
        const errorMsg = "Token ID is required";
        logger.error(`[GET_POLYMARKET_ORDERBOOK] ${errorMsg}`);
        const errorResult: GetOrderbookActionResult = {
          text: ` ${errorMsg}. Please provide the ERC1155 conditional token ID.`,
          success: false,
          error: "missing_token_id",
          input: { token_id: "" },
        };
        callback?.({
          text: errorResult.text,
          content: { error: "missing_token_id", details: errorMsg },
        });
        return errorResult;
      }

      // Validate token ID format
      // Token IDs can be either:
      // 1. Large decimal numbers (e.g., "15974786252393396629980467963784550802583781222733347534844974829144359265969")
      // 2. Hex strings starting with 0x
      const isDecimalFormat = /^\d+$/.test(tokenId) && tokenId.length >= 10;
      const isHexFormat = /^0x[a-fA-F0-9]+$/.test(tokenId);
      
      if (!isDecimalFormat && !isHexFormat) {
        const errorMsg = `Invalid token ID format: ${tokenId}`;
        logger.error(`[GET_POLYMARKET_ORDERBOOK] ${errorMsg}`);
        const errorResult: GetOrderbookActionResult = {
          text: ` ${errorMsg}. Expected a large numeric string or hex string starting with 0x.`,
          success: false,
          error: "invalid_token_id",
          input: { token_id: tokenId },
        };
        callback?.({
          text: errorResult.text,
          content: { error: "invalid_token_id", details: errorMsg },
        });
        return errorResult;
      }

      // Validate side parameter if provided
      const side = params.side?.toUpperCase() as "BUY" | "SELL" | undefined;
      if (side && side !== "BUY" && side !== "SELL") {
        const errorMsg = `Invalid side: ${params.side}. Must be BUY or SELL.`;
        logger.error(`[GET_POLYMARKET_ORDERBOOK] ${errorMsg}`);
        const errorResult: GetOrderbookActionResult = {
          text: ` ${errorMsg}`,
          success: false,
          error: "invalid_side",
          input: { token_id: tokenId, side: params.side as any },
        };
        callback?.({
          text: errorResult.text,
          content: { error: "invalid_side", details: errorMsg },
        });
        return errorResult;
      }

      const inputParams: GetOrderbookInput = { token_id: tokenId, side };

      // Get service
      const service = getPolymarketService(runtime);
      if (!service) {
        const errorMsg = "Polymarket service not available";
        logger.error(`[GET_POLYMARKET_ORDERBOOK] ${errorMsg}`);
        const errorResult: GetOrderbookActionResult = {
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

      // Fetch orderbook
      logger.info(`[GET_POLYMARKET_ORDERBOOK] Fetching orderbook for ${tokenId}${side ? ` (${side} side)` : ""}`);
      const orderbook = await service.getOrderbook(tokenId, side);

      // Format response
      let text = ` **Orderbook Summary**\n\n`;
      text += `**Token ID:** ${orderbook.token_id.slice(0, 10)}...${orderbook.token_id.slice(-8)}\n\n`;

      if (orderbook.best_bid && orderbook.best_ask) {
        text += `**Best Prices:**\n`;
        text += `   Bid: $${orderbook.best_bid} (${(parseFloat(orderbook.best_bid) * 100).toFixed(1)}%)\n`;
        text += `   Ask: $${orderbook.best_ask} (${(parseFloat(orderbook.best_ask) * 100).toFixed(1)}%)\n`;
        text += `   Mid: $${orderbook.mid_price} (${(parseFloat(orderbook.mid_price!) * 100).toFixed(1)}%)\n`;
        text += `   Spread: $${orderbook.spread} (${(parseFloat(orderbook.spread!) * 100).toFixed(2)}%)\n\n`;
      }

      text += `**Orderbook Depth:**\n`;
      text += `   Bids: ${orderbook.bids.length} levels\n`;
      text += `   Asks: ${orderbook.asks.length} levels\n\n`;

      // Show top 5 levels on each side
      const maxLevels = 5;
      if (orderbook.bids.length > 0) {
        text += `**Top ${Math.min(maxLevels, orderbook.bids.length)} Bids:**\n`;
        orderbook.bids.slice(0, maxLevels).forEach((bid, i) => {
          text += `   ${i + 1}. ${(parseFloat(bid.price) * 100).toFixed(1)}% - Size: ${parseFloat(bid.size).toFixed(2)}\n`;
        });
        text += `\n`;
      }

      if (orderbook.asks.length > 0) {
        text += `**Top ${Math.min(maxLevels, orderbook.asks.length)} Asks:**\n`;
        orderbook.asks.slice(0, maxLevels).forEach((ask, i) => {
          text += `   ${i + 1}. ${(parseFloat(ask.price) * 100).toFixed(1)}% - Size: ${parseFloat(ask.size).toFixed(2)}\n`;
        });
      }

      const result: GetOrderbookActionResult = {
        text,
        success: true,
        data: {
          token_id: orderbook.token_id,
          market: orderbook.market,
          asset_id: orderbook.asset_id,
          timestamp: orderbook.timestamp,
          best_bid: orderbook.best_bid,
          best_ask: orderbook.best_ask,
          mid_price: orderbook.mid_price,
          spread: orderbook.spread,
          bids_count: orderbook.bids.length,
          asks_count: orderbook.asks.length,
          bids: orderbook.bids.slice(0, maxLevels),
          asks: orderbook.asks.slice(0, maxLevels),
        },
        input: inputParams,
      };

      logger.info(
        `[GET_POLYMARKET_ORDERBOOK] Successfully fetched orderbook - ${orderbook.bids.length} bids, ${orderbook.asks.length} asks`
      );
      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`[GET_POLYMARKET_ORDERBOOK] Error: ${errorMsg}`);
      const errorResult: ActionResult = {
        text: ` Failed to get orderbook: ${errorMsg}`,
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
        content: { text: "show me the orderbook for that token" },
      },
      {
        name: "{{agent}}",
        content: {
          text: " Checking orderbook depth...",
          action: "GET_POLYMARKET_ORDERBOOK",
          token_id: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: { text: "what are the bids for this market?" },
      },
      {
        name: "{{agent}}",
        content: {
          text: " Fetching bid side orderbook...",
          action: "GET_POLYMARKET_ORDERBOOK",
          token_id: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
          side: "BUY",
        },
      },
    ],
  ],
};

export default getOrderbookAction;
