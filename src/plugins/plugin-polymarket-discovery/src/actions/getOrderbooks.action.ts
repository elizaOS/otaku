/**
 * GET_POLYMARKET_ORDERBOOKS Action
 *
 * Get orderbook depth for multiple tokens in a single batch request
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

interface GetOrderbooksParams {
  tokenIds?: string[];
  token_ids?: string[];
}

type GetOrderbooksInput = {
  token_ids: string[];
};

type GetOrderbooksActionResult = ActionResult & { input: GetOrderbooksInput };

export const getOrderbooksAction: Action = {
  name: "GET_POLYMARKET_ORDERBOOKS",
  similes: [
    "POLYMARKET_ORDERBOOKS",
    "CHECK_ORDERBOOKS",
    "MULTIPLE_ORDERBOOKS",
    "BATCH_ORDERBOOKS",
    "COMPARE_LIQUIDITY",
  ],
  description:
    "Get orderbooks for multiple Polymarket tokens in batch (max 100). IMPORTANT: Requires token_ids (NOT condition_ids). Get token_ids from SEARCH_POLYMARKETS or GET_POLYMARKET_DETAIL responses. Useful for comparing liquidity across YES/NO tokens of multiple markets.",

  parameters: {
    token_ids: {
      type: "array",
      description: "Array of ERC1155 token IDs (max 100). Token IDs are large numeric strings like '15974786252393396629980467963784550802583781222733347534844974829144359265969'. Get these from SEARCH_POLYMARKETS or GET_POLYMARKET_DETAIL.",
      required: true,
    },
  },

  validate: async (runtime: IAgentRuntime, message: Memory, state?: State) => {
    return validatePolymarketService(runtime, "GET_POLYMARKET_ORDERBOOKS", state, message);
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    try {
      logger.info("[GET_POLYMARKET_ORDERBOOKS] Getting orderbooks");

      // Extract parameters
      const params = await extractActionParams<GetOrderbooksParams>(runtime, message);

      // Normalize token_ids (support both snake_case and camelCase)
      let tokenIds = params.token_ids || params.tokenIds;

      if (!tokenIds || !Array.isArray(tokenIds) || tokenIds.length === 0) {
        const errorMsg = "Token IDs array is required";
        logger.error(`[GET_POLYMARKET_ORDERBOOKS] ${errorMsg}`);
        const errorResult: GetOrderbooksActionResult = {
          text: ` ${errorMsg}. Please provide an array of ERC1155 conditional token IDs.`,
          success: false,
          error: "missing_token_ids",
          input: { token_ids: [] },
        };
        callback?.({
          text: errorResult.text,
          content: { error: "missing_token_ids", details: errorMsg },
        });
        return errorResult;
      }

      // Validate token IDs format
      // Token IDs can be either:
      // 1. Large decimal numbers (e.g., "15974786252393396629980467963784550802583781222733347534844974829144359265969")
      // 2. Hex strings starting with 0x
      tokenIds = tokenIds.map((id) => id.trim());
      const isValidTokenId = (id: string) => {
        const isDecimalFormat = /^\d+$/.test(id) && id.length >= 10;
        const isHexFormat = /^0x[a-fA-F0-9]+$/.test(id);
        return isDecimalFormat || isHexFormat;
      };
      const invalidTokens = tokenIds.filter((id) => !isValidTokenId(id));
      if (invalidTokens.length > 0) {
        const errorMsg = `Invalid token ID format: ${invalidTokens[0]}`;
        logger.error(`[GET_POLYMARKET_ORDERBOOKS] ${errorMsg}`);
        const errorResult: GetOrderbooksActionResult = {
          text: ` ${errorMsg}. Token IDs must be large numeric strings or hex strings starting with 0x.`,
          success: false,
          error: "invalid_token_ids",
          input: { token_ids: tokenIds },
        };
        callback?.({
          text: errorResult.text,
          content: { error: "invalid_token_ids", details: errorMsg },
        });
        return errorResult;
      }

      // Validate max 100 tokens
      if (tokenIds.length > 100) {
        logger.warn(`[GET_POLYMARKET_ORDERBOOKS] Token IDs exceeds max of 100, will truncate`);
      }

      const inputParams: GetOrderbooksInput = { token_ids: tokenIds };

      // Get service
      const service = getPolymarketService(runtime);
      if (!service) {
        const errorMsg = "Polymarket service not available";
        logger.error(`[GET_POLYMARKET_ORDERBOOKS] ${errorMsg}`);
        const errorResult: GetOrderbooksActionResult = {
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

      // Fetch orderbooks
      logger.info(`[GET_POLYMARKET_ORDERBOOKS] Fetching ${tokenIds.length} orderbooks`);
      const orderbooks = await service.getOrderbooks(tokenIds);

      // Format response
      let text = ` **Orderbooks Summary (${orderbooks.length} tokens)**\n\n`;

      // Summary table
      orderbooks.forEach((ob, i) => {
        text += `**${i + 1}. Token ${ob.token_id.slice(0, 8)}...${ob.token_id.slice(-6)}**\n`;

        if (ob.best_bid && ob.best_ask) {
          text += `   Bid/Ask: ${(parseFloat(ob.best_bid) * 100).toFixed(1)}% / ${(parseFloat(ob.best_ask) * 100).toFixed(1)}%`;
          text += ` (Spread: ${(parseFloat(ob.spread!) * 100).toFixed(2)}%)\n`;
        } else {
          text += `   No liquidity\n`;
        }

        text += `   Depth: ${ob.bids.length} bids, ${ob.asks.length} asks\n\n`;
      });

      // Liquidity analysis
      const liquidBooks = orderbooks.filter((ob) => ob.best_bid && ob.best_ask);
      if (liquidBooks.length > 0) {
        text += `**Liquidity Analysis:**\n`;
        text += `   Markets with liquidity: ${liquidBooks.length}/${orderbooks.length}\n`;

        // Find tightest spread
        const tightest = liquidBooks.reduce((min, ob) => {
          const spread = parseFloat(ob.spread!);
          return spread < parseFloat(min.spread!) ? ob : min;
        });
        text += `   Tightest spread: ${(parseFloat(tightest.spread!) * 100).toFixed(2)}% (Token ...${tightest.token_id.slice(-6)})\n`;

        // Find widest spread
        const widest = liquidBooks.reduce((max, ob) => {
          const spread = parseFloat(ob.spread!);
          return spread > parseFloat(max.spread!) ? ob : max;
        });
        text += `   Widest spread: ${(parseFloat(widest.spread!) * 100).toFixed(2)}% (Token ...${widest.token_id.slice(-6)})\n`;
      }

      const result: GetOrderbooksActionResult = {
        text,
        success: true,
        data: {
          total_tokens: orderbooks.length,
          tokens_with_liquidity: liquidBooks.length,
          orderbooks: orderbooks.map((ob) => ({
            token_id: ob.token_id,
            best_bid: ob.best_bid,
            best_ask: ob.best_ask,
            mid_price: ob.mid_price,
            spread: ob.spread,
            bids_count: ob.bids.length,
            asks_count: ob.asks.length,
          })),
        },
        input: inputParams,
      };

      logger.info(
        `[GET_POLYMARKET_ORDERBOOKS] Successfully fetched ${orderbooks.length} orderbooks`
      );
      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`[GET_POLYMARKET_ORDERBOOKS] Error: ${errorMsg}`);
      const errorResult: ActionResult = {
        text: ` Failed to get orderbooks: ${errorMsg}`,
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
        content: { text: "compare orderbooks for these tokens" },
      },
      {
        name: "{{agent}}",
        content: {
          text: " Fetching orderbooks for comparison...",
          action: "GET_POLYMARKET_ORDERBOOKS",
          token_ids: [
            "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
            "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
          ],
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: { text: "show me liquidity for all YES tokens in this market" },
      },
      {
        name: "{{agent}}",
        content: {
          text: " Fetching orderbooks...",
          action: "GET_POLYMARKET_ORDERBOOKS",
          token_ids: [
            "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
            "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
            "0x567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234",
          ],
        },
      },
    ],
  ],
};

export default getOrderbooksAction;
