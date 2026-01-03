/**
 * GET_POLYMARKET_DETAIL Action
 *
 * Get detailed information about a specific prediction market.
 * Returns YES and NO token_ids needed for orderbook queries.
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

interface GetMarketDetailParams {
  conditionId?: string;
  condition_id?: string;
  marketId?: string;
}

type GetMarketDetailInput = {
  conditionId?: string;
};

type GetMarketDetailActionResult = ActionResult & { input: GetMarketDetailInput };

export const getMarketDetailAction: Action = {
  name: "GET_POLYMARKET_DETAIL",
  similes: [
    "POLYMARKET_DETAILS",
    "MARKET_INFO",
    "MARKET_DETAILS",
    "SHOW_MARKET",
    "POLYMARKET_INFO",
    "MARKET_INFORMATION",
  ],
  description:
    "Get detailed information about a specific Polymarket prediction market. Returns the market's YES and NO token_ids which are required for GET_POLYMARKET_ORDERBOOK queries. Use condition_id from search results to get market details including tradeable token IDs.",

  parameters: {
    conditionId: {
      type: "string",
      description: "Market condition ID (hex string starting with 0x, typically 66 characters). Get this from GET_ACTIVE_POLYMARKETS or SEARCH_POLYMARKETS results.",
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
        logger.warn("[GET_POLYMARKET_DETAIL] Polymarket service not available");
        return false;
      }

      return true;
    } catch (error) {
      logger.error(
        "[GET_POLYMARKET_DETAIL] Error validating action:",
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
      logger.info("[GET_POLYMARKET_DETAIL] Getting market details");

      // Read parameters from state
      const composedState = await runtime.composeState(message, ["ACTION_STATE"], true);
      const params = (composedState?.data?.actionParams ?? {}) as Partial<GetMarketDetailParams>;

      // Extract condition ID (support multiple naming conventions)
      const conditionId = (params.conditionId || params.condition_id || params.marketId)?.trim();

      if (!conditionId) {
        const errorMsg = "Market condition ID is required";
        logger.error(`[GET_POLYMARKET_DETAIL] ${errorMsg}`);
        const errorResult: GetMarketDetailActionResult = {
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
        const errorMsg = `Invalid condition ID format: ${conditionId}. Expected hex string starting with 0x (40-70 chars)`;
        logger.error(`[GET_POLYMARKET_DETAIL] ${errorMsg}`);
        const errorResult: GetMarketDetailActionResult = {
          text: ` ${errorMsg}`,
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

      const inputParams: GetMarketDetailInput = { conditionId };

      // Get service
      const service = runtime.getService(
        PolymarketService.serviceType
      ) as PolymarketService;

      if (!service) {
        const errorMsg = "Polymarket service not available";
        logger.error(`[GET_POLYMARKET_DETAIL] ${errorMsg}`);
        const errorResult: GetMarketDetailActionResult = {
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

      // Fetch market details and prices in parallel
      logger.info(`[GET_POLYMARKET_DETAIL] Fetching details for ${conditionId}`);
      const [market, prices] = await Promise.all([
        service.getMarketDetail(conditionId),
        service.getMarketPrices(conditionId),
      ]);

      // Format response
      let text = ` **${market.question}**\n\n`;

      if (market.description) {
        text += `**Description:** ${market.description}\n\n`;
      }

      text += `**Current Odds:**\n`;
      text += `   YES: ${prices.yes_price_formatted}\n`;
      text += `   NO: ${prices.no_price_formatted}\n`;
      text += `   Spread: ${(parseFloat(prices.spread) * 100).toFixed(2)}%\n\n`;

      if (market.category) {
        text += `**Category:** ${market.category}\n`;
      }

      if (market.volume) {
        const volumeNum = parseFloat(market.volume);
        if (!isNaN(volumeNum)) {
          text += `**Trading Volume:** $${volumeNum.toLocaleString()}\n`;
        }
      }

      if (market.liquidity) {
        const liquidityNum = parseFloat(market.liquidity);
        if (!isNaN(liquidityNum)) {
          text += `**Liquidity:** $${liquidityNum.toLocaleString()}\n`;
        }
      }

      if (market.endDateIso) {
        const endDate = new Date(market.endDateIso);
        text += `**Closes:** ${endDate.toLocaleString()}\n`;
      }

      text += `\n**Status:**\n`;
      text += `   Active: ${market.active ? "Yes" : "No"}\n`;
      text += `   Closed: ${market.closed ? "Yes" : "No"}\n`;
      text += `   Resolved: ${market.resolved ? "Yes" : "No"}\n`;

      if (market.tags && market.tags.length > 0) {
        text += `\n**Tags:** ${market.tags.join(", ")}\n`;
      }

      text += `\n**Market ID:** \`${conditionId}\``;

      // Extract and display token IDs for orderbook queries
      const tokens = market.tokens || [];
      const yesToken = tokens.find((t: any) => t.outcome?.toLowerCase() === "yes");
      const noToken = tokens.find((t: any) => t.outcome?.toLowerCase() === "no");

      if (yesToken || noToken) {
        text += `\n\n**Tradeable Token IDs** (use with GET_POLYMARKET_ORDERBOOK):\n`;
        if (yesToken) {
          text += `   YES Token: \`${yesToken.token_id}\`\n`;
        }
        if (noToken) {
          text += `   NO Token: \`${noToken.token_id}\`\n`;
        }
      }

      const result: GetMarketDetailActionResult = {
        text,
        success: true,
        data: {
          market: {
            condition_id: market.conditionId,
            question: market.question,
            description: market.description,
            category: market.category,
            volume: market.volume,
            liquidity: market.liquidity,
            end_date: market.endDateIso,
            active: market.active,
            closed: market.closed,
            resolved: market.resolved,
            tags: market.tags,
          },
          // Include token IDs for multi-step action chaining
          tokens: {
            yes_token_id: yesToken?.token_id || null,
            no_token_id: noToken?.token_id || null,
            all_tokens: tokens.map((t: any) => ({
              token_id: t.token_id,
              outcome: t.outcome,
              price: t.price,
            })),
          },
          prices: {
            yes_price: prices.yes_price,
            no_price: prices.no_price,
            yes_price_formatted: prices.yes_price_formatted,
            no_price_formatted: prices.no_price_formatted,
            spread: prices.spread,
          },
        },
        input: inputParams,
      };

      logger.info(`[GET_POLYMARKET_DETAIL] Successfully fetched details for ${market.question}`);
      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`[GET_POLYMARKET_DETAIL] Error: ${errorMsg}`);
      const errorResult: ActionResult = {
        text: ` Failed to get market details: ${errorMsg}`,
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
          text: "tell me more about market 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
        },
      },
      {
        name: "{{agent}}",
        content: {
          text: " Getting market details...",
          action: "GET_POLYMARKET_DETAIL",
          conditionId:
            "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: { text: "show me details for that first market" },
      },
      {
        name: "{{agent}}",
        content: {
          text: " Fetching market information...",
          action: "GET_POLYMARKET_DETAIL",
          conditionId:
            "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
        },
      },
    ],
  ],
};

export default getMarketDetailAction;
