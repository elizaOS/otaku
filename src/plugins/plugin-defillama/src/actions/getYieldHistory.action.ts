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

export const getYieldHistoryAction: Action = {
  name: "GET_YIELD_HISTORY",
  similes: [
    "YIELD_HISTORY",
    "YIELD_CHART",
    "APY_TREND",
    "YIELD_TREND",
    "HISTORICAL_YIELD",
    "APY_HISTORY",
  ],
  description:
    "Use this action to fetch historical yield (APY) data and trends for a specific DeFi pool. Requires protocol, token, and optionally chain to identify the pool.",

  // Parameter schema for tool calling
  parameters: {
    protocol: {
      type: "string",
      description: "DeFi protocol name (e.g., 'Aave', 'Morpho', 'Compound')",
      required: true,
    },
    token: {
      type: "string",
      description: "Token symbol (e.g., 'USDC', 'ETH', 'DAI')",
      required: true,
    },
    chain: {
      type: "string",
      description: "Blockchain name (e.g., 'Ethereum', 'Base', 'Arbitrum'). Optional.",
      required: false,
    },
  },

  validate: async (runtime: IAgentRuntime, message: Memory, state?: State): Promise<boolean> => {
    return validateDefillamaService(runtime, "GET_YIELD_HISTORY", state, message);
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

      // Extract and validate required parameters
      const protocol = params?.protocol?.trim();
      const token = params?.token?.trim();
      const chain = params?.chain?.trim() || undefined;

      if (!protocol || !token) {
        const errorMsg = "Missing required parameters. Please specify both 'protocol' (e.g., 'Aave') and 'token' (e.g., 'USDC').";
        logger.error(`[GET_YIELD_HISTORY] ${errorMsg}`);
        const errorResult: ActionResult = {
          text: errorMsg,
          success: false,
          error: "missing_required_parameters",
        };
        if (callback) {
          await callback({
            text: errorResult.text,
            content: { error: "missing_required_parameters", details: errorMsg },
          });
        }
        return errorResult;
      }

      // Store input parameters for return
      const inputParams = { protocol, token, chain };

      // First, find the pool ID by searching for matching yields
      logger.info(`[GET_YIELD_HISTORY] Finding pool for: protocol=${protocol}, token=${token}${chain ? `, chain=${chain}` : ''}`);
      
      const pools = await svc.searchYields({
        protocol,
        token,
        chain,
        limit: 1, // We only need the first (best) match
      });

      if (!pools || pools.length === 0) {
        const errorMsg = `No pool found for ${protocol} ${token}${chain ? ` on ${chain}` : ''}`;
        logger.error(`[GET_YIELD_HISTORY] ${errorMsg}`);
        const errorResult: ActionResult = {
          text: errorMsg,
          success: false,
          error: "pool_not_found",
          input: inputParams,
        } as ActionResult & { input: typeof inputParams };
        if (callback) {
          await callback({
            text: errorResult.text,
            content: { error: "pool_not_found", details: errorMsg },
          });
        }
        return errorResult;
      }

      const pool = pools[0];
      const poolId = pool.pool;

      logger.info(`[GET_YIELD_HISTORY] Fetching historical data for pool: ${poolId}`);

      // Fetch historical yield data
      const chartData = await svc.getPoolChart(poolId);

      if (!chartData || chartData.length === 0) {
        const errorMsg = `No historical data available for ${protocol} ${token}${chain ? ` on ${chain}` : ''}`;
        logger.warn(`[GET_YIELD_HISTORY] ${errorMsg}`);
        const errorResult: ActionResult = {
          text: errorMsg,
          success: false,
          error: "no_historical_data",
          input: inputParams,
          data: { pool: { protocol: pool.project, token: pool.symbol, chain: pool.chain, poolId } },
        } as ActionResult & { input: typeof inputParams };
        if (callback) {
          await callback({
            text: errorResult.text,
            content: { error: "no_historical_data", details: errorMsg },
          });
        }
        return errorResult;
      }

      // Calculate some statistics from the historical data
      const apyValues = chartData.map(d => d.apy).filter(apy => apy !== null) as number[];
      const currentApy = apyValues[apyValues.length - 1] || 0;
      const avgApy = apyValues.length > 0 
        ? apyValues.reduce((sum, apy) => sum + apy, 0) / apyValues.length 
        : 0;
      const minApy = apyValues.length > 0 ? Math.min(...apyValues) : 0;
      const maxApy = apyValues.length > 0 ? Math.max(...apyValues) : 0;

      // Get recent data (last 30 days if available)
      const recentData = chartData.slice(-30);

      const messageText = `Retrieved ${chartData.length} days of yield history for ${pool.project} ${pool.symbol}${pool.chain ? ` on ${pool.chain}` : ''}`;

      const result = {
        pool: {
          protocol: pool.project,
          token: pool.symbol,
          chain: pool.chain,
          poolId,
          currentApy: pool.apy,
          currentTvl: pool.tvlUsd,
        },
        statistics: {
          dataPoints: chartData.length,
          currentApy,
          avgApy,
          minApy,
          maxApy,
        },
        recentHistory: recentData,
        fullHistory: chartData,
      };

      if (callback) {
        await callback({
          text: messageText,
          actions: ["GET_YIELD_HISTORY"],
          content: result,
          source: message.content.source,
        });
      }

      return {
        text: messageText,
        success: true,
        data: result,
        input: inputParams,
      } as ActionResult & { input: typeof inputParams };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`[GET_YIELD_HISTORY] Action failed: ${msg}`);
      
      // Try to capture input params even in failure
      const params = await extractActionParams<{ protocol?: string; token?: string; chain?: string }>(runtime, message);
      const failureInputParams = {
        protocol: params?.protocol,
        token: params?.token,
        chain: params?.chain,
      };
      
      const errorResult: ActionResult = {
        text: `Failed to fetch yield history: ${msg}`,
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
        content: { text: "Show me the yield history for Aave USDC" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Retrieved 998 days of yield history for aave-v3 USDC on Ethereum",
          actions: ["GET_YIELD_HISTORY"],
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: { text: "How has the APY changed for Morpho ETH?" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Retrieved 365 days of yield history for morpho-v1 ETH on Ethereum",
          actions: ["GET_YIELD_HISTORY"],
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: { text: "What's the yield trend for Compound USDC on Ethereum?" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Retrieved 750 days of yield history for compound-v3 USDC on Ethereum",
          actions: ["GET_YIELD_HISTORY"],
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: { text: "Show me historical APY for Aave DAI" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Retrieved 990 days of yield history for aave-v3 DAI on Ethereum",
          actions: ["GET_YIELD_HISTORY"],
        },
      },
    ],
  ],
};

