/**
 * GET_POLYMARKET_PRICE_HISTORY Action
 *
 * Get historical price data for a Polymarket prediction market.
 * Returns time-series data suitable for charting and trend analysis.
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
import { formatPriceChange } from "../utils/actionHelpers";
import type { PriceHistoryStatistics, MarketPriceHistory } from "../types";

interface GetMarketPriceHistoryParams {
  conditionId?: string;
  marketId?: string;
  outcome?: string;
  interval?: string;
  days?: number;
}

type GetMarketPriceHistoryInput = {
  conditionId: string;
  outcome: "YES" | "NO";
  interval: string;
};

/**
 * Summary data returned by the action (excludes large data_points array)
 * This is what gets stored in the database and displayed in UI
 */
interface PriceHistorySummary {
  condition_id: string;
  outcome: "YES" | "NO";
  token_id: string;
  interval: string;
  market_question?: string;
  current_price?: number;
  statistics: PriceHistoryStatistics;
}

type GetMarketPriceHistoryActionResult = ActionResult & {
  input: GetMarketPriceHistoryInput;
};

// Helper to convert days to interval
function daysToInterval(days: number): string {
  if (days <= 1) return "1d";
  if (days <= 7) return "1w";
  return "max";
}

/**
 * Compute summary statistics from price history data
 * This allows us to return useful info without storing thousands of data points
 */
function computeStatistics(historyData: MarketPriceHistory): PriceHistoryStatistics {
  const dataPoints = historyData.data_points;
  
  if (dataPoints.length === 0) {
    return {
      data_points_count: 0,
      was_downsampled: false,
      start_price: 0,
      end_price: 0,
      high_price: 0,
      low_price: 0,
      avg_price: 0,
      start_timestamp: 0,
      end_timestamp: 0,
      price_change: 0,
      price_change_percent: 0,
      trend: "stable",
    };
  }

  const prices = dataPoints.map(p => p.price);
  const startPrice = prices[0];
  const endPrice = prices[prices.length - 1];
  const highPrice = Math.max(...prices);
  const lowPrice = Math.min(...prices);
  const avgPrice = prices.reduce((sum, p) => sum + p, 0) / prices.length;
  
  const priceChange = endPrice - startPrice;
  const priceChangePercent = startPrice > 0 ? (priceChange / startPrice) * 100 : 0;
  
  // Determine trend (threshold of 1% to be considered movement)
  let trend: "up" | "down" | "stable" = "stable";
  if (priceChangePercent > 1) trend = "up";
  else if (priceChangePercent < -1) trend = "down";

  return {
    data_points_count: dataPoints.length,
    was_downsampled: false, // Service will set this if applicable
    start_price: startPrice,
    end_price: endPrice,
    high_price: highPrice,
    low_price: lowPrice,
    avg_price: avgPrice,
    start_timestamp: dataPoints[0].timestamp,
    end_timestamp: dataPoints[dataPoints.length - 1].timestamp,
    price_change: priceChange,
    price_change_percent: priceChangePercent,
    trend,
  };
}

// Note: formatPriceChange moved to actionHelpers.ts for reuse

export const getMarketPriceHistoryAction: Action = {
  name: "GET_POLYMARKET_PRICE_HISTORY",
  similes: [
    "POLYMARKET_CHART",
    "MARKET_HISTORY",
    "PRICE_HISTORY",
    "POLYMARKET_TREND",
    "MARKET_CHART",
    "HISTORICAL_ODDS",
  ],
  description:
    "Get historical price data for a Polymarket prediction market. Shows price movement over time for YES or NO outcomes. Use this when the user asks to see a price chart, trend, or historical data for a prediction market.",

  parameters: {
    conditionId: {
      type: "string",
      description:
        "Market condition ID (66-character hex string starting with 0x). Required to identify which market to fetch history for.",
      required: true,
    },
    outcome: {
      type: "string",
      description:
        "Which outcome to show history for: 'YES' or 'NO'. Defaults to 'YES' if not specified.",
      required: false,
    },
    interval: {
      type: "string",
      description:
        "Time interval for the chart: '1m', '1h', '6h', '1d', '1w', 'max'. Defaults to 'max' (full history).",
      required: false,
    },
    days: {
      type: "number",
      description:
        "Alternative to interval: number of days of history to fetch. Will be converted to appropriate interval.",
      required: false,
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
        logger.warn(
          "[GET_POLYMARKET_PRICE_HISTORY] Polymarket service not available"
        );
        return false;
      }

      return true;
    } catch (error) {
      logger.error(
        "[GET_POLYMARKET_PRICE_HISTORY] Error validating action:",
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
      logger.info("[GET_POLYMARKET_PRICE_HISTORY] Getting market price history");

      // Read parameters from state
      const composedState = await runtime.composeState(
        message,
        ["ACTION_STATE"],
        true
      );
      const params = (composedState?.data?.actionParams ?? {}) as Partial<
        GetMarketPriceHistoryParams
      >;

      // Extract and validate condition ID (required)
      const conditionId = (params.conditionId || params.marketId)?.trim();

      if (!conditionId) {
        const errorMsg = "Market condition ID is required";
        logger.error(`[GET_POLYMARKET_PRICE_HISTORY] ${errorMsg}`);
        const errorResult: ActionResult = {
          text: `${errorMsg}. Please provide the market condition ID to fetch price history.`,
          success: false,
          error: "missing_condition_id",
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
        logger.error(`[GET_POLYMARKET_PRICE_HISTORY] ${errorMsg}`);
        const errorResult: ActionResult = {
          text: `${errorMsg}. Expected hex string starting with 0x (40-70 chars).`,
          success: false,
          error: "invalid_condition_id",
        };
        callback?.({
          text: errorResult.text,
          content: { error: "invalid_condition_id", details: errorMsg },
        });
        return errorResult;
      }

      // Extract outcome parameter (defaults to YES)
      const outcomeRaw = params.outcome?.trim()?.toUpperCase() || "YES";
      if (outcomeRaw !== "YES" && outcomeRaw !== "NO") {
        const errorMsg = `Invalid outcome '${outcomeRaw}'. Must be 'YES' or 'NO'.`;
        logger.error(`[GET_POLYMARKET_PRICE_HISTORY] ${errorMsg}`);
        const errorResult: ActionResult = {
          text: errorMsg,
          success: false,
          error: "invalid_outcome",
        };
        callback?.({
          text: errorResult.text,
          content: { error: "invalid_outcome", details: errorMsg },
        });
        return errorResult;
      }
      const outcome = outcomeRaw as "YES" | "NO";

      // Extract interval parameter (or convert from days)
      // Default to 'max' to show full market history by default
      let interval = params.interval?.trim()?.toLowerCase() || "max";
      if (params.days) {
        interval = daysToInterval(params.days);
      }

      // Validate interval
      const validIntervals = ["1m", "1h", "6h", "1d", "1w", "max"];
      if (!validIntervals.includes(interval)) {
        const errorMsg = `Invalid interval '${interval}'. Valid options: ${validIntervals.join(", ")}`;
        logger.error(`[GET_POLYMARKET_PRICE_HISTORY] ${errorMsg}`);
        const errorResult: ActionResult = {
          text: errorMsg,
          success: false,
          error: "invalid_interval",
        };
        callback?.({
          text: errorResult.text,
          content: { error: "invalid_interval", details: errorMsg },
        });
        return errorResult;
      }

      const inputParams: GetMarketPriceHistoryInput = {
        conditionId,
        outcome,
        interval,
      };

      // Get service
      const service = runtime.getService(
        PolymarketService.serviceType
      ) as PolymarketService;

      if (!service) {
        const errorMsg = "Polymarket service not available";
        logger.error(`[GET_POLYMARKET_PRICE_HISTORY] ${errorMsg}`);
        const errorResult: GetMarketPriceHistoryActionResult = {
          text: `${errorMsg}`,
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

      // Fetch price history
      logger.info(
        `[GET_POLYMARKET_PRICE_HISTORY] Fetching history for ${conditionId}, outcome: ${outcome}, interval: ${interval}`
      );
      const historyData = await service.getMarketPriceHistory(
        conditionId,
        outcome,
        interval
      );

      // Compute statistics from the data (this is what we'll store/return, NOT the full array)
      const statistics = computeStatistics(historyData);

      // Calculate price change for display
      const priceChange = historyData.data_points.length > 0
        ? formatPriceChange(statistics.start_price, statistics.end_price)
        : null;

      // Create summary object (WITHOUT the large data_points array)
      // This is what gets stored in the database
      const summary: PriceHistorySummary = {
        condition_id: historyData.condition_id,
        outcome: historyData.outcome,
        token_id: historyData.token_id,
        interval: historyData.interval,
        market_question: historyData.market_question,
        current_price: historyData.current_price,
        statistics,
      };

      // Format concise text for agent context
      // Keep it minimal - agent doesn't need verbose formatting
      const trendArrow = statistics.trend === "up" ? "↑" : statistics.trend === "down" ? "↓" : "→";
      const changeSign = statistics.price_change_percent >= 0 ? "+" : "";
      
      // Format dates for context
      const startDate = new Date(statistics.start_timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      const endDate = new Date(statistics.end_timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      
      const text = `Price History: ${historyData.market_question || conditionId} (${outcome})
Period: ${startDate} → ${endDate} (${interval})
Start: ${(statistics.start_price * 100).toFixed(1)}% | Current: ${(statistics.end_price * 100).toFixed(1)}% | Change: ${changeSign}${statistics.price_change_percent.toFixed(1)}% ${trendArrow}
Range: ${(statistics.low_price * 100).toFixed(1)}%-${(statistics.high_price * 100).toFixed(1)}% | Avg: ${(statistics.avg_price * 100).toFixed(1)}%`;

      const result: GetMarketPriceHistoryActionResult = {
        text,
        success: true,
        // Return ONLY the summary (no data_points array) to avoid bloating DB/context
        data: { ...summary } as Record<string, unknown>,
        values: { ...summary } as Record<string, unknown>,
        input: inputParams,
      };

      if (callback) {
        await callback({
          text,
          actions: ["GET_POLYMARKET_PRICE_HISTORY"],
          // IMPORTANT: Only send summary to avoid storing thousands of data points in DB
          content: summary as any,
          source: message.content.source,
        });
      }

      logger.info(
        `[GET_POLYMARKET_PRICE_HISTORY] Successfully fetched price history - ${statistics.data_points_count} data points analyzed, current: $${statistics.end_price?.toFixed(4) || "N/A"}, trend: ${statistics.trend}`
      );
      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`[GET_POLYMARKET_PRICE_HISTORY] Error: ${errorMsg}`);

      // Try to capture input params even in failure
      const composedState = await runtime.composeState(
        message,
        ["ACTION_STATE"],
        true
      );
      const params = (composedState?.data?.actionParams ?? {}) as Partial<
        GetMarketPriceHistoryParams
      >;
      const failureInputParams = {
        conditionId: params.conditionId || params.marketId || "",
        outcome: (params.outcome?.toUpperCase() || "YES") as "YES" | "NO",
        interval: params.interval || (params.days ? daysToInterval(params.days) : "max"),
      };

      const errorText = `Failed to fetch market price history: ${errorMsg}

Please check the following:
1. **Condition ID**: Must be a valid 66-character hex string starting with 0x
2. **Outcome**: Optional - 'YES' or 'NO' (default: 'YES')
3. **Interval**: Optional - '1m', '1h', '6h', '1d', '1w', 'max' (default: 'max' for full history)

Example: "Show me the price history for market 0x1234... for the YES outcome"`;

      const errorResult: GetMarketPriceHistoryActionResult = {
        text: errorText,
        success: false,
        error: errorMsg,
        input: failureInputParams,
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
          text: "show me the price history for that market",
        },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Fetching price history chart...",
          action: "GET_POLYMARKET_PRICE_HISTORY",
          conditionId:
            "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: {
          text: "get the 1 week chart for the NO outcome on the Bitcoin market",
        },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Fetching 1 week price history for NO outcome...",
          action: "GET_POLYMARKET_PRICE_HISTORY",
          conditionId:
            "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
          outcome: "NO",
          interval: "1w",
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: {
          text: "what's the price trend over the last 7 days?",
        },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Analyzing 7 day price trend...",
          action: "GET_POLYMARKET_PRICE_HISTORY",
          conditionId:
            "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
          days: 7,
        },
      },
    ],
  ],
};

export default getMarketPriceHistoryAction;
