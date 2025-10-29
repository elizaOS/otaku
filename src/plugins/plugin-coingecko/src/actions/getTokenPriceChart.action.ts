import {
  Action,
  ActionResult,
  HandlerCallback,
  IAgentRuntime,
  Memory,
  State,
  logger,
} from "@elizaos/core";
import { CoinGeckoService, nativeTokenIds } from "../services/coingecko.service";

export const getTokenPriceChartAction: Action = {
  name: "GET_TOKEN_PRICE_CHART",
  similes: [
    "TOKEN_CHART",
    "PRICE_CHART",
    "TOKEN_PRICE_HISTORY",
    "PRICE_GRAPH",
    "TOKEN_PERFORMANCE",
  ],
  description:
    `Use this action when the user asks to see a price chart, graph, or price history for a token. When called successfully, this action automatically provides the token chart visualization in the chat with historical price data points, current price, and price change statistics.`,

  parameters: {
    token: {
      type: "string",
      description: `Token symbol or contract address. Native tokens that can be used by symbol: ${Object.keys(nativeTokenIds).join(', ').toUpperCase()}. For all other tokens, provide the contract address (e.g., '0x1bc0c42215582d5a085795f4badbac3ff36d1bcb'). Use GET_TOKEN_METADATA first to get the contract address for non-native tokens.`,
      required: true,
    },
    timeframe: {
      type: "string",
      description: "Time period for the chart. Options: '1h', '24h', '7d', '30d', '1y'. Defaults to '24h'.",
      required: false,
    },
    chain: {
      type: "string",
      description: "Blockchain network for the token (e.g., 'base', 'ethereum', 'polygon', 'arbitrum', 'optimism'). Use GET_TOKEN_METADATA first to determine the correct chain for a specific token.",
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

      // Read parameters from state
      const composedState = await runtime.composeState(message, ["ACTION_STATE"], true);
      const params = composedState?.data?.actionParams || {};

      // Extract and validate token parameter (required)
      const tokenRaw: string | undefined = params?.token?.trim();
      if (!tokenRaw) {
        const supportedNativeTokens = Object.keys(nativeTokenIds).join(', ').toUpperCase();
        const errorMsg = `Missing required parameter 'token'. Please specify which token to fetch price chart for. Native tokens (${supportedNativeTokens}) can be used by symbol. For all other tokens, provide the contract address. Use GET_TOKEN_METADATA first to get the contract address for non-native tokens.`;
        logger.error(`[GET_TOKEN_PRICE_CHART] ${errorMsg}`);
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

      // Extract and validate chain parameter (required)
      const chain: string | undefined = params?.chain?.trim()?.toLowerCase();
      if (!chain) {
        const errorMsg = "Missing required parameter 'chain'. Please specify the blockchain network (e.g., 'base', 'ethereum', 'polygon'). Use GET_TOKEN_METADATA first to determine the correct chain for a specific token.";
        logger.error(`[GET_TOKEN_PRICE_CHART] ${errorMsg}`);
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

      // Extract optional timeframe parameter
      const timeframe = (params?.timeframe?.trim() || '24h').toLowerCase();
      const validTimeframes = ['1h', '24h', '7d', '30d', '1y'];
      if (!validTimeframes.includes(timeframe)) {
        const errorMsg = `Invalid timeframe '${timeframe}'. Valid options: ${validTimeframes.join(', ')}`;
        logger.error(`[GET_TOKEN_PRICE_CHART] ${errorMsg}`);
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

      logger.info(`[GET_TOKEN_PRICE_CHART] Fetching price chart for ${tokenRaw}, timeframe: ${timeframe}, chain: ${chain}`);

      // Store input parameters for return
      const inputParams = { token: tokenRaw, timeframe, chain };

      // Fetch price chart data
      const chartData = await svc.getTokenPriceChart(tokenRaw, timeframe, chain);

      // Calculate price change
      let priceChange: { value: number; percentage: number } | null = null;
      if (chartData.data_points.length > 0) {
        const firstPrice = chartData.data_points[0].price;
        const lastPrice = chartData.data_points[chartData.data_points.length - 1].price;
        const change = lastPrice - firstPrice;
        const changePercent = (change / firstPrice) * 100;
        priceChange = { value: change, percentage: changePercent };
      }

      // Create a narrative summary for the agent to format
      const summary = `Price chart data for ${chartData.token_symbol || tokenRaw} over ${timeframe}:
- Current Price: $${chartData.current_price?.toFixed(6) || 'N/A'}
- Price Change: ${priceChange ? `${priceChange.value >= 0 ? '+' : ''}$${priceChange.value.toFixed(6)} (${priceChange.percentage >= 0 ? '+' : ''}${priceChange.percentage.toFixed(2)}%)` : 'N/A'}
- Data Points: ${chartData.data_points.length} price points
- Timeframe: ${chartData.timeframe}

Please analyze this price chart data and provide insights about the token's price movement, trends, and any notable patterns you observe.`;

      const text = summary;

      if (callback) {
        await callback({
          text,
          actions: ["GET_TOKEN_PRICE_CHART"],
          content: {
            ...chartData,
            price_change: priceChange,
          } as any,
          source: message.content.source,
        });
      }

      return {
        text,
        success: true,
        data: {
          ...chartData,
          price_change: priceChange,
        },
        values: {
          ...chartData,
          price_change: priceChange,
        },
        input: inputParams,
      } as ActionResult & { input: typeof inputParams };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`[GET_TOKEN_PRICE_CHART] Action failed: ${msg}`);
      
      // Try to capture input params even in failure
      const composedState = await runtime.composeState(message, ["ACTION_STATE"], true);
      const params = composedState?.data?.actionParams || {};
      const failureInputParams = {
        token: params?.token,
        timeframe: params?.timeframe || '24h',
        chain: params?.chain,
      };
      
      const errorText = `Failed to fetch token price chart: ${msg}

Please check the following:
1. **Token identifier**: Native tokens (${Object.keys(nativeTokenIds).join(', ').toUpperCase()}) can be used by symbol. For all other tokens, you MUST provide the contract address. Use GET_TOKEN_METADATA first to get the contract address for non-native tokens.
2. **Chain parameter** (REQUIRED): Provide the correct blockchain network:
   | Chain        | Parameter   |
   | ------------ | ----------- |
   | **base**     | base        |
   | **ethereum** | ethereum    |
   | **polygon**  | polygon     |
   | **arbitrum** | arbitrum    |
   | **optimism** | optimism    |
   
3. **Timeframe**: Optional - '1h', '24h', '7d', '30d', or '1y' (default: '24h')

💡 **Tip**: Use GET_TOKEN_METADATA action first to retrieve the correct chain and contract address for non-native tokens.

Example: "Show me the price chart for BTC on ethereum over the last 7 days"
Example: "Get the chart for 0x1bc0c42215582d5a085795f4badbac3ff36d1bcb on base for 30 days"`;
      
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
        content: { text: "Show me the price chart for Bitcoin" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Price chart data for BTC over 24h...",
          actions: ["GET_TOKEN_PRICE_CHART"],
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: { text: "Can I see ETH price history for the past week?" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Price chart data for ETH over 7d...",
          actions: ["GET_TOKEN_PRICE_CHART"],
        },
      },
    ],
  ],
};

