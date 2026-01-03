/**
 * GET_POLYMARKET_TOP_HOLDERS Action
 *
 * Get top holders (major participants) in a specific market
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
import type { TopHolder } from "../types";
import {
  validatePolymarketService,
  getPolymarketService,
  extractActionParams,
} from "../utils/actionHelpers";

interface GetTopHoldersParams {
  conditionId?: string;
}

type GetTopHoldersInput = {
  conditionId?: string;
};

type GetTopHoldersActionResult = ActionResult & { input: GetTopHoldersInput };

export const getTopHoldersAction: Action = {
  name: "GET_POLYMARKET_TOP_HOLDERS",
  similes: [
    "MARKET_HOLDERS",
    "TOP_TRADERS",
    "BIG_PLAYERS",
    "MAJOR_POSITIONS",
    "WHALE_POSITIONS",
    "MARKET_PARTICIPANTS",
  ],
  description:
    "Get top holders (major participants) in a Polymarket prediction market. Shows largest positions by wallet.",

  parameters: {
    conditionId: {
      type: "string",
      description: "Market condition ID (hex string starting with 0x) to check top holders for",
      required: false,
    },
  },

  validate: async (runtime: IAgentRuntime, message: Memory, state?: State) => {
    return validatePolymarketService(runtime, "GET_POLYMARKET_TOP_HOLDERS", state, message);
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    try {
      logger.info("[GET_POLYMARKET_TOP_HOLDERS] Getting top holders");

      // Read parameters from state
      const params = await extractActionParams<GetTopHoldersParams>(runtime, message);

      // Extract condition ID
      const conditionId = params.conditionId?.trim();

      if (!conditionId) {
        const errorMsg = "Condition ID is required";
        logger.error(`[GET_POLYMARKET_TOP_HOLDERS] ${errorMsg}`);
        const errorResult: GetTopHoldersActionResult = {
          text: ` ${errorMsg}. Please provide a market condition ID (hex string starting with 0x) to check top holders.`,
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

      const inputParams: GetTopHoldersInput = { conditionId };

      // Get service
      const service = getPolymarketService(runtime);

      if (!service) {
        const errorMsg = "Polymarket service not available";
        logger.error(`[GET_POLYMARKET_TOP_HOLDERS] ${errorMsg}`);
        const errorResult: GetTopHoldersActionResult = {
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

      // Fetch top holders
      logger.info(`[GET_POLYMARKET_TOP_HOLDERS] Fetching top holders for market ${conditionId}`);
      const holders = await service.getTopHolders(conditionId);

      if (holders.length === 0) {
        const result: GetTopHoldersActionResult = {
          text: ` No top holders found for market ${conditionId}.`,
          success: true,
          data: { holders: [], count: 0 },
          input: inputParams,
        };
        return result;
      }

      // Format response
      let text = ` **Top Holders for Market ${conditionId.slice(0, 10)}...${conditionId.slice(-8)}**\n\n`;
      text += `Found ${holders.length} top holder${holders.length > 1 ? "s" : ""}:\n\n`;

      // Group by outcome
      const yesHolders = holders.filter((h) => h.outcome === "YES");
      const noHolders = holders.filter((h) => h.outcome === "NO");

      if (yesHolders.length > 0) {
        text += `**YES Positions:**\n`;
        yesHolders.forEach((holder: TopHolder, index: number) => {
          const addressDisplay = holder.is_public
            ? holder.address
            : `${holder.address.slice(0, 6)}...${holder.address.slice(-4)} (anon)`;

          text += `${index + 1}. ${addressDisplay}\n`;
          text += `   Size: ${parseFloat(holder.size).toFixed(2)} shares\n`;
          text += `   Value: $${parseFloat(holder.value).toFixed(2)}\n`;
          text += `   % of Market: ${holder.percentage}%\n`;
        });
        text += "\n";
      }

      if (noHolders.length > 0) {
        text += `**NO Positions:**\n`;
        noHolders.forEach((holder: TopHolder, index: number) => {
          const addressDisplay = holder.is_public
            ? holder.address
            : `${holder.address.slice(0, 6)}...${holder.address.slice(-4)} (anon)`;

          text += `${index + 1}. ${addressDisplay}\n`;
          text += `   Size: ${parseFloat(holder.size).toFixed(2)} shares\n`;
          text += `   Value: $${parseFloat(holder.value).toFixed(2)}\n`;
          text += `   % of Market: ${holder.percentage}%\n`;
        });
        text += "\n";
      }

      // Calculate total value
      const totalValue = holders.reduce((sum, h) => sum + parseFloat(h.value), 0);

      text += `**Summary:**\n`;
      text += `   Total Top Holders: ${holders.length}\n`;
      text += `   YES: ${yesHolders.length} | NO: ${noHolders.length}\n`;
      text += `   Total Value: $${totalValue.toFixed(2)}\n`;

      const result: GetTopHoldersActionResult = {
        text,
        success: true,
        data: {
          holders: holders.map((h) => ({
            address: h.address,
            outcome: h.outcome,
            size: h.size,
            value: h.value,
            percentage: h.percentage,
            is_public: h.is_public,
          })),
          count: holders.length,
          yes_count: yesHolders.length,
          no_count: noHolders.length,
          total_value: totalValue.toFixed(2),
        },
        input: inputParams,
      };

      logger.info(
        `[GET_POLYMARKET_TOP_HOLDERS] Successfully fetched ${holders.length} top holders`
      );
      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`[GET_POLYMARKET_TOP_HOLDERS] Error: ${errorMsg}`);
      const errorResult: ActionResult = {
        text: ` Failed to get top holders: ${errorMsg}`,
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
          text: "show top holders for market 0x1234567890123456789012345678901234567890",
        },
      },
      {
        name: "{{agent}}",
        content: {
          text: " Getting top holders for this market...",
          action: "GET_POLYMARKET_TOP_HOLDERS",
          conditionId: "0x1234567890123456789012345678901234567890",
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: { text: "who are the whales in this polymarket?" },
      },
      {
        name: "{{agent}}",
        content: {
          text: " Checking major participants...",
          action: "GET_POLYMARKET_TOP_HOLDERS",
          conditionId: "0x1234567890123456789012345678901234567890",
        },
      },
    ],
  ],
};

export default getTopHoldersAction;
