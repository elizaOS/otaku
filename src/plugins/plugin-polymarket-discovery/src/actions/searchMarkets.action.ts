/**
 * SEARCH_POLYMARKETS Action
 *
 * Search for prediction markets by keyword or category
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

interface SearchMarketsParams {
  query?: string;
  category?: string;
  limit?: string | number;
}

type SearchMarketsInput = {
  query?: string;
  category?: string;
  limit?: number;
};

type SearchMarketsActionResult = ActionResult & { input: SearchMarketsInput };

export const searchMarketsAction: Action = {
  name: "SEARCH_POLYMARKETS",
  similes: [
    "FIND_POLYMARKET",
    "SEARCH_PREDICTIONS",
    "FIND_PREDICTIONS",
    "POLYMARKET_SEARCH",
    "QUERY_POLYMARKET",
    "LOOK_FOR_MARKETS",
  ],
  description: `Search for prediction markets on Polymarket by keyword or category.

**Returns for each market:**
- condition_id: Market identifier
- yes_token_id: Token ID for buying YES shares (use with POLYMARKET_BUY_SHARES)
- no_token_id: Token ID for buying NO shares (use with POLYMARKET_BUY_SHARES)  
- yes_price: Current YES price (use as price parameter for buying YES)
- no_price: Current NO price (use as price parameter for buying NO)

**For Trading:** Use the returned yes_token_id/no_token_id and yes_price/no_price with POLYMARKET_BUY_SHARES.
**For Sports:** Use GET_POLYMARKET_EVENTS with tag='sports' instead.`,

  parameters: {
    query: {
      type: "string",
      description: "Search keywords (e.g., 'bitcoin', 'election', 'AI')",
      required: false,
    },
    category: {
      type: "string",
      description: "Market category (e.g., 'crypto', 'politics', 'sports')",
      required: false,
    },
    limit: {
      type: "number",
      description: "Maximum number of results to return (default: 10, max: 50)",
      required: false,
    },
  },

  validate: async (runtime: IAgentRuntime, _message: Memory) => {
    try {
      const service = runtime.getService(
        PolymarketService.serviceType
      ) as PolymarketService;

      if (!service) {
        logger.warn("[SEARCH_POLYMARKETS] Polymarket service not available");
        return false;
      }

      return true;
    } catch (error) {
      logger.error(
        "[SEARCH_POLYMARKETS] Error validating action:",
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
      logger.info("[SEARCH_POLYMARKETS] Searching markets");

      // Read parameters from state
      const composedState = await runtime.composeState(message, ["ACTION_STATE"], true);
      const params = (composedState?.data?.actionParams ?? {}) as Partial<SearchMarketsParams>;

      // Extract search parameters
      const query = params.query?.trim();
      const category = params.category?.trim();

      // Parse limit
      let limit = 10;
      if (params.limit) {
        const parsedLimit =
          typeof params.limit === "string" ? parseInt(params.limit, 10) : params.limit;
        if (!isNaN(parsedLimit) && parsedLimit > 0) {
          limit = Math.min(parsedLimit, 50);
        }
      }

      // Validate at least one search criteria
      if (!query && !category) {
        const errorMsg = "Please provide either a search query or category";
        logger.error(`[SEARCH_POLYMARKETS] ${errorMsg}`);
        const errorResult: SearchMarketsActionResult = {
          text: ` ${errorMsg}`,
          success: false,
          error: "missing_criteria",
          input: { query, category, limit },
        };
        callback?.({
          text: errorResult.text,
          content: { error: "missing_criteria", details: errorMsg },
        });
        return errorResult;
      }

      const inputParams: SearchMarketsInput = { limit };
      if (query) inputParams.query = query;
      if (category) inputParams.category = category;

      // Get service
      const service = runtime.getService(
        PolymarketService.serviceType
      ) as PolymarketService;

      if (!service) {
        const errorMsg = "Polymarket service not available";
        logger.error(`[SEARCH_POLYMARKETS] ${errorMsg}`);
        const errorResult: SearchMarketsActionResult = {
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

      // Perform search
      logger.info(
        `[SEARCH_POLYMARKETS] Searching with query="${query || 'none'}", category="${category || 'none'}"`
      );
      const markets = await service.searchMarkets({
        query,
        category,
        active: true,
        limit,
      });

      if (markets.length === 0) {
        const searchDesc = query
          ? `matching "${query}"`
          : category
            ? `in category "${category}"`
            : "matching your criteria";
        const result: SearchMarketsActionResult = {
          text: ` No prediction markets found ${searchDesc}.`,
          success: true,
          data: { markets: [], count: 0 },
          input: inputParams,
        };
        return result;
      }

      // Fetch prices for all markets in parallel
      logger.info(`[SEARCH_POLYMARKETS] Fetching prices for ${markets.length} markets`);
      const marketsWithPricesResults = await Promise.all(
        markets.map(async (market) => {
          try {
            const prices = await service.getMarketPrices(market.conditionId);
            return { market, prices, error: null };
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            logger.warn(
              `[SEARCH_POLYMARKETS] Failed to fetch prices for ${market.conditionId}: ${errorMsg}`
            );
            // Return market with error - do NOT use fake prices
            return { market, prices: null, error: errorMsg };
          }
        })
      );
      
      // Filter out markets where we couldn't get prices - don't show bad data
      const marketsWithPrices = marketsWithPricesResults.filter(
        (result): result is { market: typeof result.market; prices: NonNullable<typeof result.prices>; error: null } => 
          result.prices !== null
      );
      
      const failedCount = marketsWithPricesResults.length - marketsWithPrices.length;
      if (failedCount > 0) {
        logger.warn(`[SEARCH_POLYMARKETS] Excluded ${failedCount} markets due to price fetch failures`);
      }

      // Format response
      const searchDesc = query
        ? `"${query}"`
        : category
          ? `category "${category}"`
          : "your search";
      let text = ` **Polymarket Search Results**\n\n`;
      text += `Found ${marketsWithPrices.length} markets for ${searchDesc}:\n\n`;

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

      text += `**To Trade:** Use POLYMARKET_BUY_SHARES with token_id (yes_token_id or no_token_id), outcome, amount, and price (yes_price or no_price).\n`;
      text += `_Use GET_POLYMARKET_DETAIL with condition_id for full market info, or GET_POLYMARKET_ORDERBOOK with token_id for orderbook depth._`;

      const result: SearchMarketsActionResult = {
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
          search_query: query,
          search_category: category,
        },
        input: inputParams,
      };

      logger.info(`[SEARCH_POLYMARKETS] Successfully found ${marketsWithPrices.length} markets`);
      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`[SEARCH_POLYMARKETS] Error: ${errorMsg}`);
      const errorResult: ActionResult = {
        text: ` Failed to search markets: ${errorMsg}`,
        success: false,
        error: errorMsg,
      };
      callback?.({
        text: errorResult.text,
        content: { error: "search_failed", details: errorMsg },
      });
      return errorResult;
    }
  },

  examples: [
    [
      {
        name: "{{user}}",
        content: { text: "search polymarket for bitcoin predictions" },
      },
      {
        name: "{{agent}}",
        content: {
          text: " Searching for Bitcoin-related markets...",
          action: "SEARCH_POLYMARKETS",
          query: "bitcoin",
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: { text: "find prediction markets about AI" },
      },
      {
        name: "{{agent}}",
        content: {
          text: " Looking for AI prediction markets...",
          action: "SEARCH_POLYMARKETS",
          query: "AI",
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: { text: "show me crypto prediction markets" },
      },
      {
        name: "{{agent}}",
        content: {
          text: " Finding crypto markets...",
          action: "SEARCH_POLYMARKETS",
          category: "crypto",
        },
      },
    ],
  ],
};

export default searchMarketsAction;
