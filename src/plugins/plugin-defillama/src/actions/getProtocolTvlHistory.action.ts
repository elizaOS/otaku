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
  type ProtocolLookupResult,
  type ProtocolSummary,
  type ProtocolTvlHistory,
  type ProtocolTvlPoint,
} from "../services/defillama.service";
import { validateDefillamaService, getDefillamaService, extractActionParams } from "../utils/actionHelpers";
import {
  limitSeries,
  parsePositiveInteger,
  respondWithError,
  sanitizeChainName,
  downsampleSeries,
  calculateTvlSummary,
} from "../utils/actionHelpers";

const MAX_SERIES_DEFAULT = 365;
const MAX_POINTS_COMPACT = 30; // Maximum data points in compact mode

export const getProtocolTvlHistoryAction: Action = {
  name: "GET_PROTOCOL_TVL_HISTORY",
  similes: [
    "PROTOCOL_TVL_HISTORY",
    "DEFI_TVL_HISTORY",
    "TVL_TREND",
    "PROTOCOL_TVL_CHART",
  ],
  description:
    "Fetch historical TVL data for a specific DeFi protocol, with optional per-chain breakdown and lookback window. Use compact mode by default to reduce context size.",
  parameters: {
    protocol: {
      type: "string",
      description: "Protocol name or symbol (e.g., 'Aave', 'Curve').",
      required: true,
    },
    chain: {
      type: "string",
      description: "Optional chain name to return a focused breakdown (e.g., 'Ethereum').",
      required: false,
    },
    days: {
      type: "number",
      description: "Optional number of most recent days to include (default 365).",
      required: false,
    },
    compact: {
      type: "boolean",
      description: "If true (default), returns downsampled data (~30 points) plus summary statistics. Set to false for full data.",
      required: false,
    },
  },
  validate: async (runtime: IAgentRuntime, message: Memory, state?: State): Promise<boolean> => {
    return validateDefillamaService(runtime, "GET_PROTOCOL_TVL_HISTORY", state, message);
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: HandlerOptions,
    callback?: HandlerCallback,
  ): Promise<ActionResult> => {
    let validatedChain: string | undefined;
    try {
      const svc = getDefillamaService(runtime);
      if (!svc) {
        throw new Error("DefiLlamaService not available");
      }

      const params = await extractActionParams<{ protocol?: string; chain?: string; days?: number; compact?: boolean }>(runtime, message);

      const protocolParam = typeof params?.protocol === "string" ? params.protocol.trim() : "";
      if (!protocolParam) {
        const errorMsg = "Missing required parameter 'protocol'.";
        logger.error(`[GET_PROTOCOL_TVL_HISTORY] ${errorMsg}`);
        return await respondWithError(callback, errorMsg, "missing_required_parameter");
      }

      const chainParamRaw = typeof params?.chain === "string" ? params.chain.trim() : "";
      const chainParam = chainParamRaw ? sanitizeChainName(chainParamRaw) : undefined;
      if (chainParamRaw && !chainParam) {
        const errorMsg = "Invalid 'chain' parameter. Use letters, numbers, spaces, or -_/().";
        logger.error(`[GET_PROTOCOL_TVL_HISTORY] ${errorMsg}`);
        return await respondWithError(callback, errorMsg, "invalid_parameter", { chain: chainParamRaw });
      }
      validatedChain = chainParam;

      const daysParamRaw = params?.days;
      const parsedDays =
        typeof daysParamRaw === "string" || typeof daysParamRaw === "number"
          ? parsePositiveInteger(daysParamRaw)
          : undefined;
      const limitDays = parsedDays ?? MAX_SERIES_DEFAULT;

      // Parse compact parameter (default to true for efficiency)
      const compactMode = params?.compact !== false;

      const lookupResults = await svc.getProtocolsByNames([protocolParam]);
      const match = lookupResults.find(
        (result): result is ProtocolLookupResult & { data: ProtocolSummary } => Boolean(result.success && result.data),
      );

      if (!match || !match.data) {
        const errorMsg = `No protocol match found for '${protocolParam}'.`;
        logger.error(`[GET_PROTOCOL_TVL_HISTORY] ${errorMsg}`);
        return await respondWithError(callback, errorMsg, "no_protocol_match");
      }

      const slugCandidate = determineSlug(match.data);
      if (!slugCandidate) {
        const errorMsg = `Unable to resolve protocol slug for '${match.data.name}'.`;
        logger.error(`[GET_PROTOCOL_TVL_HISTORY] ${errorMsg}`);
        return await respondWithError(callback, errorMsg, "missing_protocol_slug");
      }

      logger.info(
        `[GET_PROTOCOL_TVL_HISTORY] Fetching history for slug='${slugCandidate}' (protocol='${match.data.name}')`,
      );

      const history = await svc.getProtocolTvlHistory(slugCandidate);
      const limitedTotalSeries = limitSeries(history.totalSeries, limitDays);

      if (limitedTotalSeries.length === 0) {
        const errorMsg = `No TVL history data returned for '${match.data.name}'.`;
        logger.warn(`[GET_PROTOCOL_TVL_HISTORY] ${errorMsg}`);
        return await respondWithError(callback, errorMsg, "empty_series", {
          protocol: match.data.name,
        });
      }

      const limitedChainSeries = buildChainSeries(history, chainParam, limitDays);

      // Apply downsampling and calculate summary in compact mode
      const finalTotalSeries = compactMode ? downsampleSeries(limitedTotalSeries, MAX_POINTS_COMPACT) : limitedTotalSeries;
      const finalChainSeries: Record<string, ProtocolTvlPoint[]> = {};
      for (const [chainName, series] of Object.entries(limitedChainSeries)) {
        finalChainSeries[chainName] = compactMode ? downsampleSeries(series, MAX_POINTS_COMPACT) : series;
      }

      // Calculate summary statistics for the full limited series (before downsampling)
      const totalSeriesSummary = calculateTvlSummary(limitedTotalSeries);
      const chainSeriesSummary: Record<string, ReturnType<typeof calculateTvlSummary>> = {};
      for (const [chainName, series] of Object.entries(limitedChainSeries)) {
        chainSeriesSummary[chainName] = calculateTvlSummary(series);
      }

      const messageText = chainParam
        ? `Retrieved ${limitedTotalSeries.length} TVL data points for ${match.data.name} on ${Object.keys(limitedChainSeries).join(", ")}${compactMode ? ` (downsampled to ${finalTotalSeries.length} points)` : ""}.`
        : `Retrieved ${limitedTotalSeries.length} TVL data points for ${match.data.name}${compactMode ? ` (downsampled to ${finalTotalSeries.length} points)` : ""}.`;

      const responsePayload = {
        protocol: {
          name: history.name,
          slug: history.slug,
          symbol: history.symbol,
          currentTvl: history.currentTvl,
          lastUpdated: history.lastUpdated,
        },
        totalSeries: finalTotalSeries,
        chainSeries: finalChainSeries,
        summary: {
          total: totalSeriesSummary,
          chains: chainSeriesSummary,
        },
        meta: {
          totalPoints: limitedTotalSeries.length,
          returnedPoints: finalTotalSeries.length,
          requestedDays: parsedDays,
          compactMode,
        },
      } satisfies ProtocolHistoryResponse;

      if (callback) {
        await callback({
          text: messageText,
          actions: ["GET_PROTOCOL_TVL_HISTORY"],
          content: responsePayload,
          source: message.content.source,
        });
      }

      return {
        text: messageText,
        success: true,
        data: responsePayload,
        input: {
          protocol: protocolParam,
          chain: chainParam,
          days: parsedDays,
          compact: compactMode,
        },
      } as ActionResult & {
        input: {
          protocol: string;
          chain?: string;
          days?: number;
          compact: boolean;
        };
      };
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      logger.error(`[GET_PROTOCOL_TVL_HISTORY] Action failed: ${messageText}`);
      const isChainMiss = validatedChain && messageText.includes("No chain breakdown matched");
      const responseMessage = isChainMiss
        ? messageText
        : `Failed to fetch protocol TVL history: ${messageText}`;
      const errorCode = isChainMiss ? "no_chain_match" : "action_failed";
      const details = isChainMiss ? { chain: validatedChain ?? null } : undefined;
      return await respondWithError(callback, responseMessage, errorCode, details ?? undefined);
    }
  },
  examples: [
    [
      {
        name: "{{user}}",
        content: { text: "Show TVL history for Aave" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Retrieved 365 TVL data points for Aave.",
          actions: ["GET_PROTOCOL_TVL_HISTORY"],
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: { text: "Give me Curve's Ethereum TVL trend over the last 90 days" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Retrieved 90 TVL data points for Curve DEX on Ethereum.",
          actions: ["GET_PROTOCOL_TVL_HISTORY"],
        },
      },
    ],
  ],
};

type TvlSummary = {
  current: number;
  min: number;
  max: number;
  ath: number;
  athDate: number;
  athDaysAgo: number;
  fromAth: number;
  fromAthPercent: number;
  average: number;
  change: number;
  changePercent: number;
  dataPoints: number;
  firstDate: number;
  lastDate: number;
} | null;

type ProtocolHistoryResponse = {
  protocol: {
    name: string;
    slug: string;
    symbol: string | null;
    currentTvl: number | null;
    lastUpdated: number | null;
  };
  totalSeries: ProtocolTvlPoint[];
  chainSeries: Record<string, ProtocolTvlPoint[]>;
  summary: {
    total: TvlSummary;
    chains: Record<string, TvlSummary>;
  };
  meta: {
    totalPoints: number;
    returnedPoints: number;
    requestedDays?: number | null;
    compactMode: boolean;
  };
};

function determineSlug(summary: ProtocolSummary): string | undefined {
  if (summary.slug && summary.slug.trim()) {
    return summary.slug.trim();
  }
  const slugified = summary.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slugified || undefined;
}

function buildChainSeries(
  history: ProtocolTvlHistory,
  chain: string | undefined,
  limit: number,
): Record<string, ProtocolTvlPoint[]> {
  const chainSeries: Record<string, ProtocolTvlPoint[]> = {};
  if (!chain) {
    for (const [chainName, series] of Object.entries(history.chainSeries)) {
      chainSeries[chainName] = limitSeries(series, limit);
    }
    return chainSeries;
  }

  const chainLookup = chain.toLowerCase();
  const matched = Object.entries(history.chainSeries).find(([chainName]) => chainName.toLowerCase() === chainLookup);
  if (matched) {
    chainSeries[matched[0]] = limitSeries(matched[1], limit);
    return chainSeries;
  }

  throw new Error(`No chain breakdown matched '${chain}'.`);
}


