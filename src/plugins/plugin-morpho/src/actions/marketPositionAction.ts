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
import { MorphoMarketData, UserPosition } from "../types";
import { getEntityWallet } from "../../../../utils/entity";
import { CdpService } from "../../../plugin-cdp/services/cdp.service";
import { validateMorphoService, extractActionParams } from "../utils/actionHelpers";
import BigNumber from "bignumber.js";

interface MarketPositionsParams {
  market?: string;
  chain?: string;
}

type MarketPositionsInput = {
  market?: string;
  chain?: string;
};

type MarketPositionsActionResult = ActionResult & { input: MarketPositionsInput };

// Helper function to format market position data
function formatMarketPositionData(positions: UserPosition[]) {
  return positions.map((pos) => {
    return {
      marketId: pos.marketId,
      pairLabel: pos.pairLabel,
      hasPosition: pos.hasPosition,
      amounts: {
        // Keep both raw and formatted values
        loanTokens: pos.amounts.loanTokens,
        loanUsd: pos.amounts.loanUsd,
        collateralTokens: pos.amounts.collateralTokens,
        collateralUsd: pos.amounts.collateralUsd,
        suppliedTokens: pos.amounts.suppliedTokens,
        suppliedUsd: pos.amounts.suppliedUsd,
        withdrawableTokens: pos.amounts.withdrawableTokens,
      },
      symbols: {
        loan: pos.symbols.loan,
        collateral: pos.symbols.collateral,
      },
      risk: {
        ltvPct: pos.risk.ltvPct,
        lltvPct: pos.risk.lltvPct,
        dropToLiquidationPct: pos.risk.dropToLiquidationPct,
      },
      prices: {
        currentLoanPerCollateral: pos.prices.currentLoanPerCollateral,
        liquidationLoanPerCollateral: pos.prices.liquidationLoanPerCollateral,
      },
      supply: pos.supply ? {
        hasSupplied: pos.supply.hasSupplied,
        currentApy: pos.supply.currentApy,
        earnedInterest: pos.supply.earnedInterest,
      } : undefined,
    };
  });
}

/* =========================
 * Action: GET_MORPHO_MARKET_POSITIONS
 * ========================= */
export const marketPositionsAction: Action = {
  name: "GET_MORPHO_MARKET_POSITIONS",
  similes: [
    "MARKET_POSITIONS",
    "MY_MARKET_POSITIONS",
    "LOAN_POSITIONS",
    "BORROW_SUPPLY_POSITIONS",
    "MORPHO_MARKETS",
    "MORPHO_MARKET_POSITIONS",
  ],
  description:
    "Use this action when you need your Morpho market positions (supplies and borrows).",

  parameters: {
    market: {
      type: "string",
      description:
        "Morpho market identifier - can be a token pair (e.g., 'wstETH/WETH') or a market ID (0x... hex string). If not provided, returns all positions.",
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
    return validateMorphoService(runtime, "GET_MORPHO_MARKET_POSITIONS", state, message);
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    options?: any,
    callback?: HandlerCallback,
  ): Promise<ActionResult> => {
    logger.info("[GET_MORPHO_MARKET_POSITIONS] Starting Morpho positions action");

    try {
      // Read parameters from state
      const composedState = await runtime.composeState(message, ["ACTION_STATE"], true);
      const params = (composedState?.data?.actionParams ?? {}) as Partial<MarketPositionsParams>;

      // Store input parameters for return
      const inputParams: MarketPositionsInput = {
        market: params.market?.trim(),
        chain: params.chain?.trim()?.toLowerCase(),
      };

      logger.info(
        `[GET_MORPHO_MARKET_POSITIONS] Params: market=${inputParams.market || "all"}, chain=${inputParams.chain || "default"}`,
      );

      // Determine chain - default to 'base' if not provided
      const chain = (inputParams.chain as any) || 'base';

      // Get CDP service
      const cdp = runtime.getService(CdpService.serviceType) as CdpService;
      if (!cdp || typeof cdp.getViemClientsForAccount !== "function") {
        const errorMsg = "CDP service not available";
        logger.error(`[GET_MORPHO_MARKET_POSITIONS] ${errorMsg}`);
        const errorResult: MarketPositionsActionResult = {
          text: ` ${errorMsg}`,
          success: false,
          error: "service_unavailable",
          data: { actionName: "GET_MORPHO_MARKET_POSITIONS", error: errorMsg },
          input: inputParams,
          values: {
            error: true,
            positionsFetched: false,
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
        "GET_MORPHO_MARKET_POSITIONS",
        callback,
      );

      if (wallet.success === false) {
        logger.warn("[GET_MORPHO_MARKET_POSITIONS] Entity wallet verification failed");
        return {
          ...wallet.result,
          input: inputParams,
        } as ActionResult & { input: typeof inputParams };
      }

      const accountName = wallet.metadata?.accountName as string | undefined;

      if (!accountName) {
        const errorMsg = "Could not resolve user wallet";
        logger.error(`[GET_MORPHO_MARKET_POSITIONS] ${errorMsg}`);
        const errorResult: MarketPositionsActionResult = {
          text: ` ${errorMsg}`,
          success: false,
          error: "missing_account_name",
          data: { actionName: "GET_MORPHO_MARKET_POSITIONS", error: errorMsg },
          input: inputParams,
          values: {
            error: true,
            positionsFetched: false,
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
      const walletAddress = viemClient.address;

      const service = runtime.getService(
        MorphoService.serviceType,
      ) as MorphoService;

      // Fetch positions
      let positions: UserPosition[] = [];
      try {
        positions = await service.getUserPositionsByAddress(
          walletAddress,
          inputParams.market,
          chain,
          publicClient
        );
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        logger.error(`[GET_MORPHO_MARKET_POSITIONS] Could not fetch position data: ${errMsg}`);
        const errorResult: MarketPositionsActionResult = {
          text: ` Failed to fetch position data: ${errMsg}`,
          success: false,
          error: errMsg,
          data: { actionName: "GET_MORPHO_MARKET_POSITIONS", error: errMsg },
          input: inputParams,
          values: {
            error: true,
            positionsFetched: false,
          },
        };
        if (callback) {
          await callback({
            text: errorResult.text,
            content: { error: "fetch_positions_failed", details: errMsg },
          });
        }
        return errorResult;
      }

      // Success message
      const hasPositions = positions.some(p => p?.hasPosition);
      let text: string;
      
      if (inputParams.market) {
        const position = positions[0];
        text = position?.hasPosition
          ? ` Successfully fetched your position for ${inputParams.market} on ${chain}.`
          : ` You don't have an open position for ${inputParams.market} on ${chain}.`;
      } else {
        text = hasPositions
          ? ` Successfully fetched all your Morpho positions on ${chain}. Found ${positions.filter(p => p?.hasPosition).length} position${positions.filter(p => p?.hasPosition).length === 1 ? '' : 's'}.`
          : ` You don't have any open positions on ${chain}.`;
      }

      // Format market position data for frontend consumption
      const formattedPositions = formatMarketPositionData(positions);

      const data = {
        actionName: "GET_MORPHO_MARKET_POSITIONS",
        params: inputParams,
        positions: formattedPositions,
        rawPositions: positions, // Keep raw data for reference
      };

      if (callback) {
        await callback({
          text,
          actions: ["GET_MORPHO_MARKET_POSITIONS"],
          source: message.content.source,
          data,
        });
      }

      const successResult: MarketPositionsActionResult = {
        text,
        success: true,
        data,
        input: inputParams,
        values: {
          positionsFetched: true,
          positionsCount: positions.length,
          requestedMarket: inputParams.market ?? null,
          positions: formattedPositions,
        },
      };

      return successResult;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`[GET_MORPHO_MARKET_POSITIONS] Action failed: ${msg}`);

      // Try to capture input params even in failure
      let failureInputParams: MarketPositionsInput = {};
      try {
        const composedState = await runtime.composeState(message, ["ACTION_STATE"], true);
        const params = (composedState?.data?.actionParams ?? {}) as Partial<MarketPositionsParams>;
        failureInputParams = {
          market: params.market?.trim(),
          chain: params.chain?.trim()?.toLowerCase(),
        };
      } catch (e) {
        // If we can't get params, just use empty object
      }

      const text = ` Failed to get positions: ${msg}`;
      const data = { actionName: "GET_MORPHO_MARKET_POSITIONS", error: msg };

      const errorResult: MarketPositionsActionResult = {
        text,
        success: false,
        error: msg,
        data,
        input: failureInputParams,
        values: {
          error: true,
          positionsFetched: false,
        },
      };

      if (callback) {
        await callback({
          text,
          actions: ["GET_MORPHO_MARKET_POSITIONS"],
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
        content: { text: "Show me my market positions" },
      },
      {
        name: "{{name2}}",
        content: {
          text: "Here are your open market positions...",
          action: "GET_MORPHO_MARKET_POSITIONS",
        },
      },
    ],
    [
      {
        name: "{{name1}}",
        content: { text: "Do I have a position on wstETH / WETH?" },
      },
      {
        name: "{{name2}}",
        content: {
          text: "Here is your position on wstETH / WETH...",
          action: "GET_MORPHO_MARKET_POSITIONS",
        },
      },
    ],
    [
      {
        name: "{{name1}}",
        content: {
          text: "Check my market position on 0x3a4048c64ba1b375330d376b1ce40e4047d03b47ab4d48af484edec9fec801ba",
        },
      },
      {
        name: "{{name2}}",
        content: {
          text: "Here’s your position for the requested market...",
          action: "GET_MORPHO_MARKET_POSITIONS",
        },
      },
    ],
  ],
};
