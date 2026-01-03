import {
  Action,
  ActionResult,
  HandlerCallback,
  IAgentRuntime,
  Memory,
  State,
  logger,
} from "@elizaos/core";
import {
  TokenMetadataCandidate,
  TokenMetadataResolution,
} from "../services/coingecko.service";
import { validateCoingeckoService, getCoingeckoService } from "../utils/actionHelpers";

const MAX_ALTERNATIVE_CANDIDATES = 3;

function normalizeConfidence(confidence: number): number {
  if (!Number.isFinite(confidence)) {
    return 0;
  }
  if (confidence < 0) {
    return 0;
  }
  if (confidence > 1) {
    return 1;
  }
  return confidence;
}

function formatConfidencePercentage(confidence: number): string {
  const value = normalizeConfidence(confidence) * 100;
  return `${value.toFixed(1)}%`;
}

function extractAttribute(
  metadata: Record<string, unknown> | undefined,
  key: "name" | "symbol",
): string | undefined {
  if (!metadata) {
    return undefined;
  }
  const attributesRaw = (metadata as { attributes?: unknown }).attributes;
  if (attributesRaw && typeof attributesRaw === "object") {
    const value = (attributesRaw as Record<string, unknown>)[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return undefined;
}

function describeCandidate(candidate: TokenMetadataCandidate): string {
  const symbol = extractAttribute(candidate.metadata, "symbol");
  const name = extractAttribute(candidate.metadata, "name");

  if (symbol && name) {
    return `${symbol.toUpperCase()} (${name})`;
  }

  if (symbol) {
    return symbol.toUpperCase();
  }

  if (name) {
    return name;
  }

  return candidate.coinId;
}

function summarizeResolution(result: TokenMetadataResolution): string {
  if (!result.success) {
    const errorText = result.error ?? "Unable to resolve token";
    return `${result.id}: ${errorText}`;
  }

  const primaryCandidate =
    result.candidates.find((candidate) => candidate.metadata) ?? result.candidates[0];

  if (!primaryCandidate) {
    return `${result.id}: No matching tokens found`;
  }

  const summaryParts: string[] = [
    `${result.id} → ${describeCandidate(primaryCandidate)} [${formatConfidencePercentage(primaryCandidate.confidence)}]`,
  ];

  const alternativeCandidates = result.candidates
    .filter((candidate) => candidate !== primaryCandidate)
    .slice(0, MAX_ALTERNATIVE_CANDIDATES);

  if (alternativeCandidates.length > 0) {
    const alternativesText = alternativeCandidates
      .map((candidate) => `${describeCandidate(candidate)} (${formatConfidencePercentage(candidate.confidence)})`)
      .join(", ");
    summaryParts.push(`Alternatives: ${alternativesText}`);
  }

  return summaryParts.join(" | ");
}

export const getTokenMetadataAction: Action = {
  name: "GET_TOKEN_METADATA",
  similes: [
    "TOKEN_METADATA",
    "COINGECKO_TOKEN_METADATA",
    "GET_COIN_INFO",
    "TOKEN_INFO",
  ],
  description:
    "Use this action when the user asks about a specific token/coin or wants core token details or high-level market info. Examples: 'what is <token>?', symbol/name/contract lookups, decimals, logo, networks/addresses, current price, market cap, volume, ATH/ATL, and basic performance. Not for portfolio balances, swaps/trades, or protocol-level TVL. Accepts CoinGecko id, symbol, name, or a contract address (EVM 0x..., Solana Base58).",

  // Parameter schema for tool calling
  parameters: {
    tokens: {
      type: "string",
      description: "Comma-separated list of token identifiers (symbols, names, CoinGecko IDs, or contract addresses). Examples: 'bitcoin,ethereum' or 'BTC,ETH' or '0x2081...946ee'",
      required: true,
    },
  },

  validate: async (runtime: IAgentRuntime, message: Memory, state?: State): Promise<boolean> => {
    return validateCoingeckoService(runtime, "GET_TOKEN_METADATA", state, message);
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: any,
    callback?: HandlerCallback,
  ): Promise<ActionResult> => {
    try {
      const svc = getCoingeckoService(runtime);
      if (!svc) {
        throw new Error("CoinGeckoService not available");
      }

      // Read parameters from state (extracted by multiStepDecisionTemplate)
      const composedState = await runtime.composeState(message, ["ACTION_STATE"], true);
      const actionParams = composedState?.data?.actionParams as Record<string, string | undefined> | undefined;

      // Extract and validate tokens parameter (required)
      const tokensRaw = actionParams?.tokens ? actionParams.tokens.trim() : undefined;

      if (!tokensRaw) {
        const errorMsg = "Missing required parameter 'tokens'. Please specify which token(s) to fetch metadata for (e.g., 'bitcoin,ethereum' or 'BTC,ETH').";
        logger.error(`[GET_TOKEN_METADATA] ${errorMsg}`);
        const errorResult: ActionResult = {
          text: errorMsg,
          success: false,
          error: "missing_required_parameter",
        };
        if (callback) {
          await callback({
            text: errorResult.text,
            content: { error: "missing_required_parameter", details: errorMsg },
          });
        }
        return errorResult;
      }

      // Parse comma-separated tokens
      const ids = tokensRaw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      if (!ids.length) {
        const errorMsg = "No valid token identifiers found. Please provide token symbols, names, CoinGecko IDs, or contract addresses.";
        logger.error(`[GET_TOKEN_METADATA] ${errorMsg}`);
        const errorResult: ActionResult = {
          text: errorMsg,
          success: false,
          error: "invalid_parameter",
        };
        if (callback) {
          await callback({
            text: errorResult.text,
            content: { error: "invalid_parameter", details: errorMsg },
          });
        }
        return errorResult;
      }

      logger.info(`[GET_TOKEN_METADATA] Fetching metadata for: ${ids.join(", ")}`);

      // Store input parameters for return
      const inputParams = { tokens: tokensRaw, parsedIds: ids };

      // Fetch token metadata
      const serviceResults: TokenMetadataResolution[] = await svc.getTokenMetadata(ids);
      const successes = serviceResults.filter((result) => result.success);
      const failures = serviceResults.filter((result) => !result.success);
      const summaryLines = serviceResults.map((result) => summarizeResolution(result));

      const header = `Resolved ${successes.length}/${serviceResults.length} token queries.`;
      const text = [header, ...summaryLines].join("\n");

      if (callback) {
        await callback({
          text,
          actions: ["GET_TOKEN_METADATA"],
          content: {
            results: serviceResults,
            summary: summaryLines,
          },
          source: message.content.source,
        });
      }

      return {
        text,
        success: successes.length > 0,
        data: serviceResults,
        values: {
          results: serviceResults,
          summary: summaryLines,
          successCount: successes.length,
          failureCount: failures.length,
        },
        input: inputParams,
      } as ActionResult & { input: typeof inputParams };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`[GET_TOKEN_METADATA] Action failed: ${msg}`);
      
      // Try to capture input params even in failure
      const composedState = await runtime.composeState(message, ["ACTION_STATE"], true);
      const actionParams = composedState?.data?.actionParams as Record<string, string | undefined> | undefined;
      const failureInputParams = {
        tokens: actionParams?.tokens,
      };
      
      const errorResult: ActionResult = {
        text: `Failed to fetch token metadata: ${msg}`,
        success: false,
        error: msg,
        input: failureInputParams,
      } as ActionResult & { input: typeof failureInputParams };
      
      if (callback) {
        await callback({
          text: errorResult.text,
          content: { error: "action_failed", details: msg },
        });
      }
      return errorResult;
    }
  },

  examples: [
    [
      {
        name: "{{user}}",
        content: { text: "Get metadata for bitcoin and ethereum" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Fetched metadata for 2 token(s)",
          actions: ["GET_TOKEN_METADATA"],
        },
      },
    ],
  ],
};

