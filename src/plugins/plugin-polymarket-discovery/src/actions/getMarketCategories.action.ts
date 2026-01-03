/**
 * GET_POLYMARKET_CATEGORIES Action
 *
 * List available market categories on Polymarket
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

type GetMarketCategoriesInput = Record<string, never>;

type GetMarketCategoriesActionResult = ActionResult & {
  input: GetMarketCategoriesInput;
};

export const getMarketCategoriesAction: Action = {
  name: "GET_POLYMARKET_CATEGORIES",
  similes: [
    "LIST_CATEGORIES",
    "POLYMARKET_CATEGORIES",
    "MARKET_CATEGORIES",
    "PREDICTION_CATEGORIES",
    "SHOW_CATEGORIES",
  ],
  description:
    "Get a list of all available market categories on Polymarket (e.g., crypto, politics, sports). Useful for browsing markets by topic.",

  parameters: {},

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
        logger.warn("[GET_POLYMARKET_CATEGORIES] Polymarket service not available");
        return false;
      }

      return true;
    } catch (error) {
      logger.error(
        "[GET_POLYMARKET_CATEGORIES] Error validating action:",
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
      logger.info("[GET_POLYMARKET_CATEGORIES] Fetching market categories");

      const inputParams: GetMarketCategoriesInput = {};

      // Get service
      const service = runtime.getService(
        PolymarketService.serviceType
      ) as PolymarketService;

      if (!service) {
        const errorMsg = "Polymarket service not available";
        logger.error(`[GET_POLYMARKET_CATEGORIES] ${errorMsg}`);
        const errorResult: GetMarketCategoriesActionResult = {
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

      // Fetch categories
      logger.info("[GET_POLYMARKET_CATEGORIES] Fetching categories");
      const categories = await service.getMarketCategories();

      if (categories.length === 0) {
        const result: GetMarketCategoriesActionResult = {
          text: " No market categories found at the moment.",
          success: true,
          data: { categories: [], count: 0 },
          input: inputParams,
        };
        return result;
      }

      // Format response
      let text = ` **Polymarket Categories**\n\n`;
      text += `Found ${categories.length} categories:\n\n`;

      categories.forEach((category, index) => {
        text += `${index + 1}. **${category.name}** (${category.count} markets)\n`;
      });

      text += `\n_Use SEARCH_POLYMARKETS with a category to find markets in that category._`;

      const result: GetMarketCategoriesActionResult = {
        text,
        success: true,
        data: {
          categories: categories.map((c) => ({
            name: c.name,
            count: c.count,
          })),
          count: categories.length,
        },
        input: inputParams,
      };

      logger.info(
        `[GET_POLYMARKET_CATEGORIES] Successfully fetched ${categories.length} categories`
      );
      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`[GET_POLYMARKET_CATEGORIES] Error: ${errorMsg}`);
      const errorResult: ActionResult = {
        text: ` Failed to fetch categories: ${errorMsg}`,
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
        content: { text: "what categories are available on polymarket?" },
      },
      {
        name: "{{agent}}",
        content: {
          text: " Fetching Polymarket categories...",
          action: "GET_POLYMARKET_CATEGORIES",
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: { text: "show me all prediction market categories" },
      },
      {
        name: "{{agent}}",
        content: {
          text: " Getting available categories...",
          action: "GET_POLYMARKET_CATEGORIES",
        },
      },
    ],
  ],
};

export default getMarketCategoriesAction;
