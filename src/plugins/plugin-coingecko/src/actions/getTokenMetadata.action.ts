import {
  Action,
  ActionResult,
  HandlerCallback,
  IAgentRuntime,
  Memory,
  State,
  logger,
} from "@elizaos/core";
import { CoinGeckoService } from "../services/coingecko.service";

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

  validate: async (runtime: IAgentRuntime): Promise<boolean> => {
    const svc = runtime.getService(CoinGeckoService.serviceType) as CoinGeckoService | undefined;
    if (!svc) {
      logger.error("CoinGeckoService not available");
      return false;
    }
    return true;
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: any,
    callback?: HandlerCallback,
  ): Promise<ActionResult> => {
    try {
      const svc = runtime.getService(CoinGeckoService.serviceType) as CoinGeckoService | undefined;
      if (!svc) {
        throw new Error("CoinGeckoService not available");
      }

      // Read parameters from state (extracted by multiStepDecisionTemplate)
      const composedState = await runtime.composeState(message, ["ACTION_STATE"], true);
      const params = composedState?.data?.actionParams || {};

      // Extract and validate tokens parameter (required)
      const tokensRaw: string | undefined = params?.tokens?.trim();

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
      const serviceResults = await svc.getTokenMetadata(ids);
      const successes = serviceResults.filter((r) => r.success);
      const failures = serviceResults.filter((r) => !r.success);

      const text = `Fetched metadata for ${successes.length} token(s)` + (failures.length ? `, ${failures.length} failed` : "");

      if (callback) {
        await callback({
          text,
          actions: ["GET_TOKEN_METADATA"],
          content: serviceResults as any,
          source: message.content.source,
        });
      }

      return {
        text,
        success: successes.length > 0,
        data: serviceResults,
        values: serviceResults,
        input: inputParams,
      } as ActionResult & { input: typeof inputParams };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`[GET_TOKEN_METADATA] Action failed: ${msg}`);
      
      // Try to capture input params even in failure
      const composedState = await runtime.composeState(message, ["ACTION_STATE"], true);
      const params = composedState?.data?.actionParams || {};
      const failureInputParams = {
        tokens: params?.tokens,
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

