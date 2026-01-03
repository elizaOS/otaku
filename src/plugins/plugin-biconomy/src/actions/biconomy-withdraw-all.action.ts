import {
  type Action,
  type ActionResult,
  type HandlerCallback,
  type IAgentRuntime,
  logger,
  type Memory,
  type State,
} from "@elizaos/core";
import { parseUnits } from "viem";
import { getEntityWallet } from "../../../../utils/entity";
import { CdpService } from "../../../plugin-cdp/services/cdp.service";
import { CdpNetwork } from "../../../plugin-cdp/types";
import {
  resolveTokenToAddress,
  getTokenDecimals,
} from "../../../plugin-relay/src/utils/token-resolver";
import { BiconomyService } from "../services/biconomy.service";
import { type QuoteRequest } from "../types";
import { validateBiconomyService } from "../utils/actionHelpers";

// CDP network mapping (chain ID -> CDP network name)
const CDP_NETWORK_MAP: Record<number, CdpNetwork> = {
  1: "ethereum",
  8453: "base",
  10: "optimism",
  42161: "arbitrum",
  137: "polygon",
};

const resolveCdpNetworkFromChainId = (chainId: number): CdpNetwork => {
  const network = CDP_NETWORK_MAP[chainId];
  if (!network) {
    throw new Error(`CDP wallet does not support chain ID ${chainId}`);
  }
  return network;
};

// Get chain name from chain ID
const getChainNameFromId = (chainId: number): string => {
  const map: Record<number, string> = {
    1: "ethereum",
    8453: "base",
    10: "optimism",
    42161: "arbitrum",
    137: "polygon",
  };
  return map[chainId] || "unknown";
};

/**
 * Biconomy Withdraw Action
 * 
 * Withdraws a specific token from the Nexus Smart Account to an address.
 * Parameters: chainId, tokenAddress, withdrawAddress
 */
export const biconomyWithdrawAllAction: Action = {
  name: "BICONOMY_WITHDRAW",
  description: `Withdraw a specific token from Biconomy Nexus companion wallet (Smart Account) to a specified address.
Uses runtimeErc20Balance to transfer the full token balance.
Requires a funding token from your EOA to pay orchestration fees (default: 2 USDC).
Parameters: chain (string), token (string), fundingToken (string, optional), withdrawAddress (string, optional).`,
  similes: [
    "WITHDRAW_FROM_BICONOMY",
    "WITHDRAW_NEXUS_TOKEN",
    "BICONOMY_WITHDRAW_TOKEN",
  ],

  parameters: {
    chain: {
      type: "string",
      description: "Chain name (e.g., 'base', 'ethereum', 'arbitrum', 'optimism', 'polygon'). Default: base",
      required: false,
    },
    token: {
      type: "string",
      description: "Token symbol or contract address to withdraw from Smart Account (e.g., 'usdc', 'weth', '0x...')",
      required: true,
    },
    fundingToken: {
      type: "string",
      description: "Token in EOA to use for paying gas (e.g., 'usdc'). Must be in your EOA wallet. Default: usdc",
      required: false,
    },
    fundingAmount: {
      type: "string",
      description: "Amount of funding token for gas (e.g., '2'). Default: 2",
      required: false,
    },
    withdrawAddress: {
      type: "string",
      description: "Address to withdraw tokens to. Default: user's EOA address",
      required: false,
    },
  },

  validate: async (runtime: IAgentRuntime, message: Memory, state?: State) => {
    return validateBiconomyService(runtime, "BICONOMY_WITHDRAW", state, message);
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    options?: { [key: string]: unknown },
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    logger.info("[BICONOMY_WITHDRAW] Handler invoked");

    try {
      // Get services
      const biconomyService = runtime.getService<BiconomyService>(BiconomyService.serviceType);
      if (!biconomyService) {
        callback?.({ text: "❌ Biconomy service not initialized" });
        return { text: "❌ Biconomy service not initialized", success: false, error: "service_unavailable" };
      }

      const cdpService = runtime.getService?.("CDP_SERVICE") as unknown as CdpService;
      if (!cdpService) {
        callback?.({ text: "❌ CDP service not available" });
        return { text: "❌ CDP service not available", success: false, error: "service_unavailable" };
      }

      // Extract parameters
      const composedState = await runtime.composeState(message, ["ACTION_STATE"], true);
      const params = composedState?.data?.actionParams || {};

      const chainName = (params?.chain?.toLowerCase().trim() || "base") as string;
      const tokenParam = params?.token?.toLowerCase().trim() as string;
      const fundingTokenParam = (params?.fundingToken?.toLowerCase().trim() || "usdc") as string;
      const fundingAmount = (params?.fundingAmount?.trim() || "2") as string;
      const withdrawAddressParam = params?.withdrawAddress?.trim() as string | undefined;

      // Validate required params
      if (!tokenParam) {
        callback?.({ text: "❌ Missing required parameter: token (e.g., 'usdc', '0x...')" });
        return { text: "❌ Missing required parameter: token", success: false, error: "invalid_params" };
      }

      // Resolve chain ID
      const chainId = biconomyService.resolveChainId(chainName);
      if (!chainId) {
        callback?.({ text: `❌ Unsupported chain: ${chainName}` });
        return { text: `❌ Unsupported chain: ${chainName}`, success: false, error: "unsupported_chain" };
      }

      logger.info(`[BICONOMY_WITHDRAW] chain=${chainName} (${chainId}), token=${tokenParam}`);

      // Get user wallet for signing
      const wallet = await getEntityWallet(runtime as any, message, "BICONOMY_WITHDRAW", callback);
      if (wallet.success === false) {
        return wallet.result;
      }

      const accountName = wallet.metadata?.accountName as string;
      if (!accountName) {
        callback?.({ text: "❌ Could not resolve user wallet" });
        return { text: "❌ Could not resolve user wallet", success: false, error: "missing_wallet" };
      }

      // Get CDP client for signing
      const cdpNetwork = resolveCdpNetworkFromChainId(chainId);
      const viemClient = await cdpService.getViemClientsForAccount({
        accountName,
        network: cdpNetwork,
      });

      const userAddress = viemClient.address as `0x${string}`;
      const cdpAccount = viemClient.cdpAccount;
      const walletClient = viemClient.walletClient;
      const publicClient = viemClient.publicClient;

      // Determine withdraw address (default to user's EOA)
      const withdrawAddress = (withdrawAddressParam || userAddress) as `0x${string}`;

      // Resolve token addresses
      const tokenAddress = await resolveTokenToAddress(tokenParam, chainName);
      if (!tokenAddress) {
        callback?.({ text: `❌ Cannot resolve token: ${tokenParam} on ${chainName}` });
        return { text: `❌ Cannot resolve token: ${tokenParam} on ${chainName}`, success: false, error: "token_resolution_failed" };
      }

      const fundingTokenAddress = await resolveTokenToAddress(fundingTokenParam, chainName);
      if (!fundingTokenAddress) {
        callback?.({ text: `❌ Cannot resolve funding token: ${fundingTokenParam} on ${chainName}` });
        return { text: `❌ Cannot resolve funding token: ${fundingTokenParam}`, success: false, error: "token_resolution_failed" };
      }

      callback?.({ text: `🔄 Creating withdrawal instruction for ${tokenParam.toUpperCase()} on ${chainName}...` });

      // Build withdrawal instruction using runtimeErc20Balance
      const withdrawalFlow = biconomyService.buildWithdrawalInstruction(
        tokenAddress,
        chainId,
        withdrawAddress
      );

      // Get funding token decimals and amount
      const fundingDecimals = await getTokenDecimals(fundingTokenAddress, chainName);
      const fundingAmountWei = parseUnits(fundingAmount, fundingDecimals);

      // Build quote request with funding token from EOA
      const quoteRequest: QuoteRequest = {
        mode: "eoa",
        ownerAddress: userAddress,
        composeFlows: [withdrawalFlow],
        fundingTokens: [
          {
            tokenAddress: fundingTokenAddress,
            chainId: chainId,
            amount: fundingAmountWei.toString(),
          },
        ],
        feeToken: {
          address: fundingTokenAddress,
          chainId: chainId,
        },
      };

      callback?.({ text: `🔄 Getting quote (funding: ${fundingAmount} ${fundingTokenParam.toUpperCase()} from EOA)...` });

      // Execute
      const result = await biconomyService.executeIntent(
        quoteRequest,
        cdpAccount,
        walletClient,
        { address: userAddress },
        publicClient,
        (status) => callback?.({ text: status })
      );

      if (result.success && result.supertxHash) {
        const explorerUrl = biconomyService.getExplorerUrl(result.supertxHash);
        const chainName = biconomyService.getChainName(chainId);

        const responseText = `
✅ **Withdrawal Executed**

**Chain:** ${chainName} (${chainId})
**Token:** ${tokenParam.toUpperCase()} (\`${tokenAddress}\`)
**To:** \`${withdrawAddress}\`

**Supertx Hash:** \`${result.supertxHash}\`
**Track:** [MEE Explorer](${explorerUrl})
        `.trim();

        callback?.({ text: responseText, actions: ["BICONOMY_WITHDRAW"], source: message.content.source });
        return { 
          text: responseText, 
          success: true, 
          data: { 
            supertxHash: result.supertxHash, 
            explorerUrl,
            chainId,
            tokenAddress,
            withdrawAddress,
          } 
        };
      } else {
        const errorMsg = result.error || "Unknown error";
        callback?.({ text: `❌ Execution failed: ${errorMsg}` });
        return { text: `❌ Execution failed: ${errorMsg}`, success: false, error: "execution_failed" };
      }
    } catch (error) {
      const err = error as Error;
      logger.error(`[BICONOMY_WITHDRAW] Error: ${err.message}`);
      callback?.({ text: `❌ Error: ${err.message}` });
      return { text: `❌ Error: ${err.message}`, success: false, error: "handler_error" };
    }
  },

  examples: [
    [
      {
        name: "{{user}}",
        content: { text: "Withdraw USDC from Biconomy on Base to my wallet" },
      },
      {
        name: "{{agent}}",
        content: { text: "Withdrawing USDC from Nexus Smart Account...", action: "BICONOMY_WITHDRAW" },
      },
    ],
  ],
};

export default biconomyWithdrawAllAction;
