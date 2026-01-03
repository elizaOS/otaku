import {
  Action,
  ActionResult,
  HandlerCallback,
  IAgentRuntime,
  Memory,
  State,
  logger,
} from "@elizaos/core";
import { validateCoingeckoService, getCoingeckoService } from "../utils/actionHelpers";

export const getTrendingSearchAction: Action = {
  name: "GET_TRENDING_SEARCH",
  similes: [
    "TRENDING_SEARCH",
    "TRENDING_COINS_NFTS",
    "HOT_SEARCHES",
    "POPULAR_SEARCHES",
    "TRENDING_NOW",
  ],
  description:
    "Use this action when the user asks about overall trending coins, NFTs, and categories. Returns comprehensive trending data including coins with search scores, trending NFTs with floor prices, and trending categories. This is different from GET_TRENDING_TOKENS which shows trending pools on specific networks.",

  // No parameters needed for this action
  parameters: {},

  validate: async (runtime: IAgentRuntime, message: Memory, state?: State): Promise<boolean> => {
    return validateCoingeckoService(runtime, "GET_TRENDING_SEARCH", state, message);
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: any,
    callback?: HandlerCallback,
  ): Promise<ActionResult> => {
    try {
      const svc = getCoingeckoService(runtime);
      if (!svc) {
        throw new Error("CoinGeckoService not available");
      }

      logger.info(`[GET_TRENDING_SEARCH] Fetching trending searches`);

      // Fetch trending search data
      const trendingData = await svc.getTrendingSearch();

      const text = `Found ${trendingData.trending_coins?.length || 0} trending coins, ${trendingData.trending_nfts?.length || 0} trending NFTs, and ${trendingData.trending_categories?.length || 0} trending categories`;

      if (callback) {
        await callback({
          text,
          actions: ["GET_TRENDING_SEARCH"],
          content: trendingData as any,
          source: message.content.source,
        });
      }

      return {
        text,
        success: true,
        data: trendingData,
        values: trendingData,
        input: {},
      } as ActionResult & { input: {} };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`[GET_TRENDING_SEARCH] Action failed: ${msg}`);
      
      const errorText = `Failed to fetch trending searches: ${msg}

This action fetches overall trending data from CoinGecko including:
- Trending coins with search scores and market data
- Trending NFTs with floor prices and volumes
- Trending categories by market cap

No parameters are required for this action.`;
      
      const errorResult: ActionResult = {
        text: errorText,
        success: false,
        error: msg,
        input: {},
      } as ActionResult & { input: {} };
      
      if (callback) {
        await callback({
          text: errorResult.text,
          content: { error: "action_failed", details: msg },
        });
      }
      return errorResult;
    }
  },

  examples: [
    [
      {
        name: "{{user}}",
        content: { text: "What are the trending coins right now?" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Found 10 trending coins, 7 trending NFTs, and 5 trending categories",
          actions: ["GET_TRENDING_SEARCH"],
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: { text: "Show me trending searches on CoinGecko" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Found 10 trending coins, 7 trending NFTs, and 5 trending categories",
          actions: ["GET_TRENDING_SEARCH"],
        },
      },
    ],
  ],
};

