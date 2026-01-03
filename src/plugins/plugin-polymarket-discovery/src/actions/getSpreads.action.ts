/**
 * GET_POLYMARKET_SPREADS Action
 *
 * Get bid-ask spread analysis for liquidity quality
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

type GetSpreadsInput = Record<string, never>;

type GetSpreadsActionResult = ActionResult & {
  input: GetSpreadsInput;
};

export const getSpreadsAction: Action = {
  name: "GET_POLYMARKET_SPREADS",
  similes: [
    "SPREADS",
    "POLYMARKET_SPREADS",
    "BID_ASK_SPREAD",
    "LIQUIDITY_QUALITY",
    "MARKET_SPREADS",
  ],
  description:
    "Get bid-ask spread analysis for Polymarket markets. Useful for assessing liquidity quality and identifying markets with better execution.",

  parameters: {},

  validate: async (runtime: IAgentRuntime, message: Memory, state?: State) => {
    return validatePolymarketService(runtime, "GET_POLYMARKET_SPREADS", state, message);
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    try {
      logger.info("[GET_POLYMARKET_SPREADS] Fetching spreads");

      const inputParams: GetSpreadsInput = {};

      // Get service
      const service = getPolymarketService(runtime);

      if (!service) {
        const errorMsg = "Polymarket service not available";
        logger.error(`[GET_POLYMARKET_SPREADS] ${errorMsg}`);
        const errorResult: GetSpreadsActionResult = {
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

      // Fetch spreads
      logger.info("[GET_POLYMARKET_SPREADS] Fetching data");
      const spreadsData = await service.getSpreads();

      if (spreadsData.length === 0) {
        const result: GetSpreadsActionResult = {
          text: " No spread data available at the moment.",
          success: true,
          data: { spreads: [], count: 0 },
          input: inputParams,
        };
        return result;
      }

      // Sort by spread percentage (lower is better)
      const sortedSpreads = [...spreadsData].sort((a, b) => {
        const spreadA = parseFloat(a.spread_percentage);
        const spreadB = parseFloat(b.spread_percentage);
        return spreadA - spreadB;
      });

      // Format response - show top 10 tightest spreads
      let text = ` **Polymarket Bid-Ask Spreads**\n\n`;
      text += `Analyzed ${spreadsData.length} markets. Showing top 10 with tightest spreads:\n\n`;

      const topSpreads = sortedSpreads.slice(0, 10);
      topSpreads.forEach((spread, index) => {
        const question = spread.question || `Market ${spread.condition_id.slice(0, 8)}...`;
        const spreadPct = parseFloat(spread.spread_percentage).toFixed(2);
        const bestBid = (parseFloat(spread.best_bid) * 100).toFixed(1);
        const bestAsk = (parseFloat(spread.best_ask) * 100).toFixed(1);

        text += `${index + 1}. **${question}**\n`;
        text += `   Spread: ${spreadPct}% | Bid: ${bestBid}% | Ask: ${bestAsk}%\n`;

        if (spread.liquidity_score !== undefined) {
          text += `   Liquidity Score: ${spread.liquidity_score}/100\n`;
        }
        text += `\n`;
      });

      text += `_Lower spreads indicate better liquidity and execution quality._`;

      const result: GetSpreadsActionResult = {
        text,
        success: true,
        data: {
          spreads: topSpreads.map((s) => ({
            condition_id: s.condition_id,
            spread: s.spread,
            spread_percentage: s.spread_percentage,
            best_bid: s.best_bid,
            best_ask: s.best_ask,
            question: s.question,
            liquidity_score: s.liquidity_score,
          })),
          total_markets: spreadsData.length,
          avg_spread_percentage: (
            spreadsData.reduce((sum, s) => sum + parseFloat(s.spread_percentage), 0) /
            spreadsData.length
          ).toFixed(2),
        },
        input: inputParams,
      };

      logger.info(
        `[GET_POLYMARKET_SPREADS] Successfully fetched spreads for ${spreadsData.length} markets`
      );
      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`[GET_POLYMARKET_SPREADS] Error: ${errorMsg}`);
      const errorResult: ActionResult = {
        text: ` Failed to fetch spreads: ${errorMsg}`,
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
        content: { text: "where can i get the best execution on polymarket?" },
      },
      {
        name: "{{agent}}",
        content: {
          text: " Analyzing bid-ask spreads...",
          action: "GET_POLYMARKET_SPREADS",
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: { text: "show me polymarket markets with best liquidity" },
      },
      {
        name: "{{agent}}",
        content: {
          text: " Fetching spread analysis...",
          action: "GET_POLYMARKET_SPREADS",
        },
      },
    ],
  ],
};

export default getSpreadsAction;
