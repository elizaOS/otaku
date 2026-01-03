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
import { DefiLlamaService } from "../services/defillama.service";
import { validateDefillamaService, getDefillamaService, extractActionParams } from "../utils/actionHelpers";

export const getYieldRatesAction: Action = {
  name: "GET_YIELD_RATES",
  similes: [
    "YIELD_RATES",
    "CHECK_APY",
    "FIND_YIELD",
    "COMPARE_YIELDS",
    "GET_APY",
    "LENDING_RATES",
  ],
  description:
    "Use this action to fetch DeFi yield rates (APY) for protocols, tokens, and chains. Can compare yields across different protocols.",

  // Parameter schema for tool calling
  parameters: {
    protocol: {
      type: "string",
      description: "DeFi protocol name (e.g., 'Aave', 'Morpho', 'Compound'). Optional.",
      required: false,
    },
    token: {
      type: "string",
      description: "Token symbol (e.g., 'USDC', 'ETH', 'DAI'). Optional.",
      required: false,
    },
    chain: {
      type: "string",
      description: "Blockchain name (e.g., 'Ethereum', 'Base', 'Arbitrum'). Optional.",
      required: false,
    },
  },

  validate: async (runtime: IAgentRuntime, message: Memory, state?: State): Promise<boolean> => {
    return validateDefillamaService(runtime, "GET_YIELD_RATES", state, message);
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: HandlerOptions,
    callback?: HandlerCallback,
  ): Promise<ActionResult> => {
    try {
      const svc = getDefillamaService(runtime);
      if (!svc) {
        throw new Error("DefiLlamaService not available");
      }

      // Read parameters from state (extracted by multiStepDecisionTemplate)
      const params = await extractActionParams<{ protocol?: string; token?: string; chain?: string }>(runtime, message);

      // Extract optional parameters
      const protocol = params?.protocol?.trim() || undefined;
      const token = params?.token?.trim() || undefined;
      const chain = params?.chain?.trim() || undefined;

      // Log what we're searching for
      const searchCriteria = [];
      if (protocol) searchCriteria.push(`protocol: ${protocol}`);
      if (token) searchCriteria.push(`token: ${token}`);
      if (chain) searchCriteria.push(`chain: ${chain}`);
      
      const searchDesc = searchCriteria.length > 0 
        ? searchCriteria.join(", ") 
        : "all yields";
      
      logger.info(`[GET_YIELD_RATES] Searching for yields: ${searchDesc}`);

      // Store input parameters for return
      const inputParams = { protocol, token, chain };

      // Search for yields
      const results = await svc.searchYields({
        protocol,
        token,
        chain,
        limit: 10, // Top 10 results
      });

      if (!Array.isArray(results) || results.length === 0) {
        const errorMsg = `No yield opportunities found for ${searchDesc}`;
        logger.info(`[GET_YIELD_RATES] ${errorMsg}`);
        const errorResult: ActionResult = {
          text: errorMsg,
          success: true, // Not really an error, just no results
          data: [],
          input: inputParams,
        } as ActionResult & { input: typeof inputParams };
        if (callback) {
          await callback({
            text: errorResult.text,
            content: { results: [], searchCriteria: inputParams },
          });
        }
        return errorResult;
      }

      // Format results for better readability
      const formattedResults = results.map((pool) => ({
        protocol: pool.project,
        chain: pool.chain,
        token: pool.symbol,
        apy: pool.apy,
        apyBase: pool.apyBase,
        apyReward: pool.apyReward,
        tvlUsd: pool.tvlUsd,
        stablecoin: pool.stablecoin,
        poolId: pool.pool,
        // Include trend data if available
        apyChange1d: pool.apyPct1D,
        apyChange7d: pool.apyPct7D,
        apyChange30d: pool.apyPct30D,
        apyMean30d: pool.apyMean30d,
      }));

      const messageText = `Found ${results.length} yield opportunit${results.length === 1 ? 'y' : 'ies'} for ${searchDesc}`;

      if (callback) {
        await callback({
          text: messageText,
          actions: ["GET_YIELD_RATES"],
          content: formattedResults,
          source: message.content.source,
        });
      }

      return {
        text: messageText,
        success: true,
        data: formattedResults,
        values: formattedResults, // For compatibility
        input: inputParams,
      } as ActionResult & { input: typeof inputParams };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`[GET_YIELD_RATES] Action failed: ${msg}`);
      
      // Try to capture input params even in failure
      const params = await extractActionParams<{ protocol?: string; token?: string; chain?: string }>(runtime, message);
      const failureInputParams = {
        protocol: params?.protocol,
        token: params?.token,
        chain: params?.chain,
      };
      
      const errorResult: ActionResult = {
        text: `Failed to fetch yield rates: ${msg}`,
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
        content: { text: "What's the current APY on Aave for USDC?" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Found 3 yield opportunities for protocol: Aave, token: USDC",
          actions: ["GET_YIELD_RATES"],
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: { text: "Compare USDC yields on Aave and Morpho" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Found 8 yield opportunities for token: USDC",
          actions: ["GET_YIELD_RATES"],
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: { text: "Show me the best ETH yields on Ethereum" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Found 10 yield opportunities for token: ETH, chain: Ethereum",
          actions: ["GET_YIELD_RATES"],
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: { text: "What can I earn on stablecoins in Aave?" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Found 5 yield opportunities for protocol: Aave",
          actions: ["GET_YIELD_RATES"],
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: { text: "Find the best yields on Base" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Found 10 yield opportunities for chain: Base",
          actions: ["GET_YIELD_RATES"],
        },
      },
    ],
  ],
};

