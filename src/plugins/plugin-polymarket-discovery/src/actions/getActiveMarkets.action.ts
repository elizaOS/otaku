/**
 * GET_ACTIVE_POLYMARKETS Action
 *
 * Fetches trending/active prediction markets from Polymarket
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
import type { PolymarketMarket } from "../types";
import { shouldPolymarketPluginBeInContext } from "../../matcher";

interface GetActiveMarketsParams {
  limit?: string | number;
}

type GetActiveMarketsInput = {
  limit?: number;
};

type GetActiveMarketsActionResult = ActionResult & { input: GetActiveMarketsInput };

export const getActiveMarketsAction: Action = {
  name: "GET_ACTIVE_POLYMARKETS",
  similes: [
    "SHOW_POLYMARKET",
    "LIST_POLYMARKET",
    "TRENDING_MARKETS",
    "POPULAR_PREDICTIONS",
    "ACTIVE_PREDICTIONS",
    "POLYMARKET_TRENDING",
    "WHAT_MARKETS",
  ],
  description:
    "Get trending and active prediction markets from Polymarket. Returns condition_id and token_ids (yes_token_id, no_token_id) for each market. Use condition_id with GET_POLYMARKET_DETAIL for full info, or use token_id directly with GET_POLYMARKET_ORDERBOOK for orderbook depth.",

  parameters: {
    limit: {
      type: "number",
      description: "Maximum number of markets to return (default: 10, max: 50)",
      required: false,
    },
  },

  validate: async (runtime: IAgentRuntime, message: Memory, state?: State) => {
    try {
      // Check plugin context first
      if (!shouldPolymarketPluginBeInContext(state, message)) {
        return false;
      }

      const service = runtime.getService(
        PolymarketService.serviceType
      ) as PolymarketService;

      if (!service) {
        logger.warn("[GET_ACTIVE_POLYMARKETS] Polymarket service not available");
        return false;
      }

      return true;
    } catch (error) {
      logger.error(
        "[GET_ACTIVE_POLYMARKETS] Error validating action:",
        error instanceof Error ? error.message : String(error)
      );
      return false;
    }
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    try {
      logger.info("[GET_ACTIVE_POLYMARKETS] Fetching active markets");

      // Read parameters from state
      const composedState = await runtime.composeState(message, ["ACTION_STATE"], true);
      const params = (composedState?.data?.actionParams ?? {}) as Partial<GetActiveMarketsParams>;

      // Parse limit parameter
      let limit = 10; // default
      if (params.limit) {
        const parsedLimit =
          typeof params.limit === "string" ? parseInt(params.limit, 10) : params.limit;
        if (!isNaN(parsedLimit) && parsedLimit > 0) {
          limit = Math.min(parsedLimit, 50); // cap at 50
        }
      }

      const inputParams: GetActiveMarketsInput = { limit };

      // Get service
      const service = runtime.getService(
        PolymarketService.serviceType
      ) as PolymarketService;

      if (!service) {
        const errorMsg = "Polymarket service not available";
        logger.error(`[GET_ACTIVE_POLYMARKETS] ${errorMsg}`);
        const errorResult: GetActiveMarketsActionResult = {
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

      // Fetch active markets
      logger.info(`[GET_ACTIVE_POLYMARKETS] Fetching ${limit} active markets`);
      const markets = await service.getActiveMarkets(limit);

      if (markets.length === 0) {
        const result: GetActiveMarketsActionResult = {
          text: " No active prediction markets found at the moment.",
          success: true,
          data: { markets: [], count: 0 },
          input: inputParams,
        };
        return result;
      }

      // Fetch prices for all markets in parallel
      logger.info("[GET_ACTIVE_POLYMARKETS] Fetching prices for markets");
      const marketsWithPrices = await Promise.all(
        markets.map(async (market) => {
          try {
            const prices = await service.getMarketPrices(market.conditionId);
            return { market, prices };
          } catch (error) {
            logger.warn(
              `[GET_ACTIVE_POLYMARKETS] Failed to fetch prices for ${market.conditionId}: ${error instanceof Error ? error.message : String(error)}`
            );
            // Return market without prices
            return {
              market,
              prices: {
                yes_price: "0.50",
                no_price: "0.50",
                yes_price_formatted: "50.0%",
                no_price_formatted: "50.0%",
                spread: "0.0000",
                last_updated: Date.now(),
                condition_id: market.conditionId,
              },
            };
          }
        })
      );

      // Format response
      let text = ` **Active Polymarket Predictions**\n\n`;
      text += `Found ${marketsWithPrices.length} active markets:\n\n`;

      marketsWithPrices.forEach(({ market, prices }, index) => {
        text += `**${index + 1}. ${market.question}**\n`;
        text += `   YES: ${prices.yes_price_formatted} | NO: ${prices.no_price_formatted}\n`;

        if (market.category) {
          text += `   Category: ${market.category}\n`;
        }

        if (market.volume) {
          const volumeNum = parseFloat(market.volume);
          if (!isNaN(volumeNum)) {
            text += `   Volume: $${volumeNum.toLocaleString()}\n`;
          }
        }

        // Include condition_id so the LLM can reference it for GET_POLYMARKET_DETAIL
        if (market.condition_id) {
          text += `   condition_id: \`${market.condition_id}\`\n`;
        }

        // Include token_ids if available for direct orderbook queries
        const tokens = market.tokens || [];
        const yesToken = tokens.find((t: any) => t.outcome?.toLowerCase() === "yes");
        const noToken = tokens.find((t: any) => t.outcome?.toLowerCase() === "no");
        if (yesToken) {
          text += `   yes_token_id: \`${yesToken.token_id}\`\n`;
        }
        if (noToken) {
          text += `   no_token_id: \`${noToken.token_id}\`\n`;
        }

        text += "\n";
      });

      text +=
        "_Use GET_POLYMARKET_DETAIL with condition_id for full info, or GET_POLYMARKET_ORDERBOOK with token_id for orderbook depth._";

      const result: GetActiveMarketsActionResult = {
        text,
        success: true,
        data: {
          markets: marketsWithPrices.map(({ market, prices }) => {
            const tokens = market.tokens || [];
            const yesToken = tokens.find((t: any) => t.outcome?.toLowerCase() === "yes");
            const noToken = tokens.find((t: any) => t.outcome?.toLowerCase() === "no");
            return {
              condition_id: market.conditionId,
              question: market.question,
              category: market.category,
              volume: market.volume,
              yes_price: prices.yes_price,
              no_price: prices.no_price,
              yes_price_formatted: prices.yes_price_formatted,
              no_price_formatted: prices.no_price_formatted,
              // Include token IDs for multi-step action chaining
              yes_token_id: yesToken?.token_id || null,
              no_token_id: noToken?.token_id || null,
            };
          }),
          count: marketsWithPrices.length,
        },
        input: inputParams,
      };

      logger.info(
        `[GET_ACTIVE_POLYMARKETS] Successfully fetched ${marketsWithPrices.length} markets`
      );
      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`[GET_ACTIVE_POLYMARKETS] Error: ${errorMsg}`);
      const errorResult: ActionResult = {
        text: ` Failed to fetch active markets: ${errorMsg}`,
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
        content: { text: "what are the trending polymarket predictions?" },
      },
      {
        name: "{{agent}}",
        content: {
          text: " Fetching trending Polymarket predictions...",
          action: "GET_ACTIVE_POLYMARKETS",
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: { text: "show me 5 active prediction markets" },
      },
      {
        name: "{{agent}}",
        content: {
          text: " Getting 5 active markets...",
          action: "GET_ACTIVE_POLYMARKETS",
          limit: 5,
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: { text: "what markets are popular on polymarket right now?" },
      },
      {
        name: "{{agent}}",
        content: {
          text: " Checking popular Polymarket markets...",
          action: "GET_ACTIVE_POLYMARKETS",
        },
      },
    ],
  ],
};

export default getActiveMarketsAction;
