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
import { getEntityWallet } from "../../../../utils/entity";
import { getTxExplorerUrl } from "../../../../constants/chains";
import { validateMorphoService, extractActionParams } from "../utils/actionHelpers";

interface MarketTransferParams {
  intent?: string;
  market?: string;
  assets?: string;
  fullRepayment?: boolean;
  chain?: string;
}

type MarketTransferInput = {
  intent?: string;
  market?: string;
  assets?: string;
  fullRepayment?: boolean;
  chain?: string;
};

type MarketTransferActionResult = ActionResult & { input: MarketTransferInput };

function getOperationEmoji(intent: string): string {
  switch (intent) {
    case "supply":
      return "🏦";
    case "supplyCollateral":
      return "🔐";
    case "borrow":
      return "💸";
    case "repay":
      return "💰";
    case "withdraw":
      return "📤";
    case "withdrawCollateral":
      return "🔓";
    default:
      return "⚡";
  }
}

function getOperationDescription(intent: string): string {
  switch (intent) {
    case "supply":
      return "Supply (lend assets to earn yield)";
    case "supplyCollateral":
      return "Supply Collateral (secure borrowing position)";
    case "borrow":
      return "Borrow (borrow assets against collateral)";
    case "repay":
      return "Repay (repay borrowed assets)";
    case "withdraw":
      return "Withdraw (withdraw supplied assets)";
    case "withdrawCollateral":
      return "Withdraw Collateral (remove collateral)";
    default:
      return "Market Operation";
  }
}

export const marketTransferAction: Action = {
  name: "MORPHO_MARKET_TRANSFER",
  similes: [
    "MARKET_TRANSFER",
    "MORPHO_SUPPLY",
    "MORPHO_BORROW",
    "MORPHO_REPAY",
    "MORPHO_WITHDRAW",
    "SUPPLY_MARKET",
    "BORROW_MARKET",
    "REPAY_MARKET",
    "WITHDRAW_MARKET",
    "SUPPLY_COLLATERAL",
    "WITHDRAW_COLLATERAL",
    "LEND_ASSETS",
    "PROVIDE_COLLATERAL",
  ],
  description:
    "Use this action when you need to perform Morpho market operations (supply/borrow/repay/withdraw/collateral).",

  parameters: {
    intent: {
      type: "string",
      description:
        "Operation type: 'supply' (lend loan token), 'supplyCollateral' (provide collateral), 'borrow' (borrow loan token), 'repay' (repay loan), 'withdraw' (withdraw loan token), 'withdrawCollateral' (remove collateral)",
      required: true,
    },
    market: {
      type: "string",
      description:
        "Market identifier - can be a token pair (e.g., 'WETH/USDC') or a market ID (0x... hex string)",
      required: true,
    },
    assets: {
      type: "string",
      description:
        "Amount of assets as a pure number (e.g., '1', '0.5', '100'). Not required if fullRepayment is true.",
      required: false,
    },
    fullRepayment: {
      type: "boolean",
      description:
        "Set to true for full repayment of debt (only applicable for 'repay' intent)",
      required: false,
    },
    chain: {
      type: "string",
      description:
        "Blockchain network (e.g., 'base', 'ethereum'). If not provided, uses the default chain.",
      required: false,
    },
  },
  validate: async (runtime: IAgentRuntime, message: Memory, state?: State) => {
    return validateMorphoService(runtime, "MORPHO_MARKET_TRANSFER", state, message);
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    options?: any,
    callback?: HandlerCallback,
  ): Promise<ActionResult> => {
    logger.info("[MORPHO_MARKET_TRANSFER] Starting market transfer action");

    try {
      // Read parameters from state
      const composedState = await runtime.composeState(message, ["ACTION_STATE"], true);
      const params = (composedState?.data?.actionParams ?? {}) as Partial<MarketTransferParams>;

      // Store input parameters for return
      const inputParams: MarketTransferInput = {
        intent: params.intent?.trim().toLowerCase(),
        market: params.market?.trim(),
        assets: params.assets?.trim(),
        fullRepayment: params.fullRepayment === true,
        chain: params.chain?.trim().toLowerCase(),
      };

      logger.info(
        `[MORPHO_MARKET_TRANSFER] Params: intent=${inputParams.intent}, market=${inputParams.market}, assets=${inputParams.assets}, fullRepayment=${inputParams.fullRepayment}, chain=${inputParams.chain || "default"}`,
      );

      // Validate intent
      const validIntents = [
        "supply",
        "supplycollateral",
        "borrow",
        "repay",
        "withdraw",
        "withdrawcollateral",
      ];
      
      if (!inputParams.intent) {
        const errorMsg = "Missing operation. Please specify supply, supplyCollateral, borrow, repay, withdraw, or withdrawCollateral.";
        logger.error(`[MORPHO_MARKET_TRANSFER] ${errorMsg}`);
        const errorResult: MarketTransferActionResult = {
          text: `❌ ${errorMsg}`,
          success: false,
          error: "missing_intent",
          data: { actionName: "MORPHO_MARKET_TRANSFER", error: errorMsg },
          input: inputParams,
          values: { error: true },
        };
        if (callback) {
          await callback({
            text: errorResult.text,
            content: { error: "missing_intent", details: errorMsg },
          });
        }
        return errorResult;
      }

      if (!validIntents.includes(inputParams.intent)) {
        const errorMsg = `Invalid operation "${inputParams.intent}". Use: supply, supplyCollateral, borrow, repay, withdraw, or withdrawCollateral.`;
        logger.error(`[MORPHO_MARKET_TRANSFER] ${errorMsg}`);
        const errorResult: MarketTransferActionResult = {
          text: `❌ ${errorMsg}`,
          success: false,
          error: "invalid_intent",
          data: { actionName: "MORPHO_MARKET_TRANSFER", error: errorMsg },
          input: inputParams,
          values: { error: true },
        };
        if (callback) {
          await callback({
            text: errorResult.text,
            content: { error: "invalid_intent", details: errorMsg },
          });
        }
        return errorResult;
      }

      // Validate market
      if (!inputParams.market) {
        const errorMsg = 'Missing market. Provide a market pair (e.g., "WETH/USDC") or marketId.';
        logger.error(`[MORPHO_MARKET_TRANSFER] ${errorMsg}`);
        const errorResult: MarketTransferActionResult = {
          text: `❌ ${errorMsg}`,
          success: false,
          error: "missing_market",
          data: { actionName: "MORPHO_MARKET_TRANSFER", error: errorMsg },
          input: inputParams,
          values: { error: true },
        };
        if (callback) {
          await callback({
            text: errorResult.text,
            content: { error: "missing_market", details: errorMsg },
          });
        }
        return errorResult;
      }

      // Validate assets (required for all operations except full repayment)
      if (!inputParams.fullRepayment && !inputParams.assets) {
        const errorMsg = 'Missing amount. Provide a pure number without units (e.g., "1", "0.5", "100").';
        logger.error(`[MORPHO_MARKET_TRANSFER] ${errorMsg}`);
        const errorResult: MarketTransferActionResult = {
          text: `❌ ${errorMsg}`,
          success: false,
          error: "missing_assets",
          data: { actionName: "MORPHO_MARKET_TRANSFER", error: errorMsg },
          input: inputParams,
          values: { error: true },
        };
        if (callback) {
          await callback({
            text: errorResult.text,
            content: { error: "missing_assets", details: errorMsg },
          });
        }
        return errorResult;
      }

      // Validate assets amount
      let amountNum = 0;
      if (inputParams.assets) {
        amountNum = Number(inputParams.assets);
        if (!Number.isFinite(amountNum) || amountNum <= 0) {
          const errorMsg = `Invalid amount "${inputParams.assets}". Use a positive number without units (e.g., "1", "2.5").`;
          logger.error(`[MORPHO_MARKET_TRANSFER] ${errorMsg}`);
          const errorResult: MarketTransferActionResult = {
            text: `❌ ${errorMsg}`,
            success: false,
            error: "invalid_amount",
            data: { actionName: "MORPHO_MARKET_TRANSFER", error: errorMsg },
            input: inputParams,
            values: { error: true },
          };
          if (callback) {
            await callback({
              text: errorResult.text,
              content: { error: "invalid_amount", details: errorMsg },
            });
          }
          return errorResult;
        }
      }

      // Get services
      const service = runtime.getService(MorphoService.serviceType) as MorphoService;
      const cdp = runtime.getService(CdpService.serviceType) as CdpService;

      // Determine chain - default to 'base' if not provided
      const chain = (inputParams.chain as any) || 'base';

      // Get entity wallet
      const wallet = await getEntityWallet(
        runtime,
        message,
        "MORPHO_MARKET_TRANSFER",
        callback,
      );

      if (wallet.success === false) {
        logger.warn("[MORPHO_MARKET_TRANSFER] Entity wallet verification failed");
        return {
          ...wallet.result,
          input: inputParams,
        } as ActionResult & { input: typeof inputParams };
      }

      const accountName = wallet.metadata?.accountName as string | undefined;

      if (!accountName) {
        const errorMsg = "Could not resolve user wallet";
        logger.error(`[MORPHO_MARKET_TRANSFER] ${errorMsg}`);
        const errorResult: MarketTransferActionResult = {
          text: `❌ ${errorMsg}`,
          success: false,
          error: "missing_account_name",
          data: { actionName: "MORPHO_MARKET_TRANSFER", error: errorMsg },
          input: inputParams,
          values: { error: true },
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
      let viemClients: { walletClient: any; publicClient: any };
      try {
        const viem = await cdp.getViemClientsForAccount({
          accountName,
          network: chain,
        });
        viemClients = { 
          walletClient: viem.walletClient, 
          publicClient: viem.publicClient 
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const errorMsg = `Unable to initialize CDP wallet: ${msg}`;
        logger.error(`[MORPHO_MARKET_TRANSFER] ${errorMsg}`);
        const errorResult: MarketTransferActionResult = {
          text: `❌ ${errorMsg}`,
          success: false,
          error: msg,
          data: { actionName: "MORPHO_MARKET_TRANSFER", error: errorMsg },
          input: inputParams,
          values: { error: true },
        };
        if (callback) {
          await callback({
            text: errorResult.text,
            content: { error: "wallet_init_failed", details: errorMsg },
          });
        }
        return errorResult;
      }

      // Execute the appropriate operation
      let hashes: `0x${string}`[] = [];
      let operationParams: any = { market: inputParams.market };

      switch (inputParams.intent) {
        case "supply":
          operationParams.assets = inputParams.assets;
          hashes = await service.supply(operationParams, viemClients);
          break;

        case "supplycollateral":
          operationParams.assets = inputParams.assets;
          hashes = await service.supplyCollateral(operationParams, viemClients);
          break;

        case "borrow":
          operationParams.assets = inputParams.assets;
          hashes = await service.borrow(operationParams, viemClients);
          break;

        case "repay":
          if (inputParams.fullRepayment) {
            operationParams.fullRepayment = true;
          } else {
            operationParams.assets = inputParams.assets;
          }
          hashes = await service.repay(operationParams, viemClients);
          break;

        case "withdraw":
          operationParams.assets = inputParams.assets;
          hashes = await service.withdraw(operationParams, viemClients);
          break;

        case "withdrawcollateral":
          operationParams.assets = inputParams.assets;
          hashes = await service.withdrawCollateral(operationParams, viemClients);
          break;

        default:
          const errorMsg = `Unsupported operation: ${inputParams.intent}`;
          logger.error(`[MORPHO_MARKET_TRANSFER] ${errorMsg}`);
          const errorResult: MarketTransferActionResult = {
            text: `❌ ${errorMsg}`,
            success: false,
            error: "unsupported_operation",
            data: { actionName: "MORPHO_MARKET_TRANSFER", error: errorMsg },
            input: inputParams,
            values: { error: true },
          };
          if (callback) {
            await callback({
              text: errorResult.text,
              content: { error: "unsupported_operation", details: errorMsg },
            });
          }
          return errorResult;
      }

      // Build transaction URLs
      const urls = (hashes || []).map((h) => getTxExplorerUrl(chain, h) || h);
      const list = urls.length
        ? urls.map((u) => `• ${u}`).join("\n")
        : "• (no hash returned)";

      const emoji = getOperationEmoji(inputParams.intent);
      const description = getOperationDescription(inputParams.intent);
      const amountText = inputParams.fullRepayment 
        ? "full debt" 
        : `${inputParams.assets} assets`;

      const text = `✅ ${emoji} **${description}** completed for **${amountText}** in **${inputParams.market}** on **${chain}**.\n\n**Transaction${hashes.length > 1 ? "s" : ""}:**\n${list}`;

      const data = {
        actionName: "MORPHO_MARKET_TRANSFER",
        intent: inputParams.intent,
        params: operationParams,
        txHashes: hashes,
        txUrls: urls,
        chain,
      };

      if (callback) {
        await callback({
          text,
          actions: ["MORPHO_MARKET_TRANSFER"],
          source: message.content.source,
          data,
        });
      }

      const successResult: MarketTransferActionResult = {
        text,
        success: true,
        data,
        input: inputParams,
        values: {
          intent: inputParams.intent,
          market: inputParams.market,
          assets: inputParams.assets || "full",
          txCount: hashes.length,
          fullRepayment: inputParams.fullRepayment,
          txHashes: hashes,
        },
      };

      return successResult;
    } catch (error: any) {
      const msg = error?.shortMessage || error?.message || String(error);
      logger.error(`[MORPHO_MARKET_TRANSFER] Action failed: ${msg}`);

      // Try to capture input params even in failure
      let failureInputParams: MarketTransferInput = {};
      try {
        const composedState = await runtime.composeState(message, ["ACTION_STATE"], true);
        const params = (composedState?.data?.actionParams ?? {}) as Partial<MarketTransferParams>;
        failureInputParams = {
          intent: params.intent?.trim().toLowerCase(),
          market: params.market?.trim(),
          assets: params.assets?.trim(),
          fullRepayment: params.fullRepayment === true,
          chain: params.chain?.trim().toLowerCase(),
        };
      } catch (e) {
        // If we can't get params, just use empty object
      }

      const text = `❌ Market operation failed: ${msg}`;
      const data = { actionName: "MORPHO_MARKET_TRANSFER", error: msg };

      const errorResult: MarketTransferActionResult = {
        text,
        success: false,
        error: msg,
        data,
        input: failureInputParams,
        values: { error: true },
      };

      if (callback) {
        await callback({
          text,
          actions: ["MORPHO_MARKET_TRANSFER"],
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
        content: { text: "Supply 1 USDC to WETH/USDC market" },
      },
      {
        name: "{{name2}}",
        content: {
          text: "🏦 Supplying 1 USDC to earn yield in WETH/USDC market...",
          action: "MORPHO_MARKET_TRANSFER",
        },
      },
    ],
    [
      {
        name: "{{name1}}",
        content: { text: "Provide 0.1 WETH as collateral in WETH/USDC" },
      },
      {
        name: "{{name2}}",
        content: {
          text: "🔐 Providing 0.1 WETH as collateral in WETH/USDC market...",
          action: "MORPHO_MARKET_TRANSFER",
        },
      },
    ],
    [
      {
        name: "{{name1}}",
        content: { text: "Borrow 100 USDC from WETH/USDC market" },
      },
      {
        name: "{{name2}}",
        content: {
          text: "💸 Borrowing 100 USDC against WETH collateral...",
          action: "MORPHO_MARKET_TRANSFER",
        },
      },
    ],
    [
      {
        name: "{{name1}}",
        content: { text: "Repay all my USDC debt in WETH/USDC" },
      },
      {
        name: "{{name2}}",
        content: {
          text: "💰 Repaying all USDC debt in WETH/USDC market...",
          action: "MORPHO_MARKET_TRANSFER",
        },
      },
    ],
    [
      {
        name: "{{name1}}",
        content: { text: "Withdraw 0.5 USDC from WETH/USDC" },
      },
      {
        name: "{{name2}}",
        content: {
          text: "📤 Withdrawing 0.5 USDC from supply position...",
          action: "MORPHO_MARKET_TRANSFER",
        },
      },
    ],
    [
      {
        name: "{{name1}}",
        content: { text: "Remove 0.05 WETH collateral from WETH/USDC" },
      },
      {
        name: "{{name2}}",
        content: {
          text: "🔓 Removing 0.05 WETH collateral from WETH/USDC market...",
          action: "MORPHO_MARKET_TRANSFER",
        },
      },
    ],
    [
      {
        name: "{{name1}}",
        content: { text: "Repay 50 USDC in WETH/USDC market" },
      },
      {
        name: "{{name2}}",
        content: {
          text: "💰 Repaying 50 USDC debt in WETH/USDC market...",
          action: "MORPHO_MARKET_TRANSFER",
        },
      },
    ],
    [
      {
        name: "{{name1}}",
        content: { text: "Lend 2 USDC to earn yield in WETH/USDC" },
      },
      {
        name: "{{name2}}",
        content: {
          text: "🏦 Lending 2 USDC to earn yield in WETH/USDC market...",
          action: "MORPHO_MARKET_TRANSFER",
        },
      },
    ],
  ],
};
