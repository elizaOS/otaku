/**
 * GET_POLYMARKET_PRICE Action
 *
 * Get real-time pricing for a specific prediction market
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

interface GetMarketPriceParams {
  conditionId?: string;
  marketId?: string;
}

type GetMarketPriceInput = {
  conditionId?: string;
};

type GetMarketPriceActionResult = ActionResult & { input: GetMarketPriceInput };

export const getMarketPriceAction: Action = {
  name: "GET_POLYMARKET_PRICE",
  similes: [
    "POLYMARKET_ODDS",
    "CHECK_ODDS",
    "MARKET_PRICE",
    "CURRENT_ODDS",
    "POLYMARKET_PRICE",
    "PREDICTION_ODDS",
  ],
  description:
    "Get real-time pricing and odds for a specific Polymarket prediction market. Shows current YES/NO prices and spread.",

  parameters: {
    conditionId: {
      type: "string",
      description: "Market condition ID (66-character hex string starting with 0x)",
      required: true,
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
        logger.warn("[GET_POLYMARKET_PRICE] Polymarket service not available");
        return false;
      }

      return true;
    } catch (error) {
      logger.error(
        "[GET_POLYMARKET_PRICE] Error validating action:",
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
      logger.info("[GET_POLYMARKET_PRICE] Getting market price");

      // Read parameters from state
      const composedState = await runtime.composeState(message, ["ACTION_STATE"], true);
      const params = (composedState?.data?.actionParams ?? {}) as Partial<GetMarketPriceParams>;

      // Extract condition ID
      const conditionId = (params.conditionId || params.marketId)?.trim();

      if (!conditionId) {
        const errorMsg = "Market condition ID is required";
        logger.error(`[GET_POLYMARKET_PRICE] ${errorMsg}`);
        const errorResult: GetMarketPriceActionResult = {
          text: ` ${errorMsg}. Please provide the market condition ID.`,
          success: false,
          error: "missing_condition_id",
          input: { conditionId },
        };
        callback?.({
          text: errorResult.text,
          content: { error: "missing_condition_id", details: errorMsg },
        });
        return errorResult;
      }

      // Validate condition ID format (should be hex string starting with 0x)
      // Accept any valid hex ID with length between 40-70 chars to handle various API formats
      const isValidHex = /^0x[a-fA-F0-9]+$/.test(conditionId);
      const isValidLength = conditionId.length >= 40 && conditionId.length <= 70;

      if (!isValidHex || !isValidLength) {
        const errorMsg = `Invalid condition ID format: ${conditionId}`;
        logger.error(`[GET_POLYMARKET_PRICE] ${errorMsg}`);
        const errorResult: GetMarketPriceActionResult = {
          text: `${errorMsg}. Expected hex string starting with 0x (40-70 chars).`,
          success: false,
          error: "invalid_condition_id",
          input: { conditionId },
        };
        callback?.({
          text: errorResult.text,
          content: { error: "invalid_condition_id", details: errorMsg },
        });
        return errorResult;
      }

      const inputParams: GetMarketPriceInput = { conditionId };

      // Get service
      const service = runtime.getService(
        PolymarketService.serviceType
      ) as PolymarketService;

      if (!service) {
        const errorMsg = "Polymarket service not available";
        logger.error(`[GET_POLYMARKET_PRICE] ${errorMsg}`);
        const errorResult: GetMarketPriceActionResult = {
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

      // Fetch prices (and market for context)
      logger.info(`[GET_POLYMARKET_PRICE] Fetching price for ${conditionId}`);
      const [prices, market] = await Promise.all([
        service.getMarketPrices(conditionId),
        service.getMarketDetail(conditionId).catch(() => null), // Optional, for market name
      ]);

      // Format response
      let text = ` **Market Pricing**\n\n`;

      if (market) {
        text += `**Market:** ${market.question}\n\n`;
      }

      text += `**Current Odds:**\n`;
      text += `   YES: ${prices.yes_price_formatted} ($${prices.yes_price})\n`;
      text += `   NO: ${prices.no_price_formatted} ($${prices.no_price})\n`;
      text += `   Spread: ${(parseFloat(prices.spread) * 100).toFixed(2)}%\n\n`;

      // Calculate implied probability
      const yesProb = parseFloat(prices.yes_price) * 100;
      const noProb = parseFloat(prices.no_price) * 100;
      text += `**Implied Probability:**\n`;
      text += `   YES: ${yesProb.toFixed(1)}%\n`;
      text += `   NO: ${noProb.toFixed(1)}%\n\n`;

      const age = Date.now() - prices.last_updated;
      const ageSeconds = Math.floor(age / 1000);
      text += `_Updated ${ageSeconds < 60 ? `${ageSeconds}s` : `${Math.floor(ageSeconds / 60)}m`} ago_`;

      const result: GetMarketPriceActionResult = {
        text,
        success: true,
        data: {
          condition_id: conditionId,
          market_question: market?.question,
          yes_price: prices.yes_price,
          no_price: prices.no_price,
          yes_price_formatted: prices.yes_price_formatted,
          no_price_formatted: prices.no_price_formatted,
          spread: prices.spread,
          yes_probability: yesProb,
          no_probability: noProb,
          last_updated: prices.last_updated,
        },
        input: inputParams,
      };

      logger.info(
        `[GET_POLYMARKET_PRICE] Successfully fetched prices - YES: ${prices.yes_price_formatted}, NO: ${prices.no_price_formatted}`
      );
      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`[GET_POLYMARKET_PRICE] Error: ${errorMsg}`);
      const errorResult: ActionResult = {
        text: ` Failed to get market price: ${errorMsg}`,
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
        content: { text: "what are the current odds for that market?" },
      },
      {
        name: "{{agent}}",
        content: {
          text: " Checking current odds...",
          action: "GET_POLYMARKET_PRICE",
          conditionId:
            "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: { text: "get the latest price for the Bitcoin market" },
      },
      {
        name: "{{agent}}",
        content: {
          text: " Fetching latest price...",
          action: "GET_POLYMARKET_PRICE",
          conditionId:
            "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
        },
      },
    ],
  ],
};

export default getMarketPriceAction;
