import {
  Action,
  IAgentRuntime,
  Memory,
  logger,
  State,
  HandlerCallback,
  ActionResult,
} from "@elizaos/core";
import { MorphoService } from "../services";
import { CdpService } from "../../../plugin-cdp/services/cdp.service";
import { MorphoMarketData } from "../types";
import { getEntityWallet } from "../../../../utils/entity";
import { validateMorphoService, extractActionParams } from "../utils/actionHelpers";

interface MarketInfoParams {
  market?: string;
  chain?: string;
}

type MarketInfoInput = {
  market?: string;
  chain?: string;
};

type MarketInfoActionResult = ActionResult & { input: MarketInfoInput };

/* =========================
 * Action: GET_MORPHO_MARKET_INFO
 * ========================= */
export const marketInfoAction: Action = {
  name: "GET_MORPHO_MARKET_INFO",
  similes: [
    "MARKET_INFO",
    "MARKET_DATA",
    "RATES",
    "MORPHO_RATES",
    "CHECK_RATES",
  ],
  description:
    "Use this action when you need current Morpho market data, rates, and stats (no positions).",

  parameters: {
    market: {
      type: "string",
      description:
        "Morpho market identifier - can be a token pair (e.g., 'wstETH/WETH') or a market ID (0x... hex string). If not provided, returns all available markets.",
      required: false,
    },
    chain: {
      type: "string",
      description:
        "Blockchain network to check (e.g., 'base', 'ethereum'). If not provided, uses the default chain configured for the Morpho service.",
      required: false,
    },
  },

  validate: async (runtime: IAgentRuntime, message: Memory, state?: State) => {
    return validateMorphoService(runtime, "GET_MORPHO_MARKET_INFO", state, message);
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    options?: any,
    callback?: HandlerCallback,
  ): Promise<ActionResult> => {
    logger.info("[GET_MORPHO_MARKET_INFO] Starting Morpho market info action");

    try {
      // Read parameters from state
      const composedState = await runtime.composeState(message, ["ACTION_STATE"], true);
      const params = (composedState?.data?.actionParams ?? {}) as Partial<MarketInfoParams>;

      // Store input parameters for return
      const inputParams: MarketInfoInput = {
        market: params.market?.trim(),
        chain: params.chain?.trim()?.toLowerCase(),
      };

      logger.info(
        `[GET_MORPHO_MARKET_INFO] Params: market=${inputParams.market || "all"}, chain=${inputParams.chain || "default"}`,
      );

      const service = runtime.getService(
        MorphoService.serviceType,
      ) as MorphoService;

      // Determine chain - default to 'base' if not provided
      const chain = (inputParams.chain as any) || 'base';

      // Get CDP service
      const cdp = runtime.getService(CdpService.serviceType) as CdpService;
      if (!cdp || typeof cdp.getViemClientsForAccount !== "function") {
        const errorMsg = "CDP service not available";
        logger.error(`[GET_MORPHO_MARKET_INFO] ${errorMsg}`);
        const errorResult: MarketInfoActionResult = {
          text: ` ${errorMsg}`,
          success: false,
          error: "service_unavailable",
          data: { actionName: "GET_MORPHO_MARKET_INFO", error: errorMsg },
          input: inputParams,
          values: {
            error: true,
            marketsFetched: false,
          },
        };
        if (callback) {
          await callback({
            text: errorResult.text,
            content: { error: "service_unavailable", details: errorMsg },
          });
        }
        return errorResult;
      }

      // Get entity wallet
      const wallet = await getEntityWallet(
        runtime,
        message,
        "GET_MORPHO_MARKET_INFO",
        callback,
      );

      if (wallet.success === false) {
        logger.warn("[GET_MORPHO_MARKET_INFO] Entity wallet verification failed");
        return {
          ...wallet.result,
          input: inputParams,
        } as ActionResult & { input: typeof inputParams };
      }

      const accountName = wallet.metadata?.accountName as string | undefined;

      if (!accountName) {
        const errorMsg = "Could not resolve user wallet";
        logger.error(`[GET_MORPHO_MARKET_INFO] ${errorMsg}`);
        const errorResult: MarketInfoActionResult = {
          text: ` ${errorMsg}`,
          success: false,
          error: "missing_account_name",
          data: { actionName: "GET_MORPHO_MARKET_INFO", error: errorMsg },
          input: inputParams,
          values: {
            error: true,
            marketsFetched: false,
          },
        };
        if (callback) {
          await callback({
            text: errorResult.text,
            content: { error: "missing_account_name", details: errorMsg },
          });
        }
        return errorResult;
      }

      // Get viem clients for the account on the specified chain
      const viemClient = await cdp.getViemClientsForAccount({
        accountName,
        network: chain,
      });
      const publicClient = viemClient.publicClient;

      const markets = await service.getMarketData(inputParams.market, chain, publicClient);

      if (!markets.length) {
        const errorText = ` No market data${inputParams.market ? ` for ${inputParams.market}` : ""} found.`;
        const data = {
          actionName: "GET_MORPHO_MARKET_INFO",
          params: inputParams,
          markets: [],
        };
        const errorResult: MarketInfoActionResult = {
          text: errorText,
          success: false,
          data,
          input: inputParams,
          values: {
            marketsFetched: false,
            marketsCount: 0,
            requestedMarket: inputParams.market ?? null,
          },
        };
        if (callback) {
          await callback({
            text: errorText,
            actions: ["GET_MORPHO_MARKET_INFO"],
            source: message.content.source,
            data,
          });
        }
        return errorResult;
      }

      // Success message
      const text = inputParams.market
        ? ` Successfully fetched market data for ${inputParams.market} on ${chain}.`
        : ` Successfully fetched all Morpho markets on ${chain}. Found ${markets.length} market${markets.length === 1 ? '' : 's'}.`;

      const data = { actionName: "GET_MORPHO_MARKET_INFO", params: inputParams, markets };

      if (callback) {
        await callback({
          text,
          actions: ["GET_MORPHO_MARKET_INFO"],
          source: message.content.source,
          data,
        });
      }

      const successResult: MarketInfoActionResult = {
        text,
        success: true,
        data,
        input: inputParams,
        values: {
          marketsFetched: true,
          marketsCount: markets.length,
          requestedMarket: inputParams.market ?? null,
        },
      };

      return successResult;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`[GET_MORPHO_MARKET_INFO] Action failed: ${msg}`);

      // Try to capture input params even in failure
      let failureInputParams: MarketInfoInput = {};
      try {
        const composedState = await runtime.composeState(message, ["ACTION_STATE"], true);
        const params = (composedState?.data?.actionParams ?? {}) as Partial<MarketInfoParams>;
        failureInputParams = {
          market: params.market?.trim(),
          chain: params.chain?.trim()?.toLowerCase(),
        };
      } catch (e) {
        // If we can't get params, just use empty object
      }

      const text = ` Failed to get market info: ${msg}`;
      const data = { actionName: "GET_MORPHO_MARKET_INFO", error: msg };

      const errorResult: MarketInfoActionResult = {
        text,
        success: false,
        error: msg,
        data,
        input: failureInputParams,
        values: {
          error: true,
          marketsFetched: false,
        },
      };

      if (callback) {
        await callback({
          text,
          actions: ["GET_MORPHO_MARKET_INFO"],
          source: message.content.source,
          data,
        });
      }

      return errorResult;
    }
  },
  examples: [
    [
      {
        name: "{{name1}}",
        content: {
          text: "What are the current rates for wstETH / WETH on Morpho?",
        },
      },
      {
        name: "{{name2}}",
        content: {
          text: "Here are the current wstETH / WETH market rates on Morpho...",
          action: "GET_MORPHO_MARKET_INFO",
        },
      },
    ],
    [
      {
        name: "{{name1}}",
        content: { text: "Show me all market data" },
      },
      {
        name: "{{name2}}",
        content: {
          text: "Here is the complete market overview...",
          action: "GET_MORPHO_MARKET_INFO",
        },
      },
    ],
    [
      {
        name: "{{name1}}",
        content: {
          text: "Check this market: 0x3a4048c64ba1b375330d376b1ce40e4047d03b47ab4d48af484edec9fec801ba",
        },
      },
      {
        name: "{{name2}}",
        content: {
          text: "Here’s the current data for the requested market...",
          action: "GET_MORPHO_MARKET_INFO",
        },
      },
    ],
  ],
};
