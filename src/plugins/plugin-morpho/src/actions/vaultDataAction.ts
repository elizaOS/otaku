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
import type { MorphoVaultData } from "../types";
import { getEntityWallet } from "../../../../utils/entity";
import { validateMorphoService, extractActionParams } from "../utils/actionHelpers";

interface VaultInfoParams {
  vault?: string;
  chain?: string;
}

type VaultInfoInput = {
  vault?: string;
  chain?: string;
};

type VaultInfoActionResult = ActionResult & { input: VaultInfoInput };

/* =========================
 * Action: GET_MORPHO_VAULT_INFO
 * ========================= */
export const vaultInfoAction: Action = {
  name: "GET_MORPHO_VAULT_INFO",
  similes: [
    "VAULT_INFO",
    "VAULT_DATA",
    "MORPHO_VAULT_INFO",
    "MORPHO_VAULTS",
    "YIELD_VAULTS",
  ],
  description:
    "Use this action when you need current Morpho vault data (totals and APYs).",

  parameters: {
    vault: {
      type: "string",
      description:
        "Morpho vault identifier - can be a vault name (e.g., 'Spark USDC Vault') or a vault address (0x...). If not provided, returns all available vaults.",
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
    return validateMorphoService(runtime, "GET_MORPHO_VAULT_INFO", state, message);
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    options?: any,
    callback?: HandlerCallback,
  ): Promise<ActionResult> => {
    logger.info("[GET_MORPHO_VAULT_INFO] Starting Morpho vault info action");

    try {
      // Read parameters from state
      const composedState = await runtime.composeState(message, ["ACTION_STATE"], true);
      const params = (composedState?.data?.actionParams ?? {}) as Partial<VaultInfoParams>;

      // Store input parameters for return
      const inputParams: VaultInfoInput = {
        vault: params.vault?.trim(),
        chain: params.chain?.trim()?.toLowerCase(),
      };

      logger.info(
        `[GET_MORPHO_VAULT_INFO] Params: vault=${inputParams.vault || "all"}, chain=${inputParams.chain || "default"}`,
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
        logger.error(`[GET_MORPHO_VAULT_INFO] ${errorMsg}`);
        const errorResult: VaultInfoActionResult = {
          text: ` ${errorMsg}`,
          success: false,
          error: "service_unavailable",
          data: { actionName: "GET_MORPHO_VAULT_INFO", error: errorMsg },
          input: inputParams,
          values: {
            error: true,
            vaultsFetched: false,
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
        "GET_MORPHO_VAULT_INFO",
        callback,
      );

      if (wallet.success === false) {
        logger.warn("[GET_MORPHO_VAULT_INFO] Entity wallet verification failed");
        return {
          ...wallet.result,
          input: inputParams,
        } as ActionResult & { input: typeof inputParams };
      }

      const accountName = wallet.metadata?.accountName as string | undefined;

      if (!accountName) {
        const errorMsg = "Could not resolve user wallet";
        logger.error(`[GET_MORPHO_VAULT_INFO] ${errorMsg}`);
        const errorResult: VaultInfoActionResult = {
          text: ` ${errorMsg}`,
          success: false,
          error: "missing_account_name",
          data: { actionName: "GET_MORPHO_VAULT_INFO", error: errorMsg },
          input: inputParams,
          values: {
            error: true,
            vaultsFetched: false,
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

      // Get viem clients for the account on the specified chain (though not strictly needed for vault data, maintain consistency)
      await cdp.getViemClientsForAccount({
        accountName,
        network: chain,
      });

      const vaults = await service.getVaultData(inputParams.vault, chain);

      if (!vaults.length) {
        const errorText = ` No vault data${inputParams.vault ? ` for ${inputParams.vault}` : ""} found.`;
        const data = {
          actionName: "GET_MORPHO_VAULT_INFO",
          params: inputParams,
          vaults: [],
        };
        const errorResult: VaultInfoActionResult = {
          text: errorText,
          success: false,
          data,
          input: inputParams,
          values: {
            vaultsFetched: false,
            vaultsCount: 0,
            requestedVault: inputParams.vault ?? null,
          },
        };
        if (callback) {
          await callback({
            text: errorText,
            actions: ["GET_MORPHO_VAULT_INFO"],
            source: message.content.source,
            data,
          });
        }
        return errorResult;
      }

      // Success message
      const text = inputParams.vault
        ? ` Successfully fetched vault data for ${inputParams.vault} on ${chain}.`
        : ` Successfully fetched all Morpho vaults on ${chain}. Found ${vaults.length} vault${vaults.length === 1 ? '' : 's'}.`;

      const data = { actionName: "GET_MORPHO_VAULT_INFO", params: inputParams, vaults };

      if (callback) {
        await callback({
          text,
          actions: ["GET_MORPHO_VAULT_INFO"],
          source: message.content.source,
          data,
        });
      }

      const successResult: VaultInfoActionResult = {
        text,
        success: true,
        data,
        input: inputParams,
        values: {
          vaultsFetched: true,
          vaultsCount: vaults.length,
          requestedVault: inputParams.vault ?? null,
        },
      };

      return successResult;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`[GET_MORPHO_VAULT_INFO] Action failed: ${msg}`);

      // Try to capture input params even in failure
      let failureInputParams: VaultInfoInput = {};
      try {
        const composedState = await runtime.composeState(message, ["ACTION_STATE"], true);
        const params = (composedState?.data?.actionParams ?? {}) as Partial<VaultInfoParams>;
        failureInputParams = {
          vault: params.vault?.trim(),
          chain: params.chain?.trim()?.toLowerCase(),
        };
      } catch (e) {
        // If we can't get params, just use empty object
      }

      const text = ` Failed to get vault info: ${msg}`;
      const data = { actionName: "GET_MORPHO_VAULT_INFO", error: msg };

      const errorResult: VaultInfoActionResult = {
        text,
        success: false,
        error: msg,
        data,
        input: failureInputParams,
        values: {
          error: true,
          vaultsFetched: false,
        },
      };

      if (callback) {
        await callback({
          text,
          actions: ["GET_MORPHO_VAULT_INFO"],
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
        content: { text: "Show vault data" },
      },
      {
        name: "{{name2}}",
        content: {
          text: "Here is the complete vault overview...",
          action: "GET_MORPHO_VAULT_INFO",
        },
      },
    ],
    [
      {
        name: "{{name1}}",
        content: { text: "Show data for Metronome msETH Vault" },
      },
      {
        name: "{{name2}}",
        content: {
          text: "Here is the data for Metronome msETH Vault...",
          action: "GET_MORPHO_VAULT_INFO",
        },
      },
    ],
    [
      {
        name: "{{name1}}",
        content: {
          text: "Check this vault: 0x43Cd00De63485618A5CEEBE0de364cD6cBeB26E7",
        },
      },
      {
        name: "{{name2}}",
        content: {
          text: "Here’s the current data for the requested vault...",
          action: "GET_MORPHO_VAULT_INFO",
        },
      },
    ],
  ],
};
