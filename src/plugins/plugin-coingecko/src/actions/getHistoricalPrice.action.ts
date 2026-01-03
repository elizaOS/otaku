import {
  Action,
  ActionResult,
  HandlerCallback,
  IAgentRuntime,
  Memory,
  State,
  logger,
} from "@elizaos/core";
import { nativeTokenIds } from "../services/coingecko.service";
import { validateCoingeckoService, getCoingeckoService, formatMarketCap, parseDateToApiFormat } from "../utils/actionHelpers";

export const getHistoricalPriceAction: Action = {
  name: "GET_HISTORICAL_PRICE",
  similes: [
    "HISTORICAL_PRICE",
    "PRICE_ON_DATE",
    "PAST_PRICE",
    "TOKEN_PRICE_HISTORY",
    "PRICE_AT_DATE",
  ],
  description:
    `Use this action when the user asks for a token's price on a specific date in the past. This action retrieves historical price data for any token (native or contract address) at a particular point in time. Returns the price, market cap, and trading volume for that date.`,

  parameters: {
    token: {
      type: "string",
      description: `Token symbol or contract address. Native tokens that can be used by symbol: ${Object.keys(nativeTokenIds).join(', ').toUpperCase()}. For all other tokens, provide the contract address (e.g., '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'). Use GET_TOKEN_METADATA first to get the contract address for non-native tokens.`,
      required: true,
    },
    date: {
      type: "string",
      description: "Date for historical price. Accepts formats: 'dd-mm-yyyy' (e.g., '01-01-2024'), '2024-01-01', 'today', 'yesterday', '7 days ago', '2 weeks ago', '3 months ago', '1 year ago'.",
      required: true,
    },
    chain: {
      type: "string",
      description: "Blockchain network for the token (e.g., 'base', 'ethereum', 'polygon', 'arbitrum', 'optimism'). Required for contract addresses, optional for native tokens. Use GET_TOKEN_METADATA first to determine the correct chain.",
      required: false,
    },
  },

  validate: async (runtime: IAgentRuntime, message: Memory, state?: State): Promise<boolean> => {
    return validateCoingeckoService(runtime, "GET_HISTORICAL_PRICE", state, message);
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback,
  ): Promise<ActionResult> => {
    try {
      const svc = getCoingeckoService(runtime);
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
        const errorMsg = `Missing required parameter 'token'. Please specify which token to fetch historical price for. Native tokens (${supportedNativeTokens}) can be used by symbol. For all other tokens, provide the contract address.`;
        logger.error(`[GET_HISTORICAL_PRICE] ${errorMsg}`);
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

      // Extract and validate date parameter (required)
      const dateRaw: string | undefined = params?.date?.trim();
      if (!dateRaw) {
        const errorMsg = "Missing required parameter 'date'. Please specify the date for historical price (e.g., '01-01-2024', 'yesterday', '7 days ago').";
        logger.error(`[GET_HISTORICAL_PRICE] ${errorMsg}`);
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

      // Parse date to API format (dd-mm-yyyy)
      let apiDate: string;
      try {
        apiDate = parseDateToApiFormat(dateRaw);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const errorMsg = `Invalid date format: ${msg}. Please use formats like 'dd-mm-yyyy', '2024-01-01', 'yesterday', '7 days ago', etc.`;
        logger.error(`[GET_HISTORICAL_PRICE] ${errorMsg}`);
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

      // Extract optional chain parameter (default to base for contract addresses)
      const chain: string = params?.chain?.trim()?.toLowerCase() || 'base';

      logger.info(`[GET_HISTORICAL_PRICE] Fetching historical price for ${tokenRaw} on ${apiDate} (chain: ${chain})`);

      // Store input parameters for return
      const inputParams = { token: tokenRaw, date: dateRaw, chain };

      // Fetch historical price data
      const historicalData = await svc.getHistoricalPrice(tokenRaw, apiDate, chain);

      // Format the response
      const tokenDisplay = historicalData.token_name 
        ? `${historicalData.token_name} (${historicalData.token_symbol || tokenRaw})`
        : (historicalData.token_symbol || tokenRaw);

      // Create a narrative summary for the agent to format
      const summary = `Historical price data for ${tokenDisplay} on ${apiDate}:
- Token: ${tokenDisplay}
- Date: ${apiDate}
- Price: ${historicalData.price_usd ? `$${historicalData.price_usd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}` : 'N/A'}
- Market Cap: ${historicalData.market_cap_usd ? `$${formatMarketCap(historicalData.market_cap_usd)}` : 'N/A'}
- 24h Volume: ${historicalData.total_volume_usd ? `$${formatMarketCap(historicalData.total_volume_usd)}` : 'N/A'}
- Chain: ${historicalData.chain}
- CoinGecko ID: ${historicalData.coin_id}

This historical price data shows the token's value on the specified date. You can use this to analyze price movements over time or compare with current prices.`;

      const text = summary;

      if (callback) {
        await callback({
          text,
          actions: ["GET_HISTORICAL_PRICE"],
          content: {
            ...historicalData,
          } as Record<string, unknown>,
          source: message.content.source,
        });
      }

      return {
        text,
        success: true,
        data: historicalData,
        values: historicalData,
        input: inputParams,
      } as ActionResult & { input: typeof inputParams };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`[GET_HISTORICAL_PRICE] Action failed: ${msg}`);
      
      // Try to capture input params even in failure
      const composedState = await runtime.composeState(message, ["ACTION_STATE"], true);
      const params = composedState?.data?.actionParams || {};
      const failureInputParams = {
        token: params?.token,
        date: params?.date,
        chain: params?.chain || 'base',
      };
      
      const errorText = `Failed to fetch historical price: ${msg}

Please check the following:
1. **Token identifier**: Native tokens (${Object.keys(nativeTokenIds).join(', ').toUpperCase()}) can be used by symbol. For all other tokens, you MUST provide the contract address.
2. **Date format**: Use formats like 'dd-mm-yyyy', '2024-01-01', 'yesterday', '7 days ago', '2 weeks ago', '3 months ago', or '1 year ago'.
3. **Chain parameter**: Provide the correct blockchain network for contract addresses:
   | Chain        | Parameter   |
   | ------------ | ----------- |
   | **base**     | base        |
   | **ethereum** | ethereum    |
   | **polygon**  | polygon     |
   | **arbitrum** | arbitrum    |
   | **optimism** | optimism    |
   
4. **Historical data availability**: CoinGecko may not have historical data for very new tokens or dates before the token was listed.

**Tip**: Use GET_TOKEN_METADATA action first to retrieve the correct chain and contract address for non-native tokens.

Example: "What was the price of BTC on January 1st, 2024?"
Example: "Get historical price for ETH 6 months ago"
Example: "Show me the price of 0x833589fcd6edb6e08f4c7c32d4f71b54bda02913 on base on 01-09-2024"`;
      
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
        content: { text: "What was the price of Bitcoin on January 1st, 2024?" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Historical price data for Bitcoin (BTC) on 01-01-2024...",
          actions: ["GET_HISTORICAL_PRICE"],
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: { text: "Show me ETH price from 6 months ago" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Historical price data for Ethereum (ETH) on [date]...",
          actions: ["GET_HISTORICAL_PRICE"],
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: { text: "What was MATIC worth on 15-06-2024?" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Historical price data for Polygon (MATIC) on 15-06-2024...",
          actions: ["GET_HISTORICAL_PRICE"],
        },
      },
    ],
  ],
};

