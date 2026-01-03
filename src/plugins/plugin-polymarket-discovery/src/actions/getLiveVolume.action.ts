/**
 * GET_POLYMARKET_LIVE_VOLUME Action
 *
 * Get real-time trading volume (24h rolling)
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

type GetLiveVolumeInput = Record<string, never>;

type GetLiveVolumeActionResult = ActionResult & {
  input: GetLiveVolumeInput;
};

export const getLiveVolumeAction: Action = {
  name: "GET_POLYMARKET_LIVE_VOLUME",
  similes: [
    "LIVE_VOLUME",
    "POLYMARKET_VOLUME",
    "TRADING_VOLUME",
    "24H_VOLUME",
    "MARKET_ACTIVITY",
  ],
  description:
    "Get real-time trading volume (24h rolling) across all Polymarket markets. Useful for tracking market activity and identifying actively traded markets.",

  parameters: {},

  validate: async (runtime: IAgentRuntime, message: Memory, state?: State) => {
    return validatePolymarketService(runtime, "GET_POLYMARKET_LIVE_VOLUME", state, message);
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    try {
      logger.info("[GET_POLYMARKET_LIVE_VOLUME] Fetching live volume");

      const inputParams: GetLiveVolumeInput = {};

      // Get service
      const service = getPolymarketService(runtime);

      if (!service) {
        const errorMsg = "Polymarket service not available";
        logger.error(`[GET_POLYMARKET_LIVE_VOLUME] ${errorMsg}`);
        const errorResult: GetLiveVolumeActionResult = {
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

      // Fetch live volume
      logger.info("[GET_POLYMARKET_LIVE_VOLUME] Fetching data");
      const volumeData = await service.getLiveVolume();

      // Format response
      const totalVolume = parseFloat(volumeData.total_volume_24h);
      const formattedVolume = totalVolume.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      });

      let text = ` **Polymarket Live Volume (24h)**\n\n`;
      text += `**Total 24h Volume:** ${formattedVolume}\n`;

      // Add top markets if available
      if (volumeData.markets && volumeData.markets.length > 0) {
        text += `\n**Top Markets by Volume:**\n\n`;
        const topMarkets = volumeData.markets
          .slice(0, 5) // Show top 5
          .map((market, index) => {
            const marketVolume = parseFloat(market.volume);
            const formattedMarketVolume = marketVolume.toLocaleString("en-US", {
              style: "currency",
              currency: "USD",
              minimumFractionDigits: 0,
              maximumFractionDigits: 0,
            });
            const question = market.question || "Unknown Market";
            return `${index + 1}. ${question} - ${formattedMarketVolume}`;
          });
        text += topMarkets.join("\n");
      }

      text += `\n\n_Volume represents total trading activity over the last 24 hours._`;

      const result: GetLiveVolumeActionResult = {
        text,
        success: true,
        data: {
          total_volume_24h: volumeData.total_volume_24h,
          total_volume_formatted: formattedVolume,
          markets_count: volumeData.markets?.length || 0,
          top_markets: volumeData.markets?.slice(0, 5).map((m) => ({
            condition_id: m.condition_id,
            volume: m.volume,
            question: m.question,
          })),
          timestamp: volumeData.timestamp || Date.now(),
        },
        input: inputParams,
      };

      logger.info(
        `[GET_POLYMARKET_LIVE_VOLUME] Successfully fetched volume: ${formattedVolume}`
      );
      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`[GET_POLYMARKET_LIVE_VOLUME] Error: ${errorMsg}`);
      const errorResult: ActionResult = {
        text: ` Failed to fetch live volume: ${errorMsg}`,
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
        content: { text: "which polymarket markets are most actively traded?" },
      },
      {
        name: "{{agent}}",
        content: {
          text: " Fetching live trading volume...",
          action: "GET_POLYMARKET_LIVE_VOLUME",
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: { text: "show me 24h volume for polymarket" },
      },
      {
        name: "{{agent}}",
        content: {
          text: " Getting 24h trading volume...",
          action: "GET_POLYMARKET_LIVE_VOLUME",
        },
      },
    ],
  ],
};

export default getLiveVolumeAction;
