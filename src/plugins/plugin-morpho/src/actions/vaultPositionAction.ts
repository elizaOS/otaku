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
import type { UserVaultPosition } from "../types";
import { getEntityWallet } from "../../../../utils/entity";
import { CdpService } from "../../../plugin-cdp/services/cdp.service";
import { validateMorphoService, extractActionParams } from "../utils/actionHelpers";
import BigNumber from "bignumber.js";

interface VaultPositionsParams {
  vault?: string;
  chain?: string;
}

type VaultPositionsInput = {
  vault?: string;
  chain?: string;
};

type VaultPositionsActionResult = ActionResult & { input: VaultPositionsInput };

// Helper functions to format vault position data
function normalizeUnitsFromApi(raw: string | number, decimals: number): string {
  const s = typeof raw === "number" ? String(raw) : (raw ?? "0");
  return new BigNumber(s).div(new BigNumber(10).pow(decimals)).toString(10);
}

function formatVaultPositionData(vaults: UserVaultPosition[]) {
  return vaults.map((v) => {
    const decimals = Number(v.vault?.asset?.decimals ?? 18);
    const assetsFormatted = normalizeUnitsFromApi(v.assets, decimals);
    
    return {
      vault: {
        name: v.vault?.name,
        address: v.vault?.address,
        asset: {
          symbol: v.vault?.asset?.symbol,
          decimals: v.vault?.asset?.decimals,
        },
      },
      assets: v.assets, // raw amount
      assetsFormatted: assetsFormatted, // human-readable amount
      apy: {
        daily: v.vault?.state?.dailyApy,
        weekly: v.vault?.state?.weeklyApy,
        monthly: v.vault?.state?.monthlyApy,
        yearly: v.vault?.state?.yearlyApy,
      },
    };
  });
}

/* =========================
 * Action: GET_MORPHO_VAULT_POSITIONS
 * ========================= */
export const vaultPositionsAction: Action = {
  name: "GET_MORPHO_VAULT_POSITIONS",
  similes: [
    "VAULT_POSITIONS",
    "MY_VAULT_POSITIONS",
    "YIELD_VAULTS",
    "MORPHO_VAULTS",
    "MORPHO_VAULT_POSITIONS",
  ],
  description:
    "Use this action when you need your Morpho vault positions (balances and APYs).",

  parameters: {
    vault: {
      type: "string",
      description:
        "Morpho vault identifier - can be a vault name (e.g., 'Spark USDC Vault') or a vault address (0x...). If not provided, returns all vault positions.",
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
    return validateMorphoService(runtime, "GET_MORPHO_VAULT_POSITIONS", state, message);
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    options?: any,
    callback?: HandlerCallback,
  ): Promise<ActionResult> => {
    logger.info("[GET_MORPHO_VAULT_POSITIONS] Starting Morpho vault positions action");

    try {
      // Read parameters from state
      const composedState = await runtime.composeState(message, ["ACTION_STATE"], true);
      const params = (composedState?.data?.actionParams ?? {}) as Partial<VaultPositionsParams>;

      // Store input parameters for return
      const inputParams: VaultPositionsInput = {
        vault: params.vault?.trim(),
        chain: params.chain?.trim()?.toLowerCase(),
      };

      logger.info(
        `[GET_MORPHO_VAULT_POSITIONS] Params: vault=${inputParams.vault || "all"}, chain=${inputParams.chain || "default"}`,
      );

      // Determine chain - default to 'base' if not provided
      const chain = (inputParams.chain as any) || 'base';

      // Get CDP service
      const cdp = runtime.getService(CdpService.serviceType) as CdpService;
      if (!cdp || typeof cdp.getViemClientsForAccount !== "function") {
        const errorMsg = "CDP service not available";
        logger.error(`[GET_MORPHO_VAULT_POSITIONS] ${errorMsg}`);
        const errorResult: VaultPositionsActionResult = {
          text: ` ${errorMsg}`,
          success: false,
          error: "service_unavailable",
          data: { actionName: "GET_MORPHO_VAULT_POSITIONS", error: errorMsg },
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
        "GET_MORPHO_VAULT_POSITIONS",
        callback,
      );

      if (wallet.success === false) {
        logger.warn("[GET_MORPHO_VAULT_POSITIONS] Entity wallet verification failed");
        return {
          ...wallet.result,
          input: inputParams,
        } as ActionResult & { input: typeof inputParams };
      }

      const accountName = wallet.metadata?.accountName as string | undefined;

      if (!accountName) {
        const errorMsg = "Could not resolve user wallet";
        logger.error(`[GET_MORPHO_VAULT_POSITIONS] ${errorMsg}`);
        const errorResult: VaultPositionsActionResult = {
          text: ` ${errorMsg}`,
          success: false,
          error: "missing_account_name",
          data: { actionName: "GET_MORPHO_VAULT_POSITIONS", error: errorMsg },
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

      // Get viem clients for the account on the specified chain
      const viemClient = await cdp.getViemClientsForAccount({
        accountName,
        network: chain,
      });
      const walletAddress = viemClient.address;

      const service = runtime.getService(
        MorphoService.serviceType,
      ) as MorphoService;

      // Fetch vault positions
      let vaults: UserVaultPosition[] = [];
      try {
        vaults = await service.getUserVaultPositionsByAddress(walletAddress, chain);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        logger.error(`[GET_MORPHO_VAULT_POSITIONS] Could not fetch vault positions: ${errMsg}`);
        const errorResult: VaultPositionsActionResult = {
          text: ` Failed to fetch vault positions: ${errMsg}`,
          success: false,
          error: errMsg,
          data: { actionName: "GET_MORPHO_VAULT_POSITIONS", error: errMsg },
          input: inputParams,
          values: {
            error: true,
            vaultsFetched: false,
          },
        };
        if (callback) {
          await callback({
            text: errorResult.text,
            content: { error: "fetch_vault_positions_failed", details: errMsg },
          });
        }
        return errorResult;
      }

      // Optional filter by vault name substring or exact address
      const q = (inputParams.vault ?? "").trim().toLowerCase();
      const isAddr = /^0x[a-fA-F0-9]{40}$/.test(q);
      const filtered = q
        ? vaults.filter((v) =>
            isAddr
              ? (v.vault.address ?? "").toLowerCase() === q
              : (v.vault.name ?? "").toLowerCase().includes(q),
          )
        : vaults;

      // Success message
      let text: string;
      
      if (inputParams.vault) {
        text = filtered.length > 0
          ? ` Successfully fetched your vault position for ${inputParams.vault} on ${chain}.`
          : ` You don't have a position in ${inputParams.vault} on ${chain}.`;
      } else {
        text = filtered.length > 0
          ? ` Successfully fetched all your Morpho vault positions on ${chain}. Found ${filtered.length} vault${filtered.length === 1 ? '' : 's'}.`
          : ` You don't have any vault positions on ${chain}.`;
      }

      // Format vault position data for frontend consumption
      const formattedVaultPositions = formatVaultPositionData(filtered);

      const data = {
        actionName: "GET_MORPHO_VAULT_POSITIONS",
        params: inputParams,
        vaultPositions: formattedVaultPositions,
        rawVaultPositions: filtered, // Keep raw data for reference
      };

      if (callback) {
        await callback({
          text,
          actions: ["GET_MORPHO_VAULT_POSITIONS"],
          source: message.content.source,
          data,
        });
      }

      const successResult: VaultPositionsActionResult = {
        text,
        success: true,
        data,
        input: inputParams,
        values: {
          vaultsFetched: true,
          vaultsCount: filtered.length,
          requestedVault: inputParams.vault ?? null,
          vaultPositions: formattedVaultPositions,
        },
      };

      return successResult;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`[GET_MORPHO_VAULT_POSITIONS] Action failed: ${msg}`);

      // Try to capture input params even in failure
      let failureInputParams: VaultPositionsInput = {};
      try {
        const composedState = await runtime.composeState(message, ["ACTION_STATE"], true);
        const params = (composedState?.data?.actionParams ?? {}) as Partial<VaultPositionsParams>;
        failureInputParams = {
          vault: params.vault?.trim(),
          chain: params.chain?.trim()?.toLowerCase(),
        };
      } catch (e) {
        // If we can't get params, just use empty object
      }

      const text = ` Failed to get vault positions: ${msg}`;
      const data = { actionName: "GET_MORPHO_VAULT_POSITIONS", error: msg };

      const errorResult: VaultPositionsActionResult = {
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
          actions: ["GET_MORPHO_VAULT_POSITIONS"],
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
        content: { text: "Show my vaults" },
      },
      {
        name: "{{name2}}",
        content: {
          text: "Here are your vault balances and APYs...",
          action: "GET_MORPHO_VAULT_POSITIONS",
        },
      },
    ],
    [
      {
        name: "{{name1}}",
        content: { text: "Vault positions only" },
      },
      {
        name: "{{name2}}",
        content: {
          text: "Here are your vault positions...",
          action: "GET_MORPHO_VAULT_POSITIONS",
        },
      },
    ],
    [
      {
        name: "{{name1}}",
        content: { text: "What’s my balance in the Spark USDC Vault?" },
      },
      {
        name: "{{name2}}",
        content: {
          text: "Here is your Spark USDC Vault token balance and APYs...",
          action: "GET_MORPHO_VAULT_POSITIONS",
        },
      },
    ],
    [
      {
        name: "{{name1}}",
        content: {
          text: "Show the vault at 0x7BfA7C4f149E7415b73bdeDfe609237e29CBF34A",
        },
      },
      {
        name: "{{name2}}",
        content: {
          text: "Here is your position in that vault...",
          action: "GET_MORPHO_VAULT_POSITIONS",
        },
      },
    ],
  ],
};
