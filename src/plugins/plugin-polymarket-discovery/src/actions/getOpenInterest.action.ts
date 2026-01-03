/**
 * GET_POLYMARKET_OPEN_INTEREST Action
 *
 * Get market-wide exposure metrics (total value locked)
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
import { validatePolymarketService, getPolymarketService } from "../utils/actionHelpers";

type GetOpenInterestInput = Record<string, never>;

type GetOpenInterestActionResult = ActionResult & {
  input: GetOpenInterestInput;
};

export const getOpenInterestAction: Action = {
  name: "GET_POLYMARKET_OPEN_INTEREST",
  similes: [
    "OPEN_INTEREST",
    "POLYMARKET_OPEN_INTEREST",
    "MARKET_EXPOSURE",
    "TOTAL_VALUE_LOCKED",
    "TVL",
  ],
  description:
    "Get market-wide open interest (total value locked across all Polymarket markets). Useful for understanding total market exposure and activity.",

  parameters: {},

  validate: async (runtime: IAgentRuntime, message: Memory, state?: State) => {
    return validatePolymarketService(runtime, "GET_POLYMARKET_OPEN_INTEREST", state, message);
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    try {
      logger.info("[GET_POLYMARKET_OPEN_INTEREST] Fetching open interest");

      const inputParams: GetOpenInterestInput = {};

      // Get service
      const service = getPolymarketService(runtime);

      if (!service) {
        const errorMsg = "Polymarket service not available";
        logger.error(`[GET_POLYMARKET_OPEN_INTEREST] ${errorMsg}`);
        const errorResult: GetOpenInterestActionResult = {
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

      // Fetch open interest
      logger.info("[GET_POLYMARKET_OPEN_INTEREST] Fetching data");
      const openInterest = await service.getOpenInterest();

      // Format response
      const totalValue = parseFloat(openInterest.total_value);
      const formattedValue = totalValue.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      });

      let text = ` **Polymarket Open Interest**\n\n`;
      text += `**Total Value Locked:** ${formattedValue}\n`;

      if (openInterest.markets_count !== undefined) {
        text += `**Active Markets:** ${openInterest.markets_count.toLocaleString()}\n`;
      }

      text += `\n_Open interest represents the total value of all outstanding positions across Polymarket._`;

      const result: GetOpenInterestActionResult = {
        text,
        success: true,
        data: {
          total_value: openInterest.total_value,
          total_value_formatted: formattedValue,
          markets_count: openInterest.markets_count,
          timestamp: openInterest.timestamp || Date.now(),
        },
        input: inputParams,
      };

      logger.info(
        `[GET_POLYMARKET_OPEN_INTEREST] Successfully fetched open interest: ${formattedValue}`
      );
      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`[GET_POLYMARKET_OPEN_INTEREST] Error: ${errorMsg}`);
      const errorResult: ActionResult = {
        text: ` Failed to fetch open interest: ${errorMsg}`,
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
        content: { text: "what's the total money in polymarket right now?" },
      },
      {
        name: "{{agent}}",
        content: {
          text: " Fetching Polymarket open interest...",
          action: "GET_POLYMARKET_OPEN_INTEREST",
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: { text: "show me polymarket tvl" },
      },
      {
        name: "{{agent}}",
        content: {
          text: " Getting total value locked...",
          action: "GET_POLYMARKET_OPEN_INTEREST",
        },
      },
    ],
  ],
};

export default getOpenInterestAction;
