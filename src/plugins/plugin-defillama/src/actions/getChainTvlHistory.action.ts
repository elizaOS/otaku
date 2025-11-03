import {
  Action,
  ActionResult,
  HandlerCallback,
  HandlerOptions,
  IAgentRuntime,
  Memory,
  State,
  logger,
} from "@elizaos/core";
import {
  DefiLlamaService,
  type ChainTvlHistoryOptions,
  type ChainTvlPoint,
} from "../services/defillama.service";
import {
  limitSeries,
  parsePositiveInteger,
  respondWithError,
  sanitizeChainName,
  sanitizeFilterSegment,
} from "../utils/action-helpers";

const DEFAULT_CHAIN_HISTORY_WINDOW = 365;

export const getChainTvlHistoryAction: Action = {
  name: "GET_CHAIN_TVL_HISTORY",
  similes: [
    "CHAIN_TVL_HISTORY",
    "CHAIN_TVL_TREND",
    "CHAIN_TVL_CHART",
  ],
  description: "Fetch historical TVL data for a specific blockchain, optionally filtered by segment (e.g., staking).",
  parameters: {
    chain: {
      type: "string",
      description: "Chain name (e.g., 'Ethereum', 'Base').",
      required: true,
    },
    filter: {
      type: "string",
      description: "Optional DefiLlama filter (e.g., 'staking', 'borrowed', 'pool2').",
      required: false,
    },
    days: {
      type: "number",
      description: "Optional number of most recent days to include (default 365).",
      required: false,
    },
  },
  validate: async (runtime: IAgentRuntime): Promise<boolean> => {
    const svc = runtime.getService(DefiLlamaService.serviceType) as DefiLlamaService | undefined;
    if (!svc) {
      logger.error("DefiLlamaService not available");
      return false;
    }
    return true;
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: HandlerOptions,
    callback?: HandlerCallback,
  ): Promise<ActionResult> => {
    try {
      const svc = runtime.getService(DefiLlamaService.serviceType) as DefiLlamaService | undefined;
      if (!svc) {
        throw new Error("DefiLlamaService not available");
      }

      const composedState = await runtime.composeState(message, ["ACTION_STATE"], true);
      const params = composedState?.data?.actionParams ?? {};

      const chainParamRaw = typeof params?.chain === "string" ? params.chain.trim() : "";
      const chainParam = sanitizeChainName(chainParamRaw);
      if (!chainParamRaw || !chainParam) {
        const errorMsg = "Missing required parameter 'chain'.";
        logger.error(`[GET_CHAIN_TVL_HISTORY] ${errorMsg}`);
        return await respondWithError(callback, errorMsg, chainParamRaw ? "invalid_parameter" : "missing_required_parameter", {
          chain: chainParamRaw,
        });
      }

      const filterParamRaw = typeof params?.filter === "string" ? params.filter.trim() : "";
      const filterParam = sanitizeFilterSegment(filterParamRaw);
      if (filterParamRaw && !filterParam) {
        const errorMsg = "Invalid 'filter' parameter. Use lowercase letters or hyphen (e.g., staking).";
        logger.error(`[GET_CHAIN_TVL_HISTORY] ${errorMsg}`);
        return await respondWithError(callback, errorMsg, "invalid_parameter", { filter: filterParamRaw });
      }

      const daysParamRaw = params?.days;
      const daysParam =
        typeof daysParamRaw === "string" || typeof daysParamRaw === "number"
          ? parsePositiveInteger(daysParamRaw)
          : undefined;
      const limitDays = daysParam ?? DEFAULT_CHAIN_HISTORY_WINDOW;

      const options: ChainTvlHistoryOptions | undefined = filterParam
        ? { filter: filterParam }
        : undefined;

      logger.info(
        `[GET_CHAIN_TVL_HISTORY] Fetching chain history for chain='${chainParam}'${filterParam ? ` filter='${filterParam}'` : ""}`,
      );

      const series = await svc.getChainTvlHistory(chainParam, options);
      const limitedSeries = limitSeries(series, limitDays);

      if (limitedSeries.length === 0) {
        const errorMsg = `No TVL history data returned for chain '${chainParam}'.`;
        logger.warn(`[GET_CHAIN_TVL_HISTORY] ${errorMsg}`);
        return await respondWithError(callback, errorMsg, "empty_series", { chain: chainParam });
      }

      const messageText = filterParam
        ? `Retrieved ${limitedSeries.length} TVL data points for ${chainParam} (${filterParam}).`
        : `Retrieved ${limitedSeries.length} TVL data points for ${chainParam}.`;

      const payload = {
        chain: chainParam,
        filter: filterParam || null,
        series: limitedSeries,
        meta: {
          totalPoints: limitedSeries.length,
          requestedDays: daysParam,
        },
      } satisfies ChainHistoryResponse;

      if (callback) {
        await callback({
          text: messageText,
          actions: ["GET_CHAIN_TVL_HISTORY"],
          content: payload,
          source: message.content.source,
        });
      }

      return {
        text: messageText,
        success: true,
        data: payload,
        input: {
          chain: chainParam,
          filter: filterParam || undefined,
          days: daysParam,
        },
      } as ActionResult & {
        input: {
          chain: string;
          filter?: string;
          days?: number;
        };
      };
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      logger.error(`[GET_CHAIN_TVL_HISTORY] Action failed: ${messageText}`);
      return await respondWithError(callback, `Failed to fetch chain TVL history: ${messageText}`, "action_failed");
    }
  },
  examples: [
    [
      {
        name: "{{user}}",
        content: { text: "Show me Ethereum's TVL history" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Retrieved 365 TVL data points for Ethereum.",
          actions: ["GET_CHAIN_TVL_HISTORY"],
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: { text: "Give Base staking TVL over the last 180 days" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Retrieved 180 TVL data points for Base (staking).",
          actions: ["GET_CHAIN_TVL_HISTORY"],
        },
      },
    ],
  ],
};

type ChainHistoryResponse = {
  chain: string;
  filter: string | null;
  series: ChainTvlPoint[];
  meta: {
    totalPoints: number;
    requestedDays?: number | null;
  };
};


