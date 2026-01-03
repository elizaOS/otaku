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

interface VaultTransferParams {
  intent: "deposit" | "withdraw";
  vault: string;
  assets: string;
  chain?: string;
}

type VaultTransferInput = {
  intent?: "deposit" | "withdraw";
  vault?: string;
  assets?: string;
  chain?: string;
};

type VaultTransferActionResult = ActionResult & { input: VaultTransferInput };

export const vaultTransferAction: Action = {
  name: "MORPHO_VAULT_TRANSFER",
  similes: [
    "VAULT_TRANSFER",
    "MORPHO_DEPOSIT",
    "MORPHO_WITHDRAW",
    "DEPOSIT_TO_VAULT",
    "WITHDRAW_FROM_VAULT",
  ],
  description:
    "Use this action when you need to deposit to or withdraw from a Morpho ERC-4626 vault.",

  parameters: {
    intent: {
      type: "string",
      description: 'Transfer intent - must be either "deposit" or "withdraw"',
      required: true,
    },
    vault: {
      type: "string",
      description:
        'Vault identifier - can be a vault name (e.g., "Spark USDC Vault") or a vault address (0x...)',
      required: true,
    },
    assets: {
      type: "string",
      description:
        'Amount to transfer in human-readable format (e.g., "1", "0.5", "100"). Pure number without units or symbols.',
      required: true,
    },
    chain: {
      type: "string",
      description:
        "Blockchain network (e.g., 'base', 'base-sepolia'). If not provided, uses the default chain.",
      required: false,
    },
  },

  validate: async (runtime: IAgentRuntime, message: Memory, state?: State) => {
    return validateMorphoService(runtime, "MORPHO_VAULT_TRANSFER", state, message);
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    options?: any,
    callback?: HandlerCallback,
  ): Promise<ActionResult> => {
    logger.info("[MORPHO_VAULT_TRANSFER] Starting vault transfer");

    try {
      // Read parameters from state
      const composedState = await runtime.composeState(message, ["ACTION_STATE"], true);
      const params = (composedState?.data?.actionParams ?? {}) as Partial<VaultTransferParams>;

      // Store input parameters for return
      const inputParams: VaultTransferInput = {
        intent: params.intent,
        vault: params.vault?.trim(),
        assets: params.assets?.trim(),
        chain: params.chain?.trim()?.toLowerCase(),
      };

      logger.info(
        `[MORPHO_VAULT_TRANSFER] Params: intent=${inputParams.intent}, vault=${inputParams.vault}, assets=${inputParams.assets}, chain=${inputParams.chain || "default"}`,
      );

      // Validate intent
      if (!inputParams.intent) {
        const errorMsg = 'Missing intent. Please specify "deposit" or "withdraw".';
        logger.error(`[MORPHO_VAULT_TRANSFER] ${errorMsg}`);
        const errorResult: VaultTransferActionResult = {
          text: ` ${errorMsg}`,
          success: false,
          error: "missing_intent",
          data: { actionName: "MORPHO_VAULT_TRANSFER", error: errorMsg },
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

      if (inputParams.intent !== "deposit" && inputParams.intent !== "withdraw") {
        const errorMsg = `Invalid intent "${inputParams.intent}". Use "deposit" or "withdraw".`;
        logger.error(`[MORPHO_VAULT_TRANSFER] ${errorMsg}`);
        const errorResult: VaultTransferActionResult = {
          text: ` ${errorMsg}`,
          success: false,
          error: "invalid_intent",
          data: { actionName: "MORPHO_VAULT_TRANSFER", error: errorMsg },
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

      // Validate vault
      if (!inputParams.vault) {
        const errorMsg = 'Missing vault. Provide a vault name (e.g., "Spark USDC Vault") or a 0x-address.';
        logger.error(`[MORPHO_VAULT_TRANSFER] ${errorMsg}`);
        const errorResult: VaultTransferActionResult = {
          text: ` ${errorMsg}`,
          success: false,
          error: "missing_vault",
          data: { actionName: "MORPHO_VAULT_TRANSFER", error: errorMsg },
          input: inputParams,
          values: { error: true },
        };
        if (callback) {
          await callback({
            text: errorResult.text,
            content: { error: "missing_vault", details: errorMsg },
          });
        }
        return errorResult;
      }

      // Validate assets
      if (!inputParams.assets) {
        const errorMsg = 'Missing amount. Provide a pure number without units (e.g., "1", "0.5", "100").';
        logger.error(`[MORPHO_VAULT_TRANSFER] ${errorMsg}`);
        const errorResult: VaultTransferActionResult = {
          text: ` ${errorMsg}`,
          success: false,
          error: "missing_amount",
          data: { actionName: "MORPHO_VAULT_TRANSFER", error: errorMsg },
          input: inputParams,
          values: { error: true },
        };
        if (callback) {
          await callback({
            text: errorResult.text,
            content: { error: "missing_amount", details: errorMsg },
          });
        }
        return errorResult;
      }

      const amountNum = Number(inputParams.assets);
      if (!Number.isFinite(amountNum) || amountNum <= 0) {
        const errorMsg = `Invalid amount "${inputParams.assets}". Use a positive number without units (e.g., "1", "2.5").`;
        logger.error(`[MORPHO_VAULT_TRANSFER] ${errorMsg}`);
        const errorResult: VaultTransferActionResult = {
          text: ` ${errorMsg}`,
          success: false,
          error: "invalid_amount",
          data: { actionName: "MORPHO_VAULT_TRANSFER", error: errorMsg },
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

      // Determine chain - default to 'base' if not provided
      const chain = (inputParams.chain as any) || 'base';

      // Get services
      const service = runtime.getService(MorphoService.serviceType) as MorphoService;
      const cdp = runtime.getService(CdpService.serviceType) as CdpService;

      if (!cdp || typeof cdp.getViemClientsForAccount !== "function") {
        const errorMsg = "CDP service not available";
        logger.error(`[MORPHO_VAULT_TRANSFER] ${errorMsg}`);
        const errorResult: VaultTransferActionResult = {
          text: ` ${errorMsg}`,
          success: false,
          error: "service_unavailable",
          data: { actionName: "MORPHO_VAULT_TRANSFER", error: errorMsg },
          input: inputParams,
          values: { error: true },
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
        "MORPHO_VAULT_TRANSFER",
        callback,
      );

      if (wallet.success === false) {
        logger.warn("[MORPHO_VAULT_TRANSFER] Entity wallet verification failed");
        return {
          ...wallet.result,
          input: inputParams,
        } as ActionResult & { input: typeof inputParams };
      }

      const accountName = wallet.metadata?.accountName as string | undefined;

      if (!accountName) {
        const errorMsg = "Could not resolve user wallet";
        logger.error(`[MORPHO_VAULT_TRANSFER] ${errorMsg}`);
        const errorResult: VaultTransferActionResult = {
          text: ` ${errorMsg}`,
          success: false,
          error: "missing_account_name",
          data: { actionName: "MORPHO_VAULT_TRANSFER", error: errorMsg },
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
          publicClient: viem.publicClient,
        };
      } catch (e) {
        const errorMsg = `Unable to initialize wallet: ${e instanceof Error ? e.message : String(e)}`;
        logger.error(`[MORPHO_VAULT_TRANSFER] ${errorMsg}`);
        const errorResult: VaultTransferActionResult = {
          text: ` ${errorMsg}`,
          success: false,
          error: "wallet_initialization_failed",
          data: { actionName: "MORPHO_VAULT_TRANSFER", error: errorMsg },
          input: inputParams,
          values: { error: true },
        };
        if (callback) {
          await callback({
            text: errorResult.text,
            content: { error: "wallet_initialization_failed", details: errorMsg },
          });
        }
        return errorResult;
      }

      // Execute the transfer
      let hashes: `0x${string}`[] = [];
      if (inputParams.intent === "withdraw") {
        hashes = await service.withdrawFromVault(
          {
            vault: inputParams.vault,
            assets: inputParams.assets,
            chain,
          },
          viemClients,
        );
      } else {
        hashes = await service.depositToVault(
          {
            vault: inputParams.vault,
            assets: inputParams.assets,
            chain,
            approveAmount: "max",
          },
          viemClients,
        );
      }

      const urls = (hashes || []).map((h) => getTxExplorerUrl(chain, h) || h);
      const list = urls.length
        ? urls.map((u) => `• ${u}`).join("\n")
        : "• (no hash returned)";

      const text =
        ` **${inputParams.intent.toUpperCase()}** submitted for **${inputParams.assets}** in **${inputParams.vault}**.\n\n` +
        `**Transaction${hashes.length > 1 ? "s" : ""}:**\n${list}`;

      const data = {
        actionName: "MORPHO_VAULT_TRANSFER",
        intent: inputParams.intent,
        params: inputParams,
        txHashes: hashes,
        txUrls: urls,
        chain,
      };

      if (callback) {
        await callback({
          text,
          actions: ["MORPHO_VAULT_TRANSFER"],
          source: message.content.source,
          data,
        });
      }

      const successResult: VaultTransferActionResult = {
        text,
        success: true,
        data,
        input: inputParams,
        values: {
          intent: inputParams.intent,
          vault: inputParams.vault,
          assets: inputParams.assets,
          txCount: hashes.length,
        },
      };

      return successResult;
    } catch (error: any) {
      const msg = error?.shortMessage || error?.message || String(error);
      logger.error(`[MORPHO_VAULT_TRANSFER] Action failed: ${msg}`);

      // Try to capture input params even in failure
      let failureInputParams: VaultTransferInput = {};
      try {
        const composedState = await runtime.composeState(message, ["ACTION_STATE"], true);
        const params = (composedState?.data?.actionParams ?? {}) as Partial<VaultTransferParams>;
        failureInputParams = {
          intent: params.intent,
          vault: params.vault?.trim(),
          assets: params.assets?.trim(),
          chain: params.chain?.trim()?.toLowerCase(),
        };
      } catch (e) {
        // If we can't get params, just use empty object
      }

      const text = ` Vault transfer failed: ${msg}`;
      const data = { actionName: "MORPHO_VAULT_TRANSFER", error: msg };

      const errorResult: VaultTransferActionResult = {
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
          actions: ["MORPHO_VAULT_TRANSFER"],
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
        content: { text: "Deposit 1 USDC into Spark USDC Vault" },
      },
      {
        name: "{{name2}}",
        content: {
          text: "💰 Depositing 1 USDC into Spark USDC Vault for automated yield...",
          action: "MORPHO_VAULT_TRANSFER",
        },
      },
    ],
    [
      {
        name: "{{name1}}",
        content: { text: "Withdraw 1 USDC from Spark USDC Vault" },
      },
      {
        name: "{{name2}}",
        content: {
          text: "📤 Withdrawing 1 USDC from Spark USDC Vault...",
          action: "MORPHO_VAULT_TRANSFER",
        },
      },
    ],
    [
      {
        name: "{{name1}}",
        content: {
          text: "Deposit 0.5 WETH into Morpho WETH Vault",
        },
      },
      {
        name: "{{name2}}",
        content: {
          text: "💰 Depositing 0.5 WETH into vault for optimized returns...",
          action: "MORPHO_VAULT_TRANSFER",
        },
      },
    ],
  ],
};
