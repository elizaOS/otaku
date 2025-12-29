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

type GetMarketPriceHistoryActionResult = ActionResult & {
  input: GetMarketPriceHistoryInput;
};

// Helper to convert days to interval
function daysToInterval(days: number): string {
  if (days <= 1) return "1d";
  if (days <= 7) return "1w";
  return "max";
}

// Helper to format price change
function formatPriceChange(
  firstPrice: number,
  lastPrice: number
): { value: number; percentage: number } {
  const change = lastPrice - firstPrice;
  const changePercent = (change / firstPrice) * 100;
  return { value: change, percentage: changePercent };
}

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
        "Time interval for the chart: '1m', '1h', '6h', '1d', '1w', 'max'. Defaults to '1d' (1 day).",
      required: false,
    },
    days: {
      type: "number",
      description:
        "Alternative to interval: number of days of history to fetch. Will be converted to appropriate interval.",
      required: false,
    },
  },

  validate: async (runtime: IAgentRuntime, _message: Memory) => {
    try {
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

      // Validate condition ID format
      if (!conditionId.startsWith("0x") || conditionId.length !== 66) {
        const errorMsg = `Invalid condition ID format: ${conditionId}`;
        logger.error(`[GET_POLYMARKET_PRICE_HISTORY] ${errorMsg}`);
        const errorResult: ActionResult = {
          text: `${errorMsg}. Expected 66-character hex string starting with 0x.`,
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
      let interval = params.interval?.trim()?.toLowerCase() || "1d";
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

      // Calculate price change
      let priceChange: { value: number; percentage: number } | null = null;
      if (historyData.data_points.length > 0) {
        const firstPrice = historyData.data_points[0].price;
        const lastPrice =
          historyData.data_points[historyData.data_points.length - 1].price;
        priceChange = formatPriceChange(firstPrice, lastPrice);
      }

      // Format summary text
      let text = `**Market Price History**\n\n`;

      if (historyData.market_question) {
        text += `**Market:** ${historyData.market_question}\n\n`;
      }

      text += `**${outcome} Outcome - ${interval.toUpperCase()} Chart:**\n`;
      text += `- Current Price: ${historyData.current_price ? `$${historyData.current_price.toFixed(4)} (${(historyData.current_price * 100).toFixed(1)}%)` : "N/A"}\n`;

      if (priceChange) {
        const sign = priceChange.value >= 0 ? "+" : "";
        text += `- Price Change: ${sign}$${priceChange.value.toFixed(4)} (${sign}${priceChange.percentage.toFixed(2)}%)\n`;
      }

      text += `- Data Points: ${historyData.data_points.length}\n`;
      text += `- Timeframe: ${interval}\n\n`;

      // Add trend analysis
      if (priceChange) {
        const trend = priceChange.value >= 0 ? "upward" : "downward";
        const strength =
          Math.abs(priceChange.percentage) > 10
            ? "strong"
            : Math.abs(priceChange.percentage) > 5
              ? "moderate"
              : "slight";
        text += `**Trend Analysis:** ${strength} ${trend} movement over the period.\n\n`;
      }

      text += `Please analyze this price history data and provide insights about the market's trend, volatility, and any notable patterns.`;

      const result: GetMarketPriceHistoryActionResult = {
        text,
        success: true,
        data: {
          ...historyData,
          price_change: priceChange,
        },
        values: {
          ...historyData,
          price_change: priceChange,
        },
        input: inputParams,
      };

      if (callback) {
        await callback({
          text,
          actions: ["GET_POLYMARKET_PRICE_HISTORY"],
          content: {
            ...historyData,
            price_change: priceChange,
          } as any,
          source: message.content.source,
        });
      }

      logger.info(
        `[GET_POLYMARKET_PRICE_HISTORY] Successfully fetched price history - ${historyData.data_points.length} data points, current: $${historyData.current_price?.toFixed(4) || "N/A"}`
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
        interval: params.interval || (params.days ? daysToInterval(params.days) : "1d"),
      };

      const errorText = `Failed to fetch market price history: ${errorMsg}

Please check the following:
1. **Condition ID**: Must be a valid 66-character hex string starting with 0x
2. **Outcome**: Optional - 'YES' or 'NO' (default: 'YES')
3. **Interval**: Optional - '1m', '1h', '6h', '1d', '1w', 'max' (default: '1d')

Example: "Show me the price history for market 0x1234... for the YES outcome over 1 week"`;

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
