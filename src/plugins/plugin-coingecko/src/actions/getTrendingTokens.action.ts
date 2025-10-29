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

export const getTrendingTokensAction: Action = {
  name: "GET_TRENDING_TOKENS",
  similes: [
    "TRENDING_TOKENS",
    "HOT_TOKENS",
    "TRENDING_POOLS",
    "TOP_TOKENS",
    "POPULAR_TOKENS",
  ],
  description:
    "Use this action when the user asks about trending or popular tokens on a specific blockchain network. Returns trending pools with token metadata including price, volume, market cap, and price changes. Supports networks like 'base', 'ethereum', 'arbitrum', 'optimism', 'polygon', 'bsc', 'solana', and more.",

  // Parameter schema for tool calling
  parameters: {
    network: {
      type: "string",
      description: "The blockchain network to fetch trending tokens for (e.g., 'base', 'ethereum', 'arbitrum', 'optimism', 'polygon', 'bsc', 'solana'). Defaults to 'base'.",
      required: true,
    },
    limit: {
      type: "number",
      description: "Number of trending tokens to return (1-30). Defaults to 10.",
      required: false,
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

      // Extract parameters with defaults
      const network: string = (params?.network?.trim() || "base").toLowerCase();
      const limitRaw = params?.limit;
      const limit = typeof limitRaw === "number" 
        ? Math.max(1, Math.min(30, Math.floor(limitRaw)))
        : typeof limitRaw === "string" 
          ? Math.max(1, Math.min(30, Math.floor(Number(limitRaw) || 10)))
          : 10;

      logger.info(`[GET_TRENDING_TOKENS] Fetching trending tokens for network: ${network}, limit: ${limit}`);

      // Store input parameters for return
      const inputParams = { network, limit };

      // Fetch trending tokens
      const trendingData = await svc.getTrendingTokens(network, limit);

      const text = `Found ${trendingData?.length || 0} trending token(s) on ${network}`;

      if (callback) {
        await callback({
          text,
          actions: ["GET_TRENDING_TOKENS"],
          content: trendingData as any,
          source: message.content.source,
        });
      }

      return {
        text,
        success: true,
        data: trendingData,
        values: trendingData,
        input: inputParams,
      } as ActionResult & { input: typeof inputParams };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`[GET_TRENDING_TOKENS] Action failed: ${msg}`);
      
      // Try to capture input params even in failure
      const composedState = await runtime.composeState(message, ["ACTION_STATE"], true);
      const params = composedState?.data?.actionParams || {};
      const failureInputParams = {
        network: params?.network || "base",
        limit: params?.limit || 10,
      };
      
      // Provide helpful error message with correct chain parameters
      const errorText = `Failed to fetch trending tokens: ${msg}

Please provide the correct chain parameter:
| Chain        | GeckoTerminal Parameter |
| ------------ | ----------------------- |
| **base**     | base                    |
| **ethereum** | eth                     |
| **polygon**  | polygon_pos             |
| **arbitrum** | arbitrum                |
| **optimism** | optimism                |
| **scroll**   | scroll                  |

Example: "Get trending tokens on eth" or "Show me trending tokens on polygon_pos"`;
      
      const errorResult: ActionResult = {
        text: errorText,
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
        content: { text: "What are the trending tokens on Base?" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Found 10 trending token(s) on base",
          actions: ["GET_TRENDING_TOKENS"],
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: { text: "Show me the top 5 trending tokens on ethereum" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Found 5 trending token(s) on ethereum",
          actions: ["GET_TRENDING_TOKENS"],
        },
      },
    ],
  ],
};

