/**
 * GET_POLYMARKET_EVENT_DETAIL Action
 *
 * Get detailed information about a specific Polymarket event,
 * including all associated markets.
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
import {
  validatePolymarketService,
  getPolymarketService,
  extractActionParams,
} from "../utils/actionHelpers";

interface GetEventDetailParams {
  event_id?: string;
  event_slug?: string;
}

type GetEventDetailInput = {
  event_id_or_slug: string;
};

type GetEventDetailActionResult = ActionResult & { input: GetEventDetailInput };

export const getEventDetailAction: Action = {
  name: "GET_POLYMARKET_EVENT_DETAIL",
  similes: [
    "POLYMARKET_EVENT_DETAIL",
    "SHOW_EVENT_MARKETS",
    "EVENT_DETAILS",
    "GET_EVENT_INFO",
  ],
  description:
    "Get detailed information about a specific Polymarket event, including all associated markets. Provide either event_id or event_slug.",

  parameters: {
    event_id: {
      type: "string",
      description: "Event ID to fetch details for",
      required: false,
    },
    event_slug: {
      type: "string",
      description: "Event slug (URL-friendly identifier) to fetch details for",
      required: false,
    },
  },

  validate: async (runtime: IAgentRuntime, message: Memory, state?: State) => {
    return validatePolymarketService(runtime, "GET_POLYMARKET_EVENT_DETAIL", state, message);
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    try {
      logger.info("[GET_POLYMARKET_EVENT_DETAIL] Fetching event detail");

      // Extract parameters
      const params = await extractActionParams<GetEventDetailParams>(runtime, message);

      // Validate that at least one identifier is provided
      const eventIdOrSlug = params.event_id || params.event_slug;
      if (!eventIdOrSlug) {
        const errorMsg = "Either event_id or event_slug must be provided";
        logger.error(`[GET_POLYMARKET_EVENT_DETAIL] ${errorMsg}`);
        const errorResult: ActionResult = {
          text: ` ${errorMsg}`,
          success: false,
          error: "missing_parameter",
        };
        callback?.({
          text: errorResult.text,
          content: { error: "missing_parameter", details: errorMsg },
        });
        return errorResult;
      }

      const inputParams: GetEventDetailInput = {
        event_id_or_slug: eventIdOrSlug,
      };

      // Get service
      const service = getPolymarketService(runtime);
      if (!service) {
        const errorMsg = "Polymarket service not available";
        logger.error(`[GET_POLYMARKET_EVENT_DETAIL] ${errorMsg}`);
        const errorResult: GetEventDetailActionResult = {
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

      // Fetch event detail
      logger.info(`[GET_POLYMARKET_EVENT_DETAIL] Fetching event: ${eventIdOrSlug}`);
      const event = await service.getEventDetail(eventIdOrSlug);

      // Format response
      let text = ` **${event.title}**\n\n`;

      if (event.description) {
        text += `**Description:**\n${event.description}\n\n`;
      }

      if (event.tags && event.tags.length > 0) {
        text += `**Tags:** ${event.tags.map(t => t.label).join(", ")}\n\n`;
      }

      if (event.start_date) {
        text += `**Start Date:** ${new Date(event.start_date).toLocaleDateString()}\n`;
      }

      if (event.end_date) {
        text += `**End Date:** ${new Date(event.end_date).toLocaleDateString()}\n`;
      }

      text += `\n**Markets (${event.markets?.length || 0}):**\n\n`;

      if (event.markets && event.markets.length > 0) {
        event.markets.forEach((market, index) => {
          text += `${index + 1}. ${market.question}\n`;
          if (market.category) {
            text += `   Category: ${market.category}\n`;
          }
          if (market.volume) {
            const volumeNum = parseFloat(market.volume);
            if (!isNaN(volumeNum)) {
              text += `   Volume: $${volumeNum.toLocaleString()}\n`;
            }
          }
          text += `   Condition ID: ${market.conditionId}\n`;
          text += "\n";
        });
      } else {
        text += "_No markets found for this event._\n\n";
      }

      text += "_Use GET_POLYMARKET_DETAIL to get detailed information about a specific market._";

      const result: GetEventDetailActionResult = {
        text,
        success: true,
        data: {
          event_id: event.id,
          event_slug: event.slug,
          title: event.title,
          description: event.description,
          tags: event.tags,
          start_date: event.start_date,
          end_date: event.end_date,
          markets: event.markets?.map((market) => ({
            condition_id: market.conditionId,
            question: market.question,
            category: market.category,
            volume: market.volume,
          })),
          market_count: event.markets?.length || 0,
        },
        input: inputParams,
      };

      logger.info(
        `[GET_POLYMARKET_EVENT_DETAIL] Successfully fetched event: ${event.title} (${event.markets?.length || 0} markets)`
      );
      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`[GET_POLYMARKET_EVENT_DETAIL] Error: ${errorMsg}`);
      const errorResult: ActionResult = {
        text: ` Failed to fetch event detail: ${errorMsg}`,
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
        content: { text: "show me details for event 2024-us-election" },
      },
      {
        name: "{{agent}}",
        content: {
          text: " Fetching event details...",
          action: "GET_POLYMARKET_EVENT_DETAIL",
          event_slug: "2024-us-election",
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: { text: "what markets are in the election event?" },
      },
      {
        name: "{{agent}}",
        content: {
          text: " Getting event markets...",
          action: "GET_POLYMARKET_EVENT_DETAIL",
          event_slug: "election",
        },
      },
    ],
  ],
};

export default getEventDetailAction;
