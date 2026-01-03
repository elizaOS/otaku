/**
 * GET_POLYMARKET_EVENTS Action
 *
 * Browse prediction events from Polymarket.
 * Events are higher-level groupings that contain multiple related markets.
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
import type { EventFilters } from "../types";
import {
  validatePolymarketService,
  getPolymarketService,
  extractActionParams,
} from "../utils/actionHelpers";

interface GetEventsParams {
  active?: string | boolean;
  tag?: string;
  limit?: string | number;
}

type GetEventsInput = EventFilters;

type GetEventsActionResult = ActionResult & { input: GetEventsInput };

export const getEventsAction: Action = {
  name: "GET_POLYMARKET_EVENTS",
  similes: [
    "BROWSE_POLYMARKET_EVENTS",
    "LIST_POLYMARKET_EVENTS",
    "SHOW_EVENTS",
    "POLYMARKET_EVENTS",
    "WHAT_EVENTS",
  ],
  description:
    "Browse prediction events from Polymarket. Events are higher-level groupings that contain multiple related markets (e.g., '2024 US Election' contains markets for different races).",

  parameters: {
    active: {
      type: "boolean",
      description: "Filter by active status (default: true)",
      required: false,
    },
    tag: {
      type: "string",
      description: "Filter by event tag (e.g., 'politics', 'sports')",
      required: false,
    },
    limit: {
      type: "number",
      description: "Maximum number of events to return (default: 20, max: 50)",
      required: false,
    },
  },

  validate: async (runtime: IAgentRuntime, message: Memory, state?: State) => {
    return validatePolymarketService(runtime, "GET_POLYMARKET_EVENTS", state, message);
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    try {
      logger.info("[GET_POLYMARKET_EVENTS] Fetching events");

      // Extract parameters
      const params = await extractActionParams<GetEventsParams>(runtime, message);

      // Parse parameters
      let active: boolean | undefined;
      if (params.active !== undefined) {
        active = typeof params.active === "string"
          ? params.active.toLowerCase() === "true"
          : Boolean(params.active);
      }

      const tag = params.tag;

      let limit = 20; // default
      if (params.limit) {
        const parsedLimit =
          typeof params.limit === "string" ? parseInt(params.limit, 10) : params.limit;
        if (!isNaN(parsedLimit) && parsedLimit > 0) {
          limit = Math.min(parsedLimit, 50); // cap at 50
        }
      }

      const inputParams: GetEventsInput = {
        active,
        tag,
        limit,
      };

      // Get service
      const service = getPolymarketService(runtime);
      if (!service) {
        const errorMsg = "Polymarket service not available";
        logger.error(`[GET_POLYMARKET_EVENTS] ${errorMsg}`);
        const errorResult: GetEventsActionResult = {
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

      // Fetch events
      logger.info(`[GET_POLYMARKET_EVENTS] Fetching events with filters: ${JSON.stringify(inputParams)}`);
      const events = await service.getEvents(inputParams);

      if (events.length === 0) {
        const result: GetEventsActionResult = {
          text: " No events found matching your criteria.",
          success: true,
          data: { events: [], count: 0 },
          input: inputParams,
        };
        return result;
      }

      // Format response
      let text = ` **Polymarket Events**\n\n`;
      text += `Found ${events.length} events:\n\n`;

      events.forEach((event, index) => {
        text += `**${index + 1}. ${event.title}**\n`;

        if (event.description) {
          // Truncate description if too long
          const desc = event.description.length > 150
            ? event.description.substring(0, 150) + "..."
            : event.description;
          text += `   ${desc}\n`;
        }

        if (event.market_count !== undefined) {
          text += `   Markets: ${event.market_count}\n`;
        }

        if (event.tags && event.tags.length > 0) {
          text += `   Tags: ${event.tags.map(t => t.label).join(", ")}\n`;
        }

        if (event.id) {
          text += `   ID: ${event.id}\n`;
        }

        if (event.slug) {
          text += `   Slug: ${event.slug}\n`;
        }

        text += "\n";
      });

      text += "_Use GET_POLYMARKET_EVENT_DETAIL to see all markets for a specific event._";

      const result: GetEventsActionResult = {
        text,
        success: true,
        data: {
          events: events.map((event) => ({
            id: event.id,
            slug: event.slug,
            title: event.title,
            description: event.description,
            market_count: event.market_count,
            tags: event.tags,
            active: event.active,
          })),
          count: events.length,
        },
        input: inputParams,
      };

      logger.info(`[GET_POLYMARKET_EVENTS] Successfully fetched ${events.length} events`);
      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`[GET_POLYMARKET_EVENTS] Error: ${errorMsg}`);
      const errorResult: ActionResult = {
        text: ` Failed to fetch events: ${errorMsg}`,
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
        content: { text: "what events are available on polymarket?" },
      },
      {
        name: "{{agent}}",
        content: {
          text: " Fetching Polymarket events...",
          action: "GET_POLYMARKET_EVENTS",
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: { text: "show me politics events on polymarket" },
      },
      {
        name: "{{agent}}",
        content: {
          text: " Getting politics events...",
          action: "GET_POLYMARKET_EVENTS",
          tag: "politics",
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: { text: "list 10 active prediction events" },
      },
      {
        name: "{{agent}}",
        content: {
          text: " Fetching 10 active events...",
          action: "GET_POLYMARKET_EVENTS",
          active: true,
          limit: 10,
        },
      },
    ],
  ],
};

export default getEventsAction;
