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

export const getCategoriesListAction: Action = {
  name: "GET_CATEGORIES_LIST",
  similes: [
    "CATEGORIES_LIST",
    "COIN_CATEGORIES",
    "LIST_CATEGORIES",
    "CATEGORY_IDS",
  ],
  description:
    "Use this action to get the complete list of all coin categories (ID map) from CoinGecko. Returns category IDs and names that can be used to filter or search for tokens by category. Useful when the user wants to know what categories exist or needs category IDs for other queries.",

  // No parameters needed
  parameters: {},

  validate: async (runtime: IAgentRuntime, message: Memory, state?: State): Promise<boolean> => {
    return validateCoingeckoService(runtime, "GET_CATEGORIES_LIST", state, message);
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

      logger.info(`[GET_CATEGORIES_LIST] Fetching all coin categories`);

      // Fetch categories list
      const categoriesList = await svc.getCategoriesList();

      const text = `Found ${categoriesList?.length || 0} coin categories`;

      if (callback) {
        await callback({
          text,
          actions: ["GET_CATEGORIES_LIST"],
          content: categoriesList as unknown as Record<string, unknown>,
          source: message.content.source,
        });
      }

      return {
        text,
        success: true,
        data: categoriesList,
        values: categoriesList,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`[GET_CATEGORIES_LIST] Action failed: ${msg}`);
      
      const errorText = `Failed to fetch coin categories list: ${msg}`;
      
      const errorResult: ActionResult = {
        text: errorText,
        success: false,
        error: msg,
      };
      
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
        content: { text: "What categories of coins are available?" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Found 200 coin categories",
          actions: ["GET_CATEGORIES_LIST"],
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: { text: "List all coin categories" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Found 200 coin categories",
          actions: ["GET_CATEGORIES_LIST"],
        },
      },
    ],
  ],
};

