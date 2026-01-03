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

export const getCategoriesWithMarketDataAction: Action = {
  name: "GET_CATEGORIES_WITH_MARKET_DATA",
  similes: [
    "CATEGORIES_MARKET_DATA",
    "CATEGORY_STATS",
    "TOP_CATEGORIES",
    "TRENDING_CATEGORIES",
  ],
  description:
    "Use this action to get all coin categories with market data including market cap, volume, 24h change, and top 3 coins in each category. Returns comprehensive category statistics that can be sorted by market cap or name. Useful when the user wants to analyze category performance or find top performing categories.",

  // Parameter schema for tool calling
  parameters: {
    order: {
      type: "string",
      description: "Sort order for categories. Options: 'market_cap_desc' (default), 'market_cap_asc', 'name_desc', 'name_asc', 'market_cap_change_24h_desc', 'market_cap_change_24h_asc'",
      required: false,
    },
  },

  validate: async (runtime: IAgentRuntime, message: Memory, state?: State): Promise<boolean> => {
    return validateCoingeckoService(runtime, "GET_CATEGORIES_WITH_MARKET_DATA", state, message);
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback,
  ): Promise<ActionResult> => {
    try {
      const svc = getCoingeckoService(runtime);
      if (!svc) {
        throw new Error("CoinGeckoService not available");
      }

      // Read parameters from state (extracted by multiStepDecisionTemplate)
      const composedState = await runtime.composeState(message, ["ACTION_STATE"], true);
      const params = composedState?.data?.actionParams || {};

      // Extract and validate order parameter
      const validOrders = [
        'market_cap_desc',
        'market_cap_asc',
        'name_desc',
        'name_asc',
        'market_cap_change_24h_desc',
        'market_cap_change_24h_asc'
      ] as const;
      
      type OrderType = typeof validOrders[number];
      
      const orderRaw = params?.order?.trim().toLowerCase() || 'market_cap_desc';
      const order: OrderType = validOrders.includes(orderRaw as OrderType) 
        ? (orderRaw as OrderType)
        : 'market_cap_desc';

      logger.info(`[GET_CATEGORIES_WITH_MARKET_DATA] Fetching categories with order: ${order}`);

      // Store input parameters for return
      const inputParams = { order };

      // Fetch categories with market data
      const categoriesData = await svc.getCategoriesWithMarketData(order);

      const text = `Found ${categoriesData?.length || 0} categories with market data`;

      if (callback) {
        await callback({
          text,
          actions: ["GET_CATEGORIES_WITH_MARKET_DATA"],
          content: { categories: categoriesData },
          source: message.content.source,
        });
      }

      return {
        text,
        success: true,
        data: categoriesData,
        values: categoriesData,
        input: inputParams,
      } as ActionResult & { input: typeof inputParams };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`[GET_CATEGORIES_WITH_MARKET_DATA] Action failed: ${msg}`);
      
      // Try to capture input params even in failure
      const composedState = await runtime.composeState(message, ["ACTION_STATE"], true);
      const params = composedState?.data?.actionParams || {};
      const failureInputParams = {
        order: params?.order || 'market_cap_desc',
      };
      
      const errorText = `Failed to fetch categories with market data: ${msg}`;
      
      const errorResult: ActionResult = {
        text: errorText,
        success: false,
        error: msg,
        input: failureInputParams,
      } as ActionResult & { input: typeof failureInputParams };
      
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
        content: { text: "Show me the top crypto categories by market cap" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Found 150 categories with market data",
          actions: ["GET_CATEGORIES_WITH_MARKET_DATA"],
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: { text: "What are the trending categories in the last 24h?" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Found 150 categories with market data",
          actions: ["GET_CATEGORIES_WITH_MARKET_DATA"],
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: { text: "Get category market data sorted by 24h change" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Found 150 categories with market data",
          actions: ["GET_CATEGORIES_WITH_MARKET_DATA"],
        },
      },
    ],
  ],
};

