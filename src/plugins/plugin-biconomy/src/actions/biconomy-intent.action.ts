import {
  type Action,
  type ActionResult,
  type HandlerCallback,
  type IAgentRuntime,
  logger,
  type Memory,
  type State,
} from "@elizaos/core";
import { formatUnits, parseUnits } from "viem";
import { getEntityWallet } from "../../../../utils/entity";
import { CdpService } from "../../../plugin-cdp/services/cdp.service";
import { CdpNetwork } from "../../../plugin-cdp/types";
import {
  getTokenDecimals,
  resolveTokenToAddress,
} from "../../../plugin-relay/src/utils/token-resolver";
import { BiconomyService } from "../services/biconomy.service";
import { type QuoteRequest } from "../types";
import { tryGetBaseUsdcFeeToken } from "../utils/fee-token";

// CDP network mapping
const CDP_NETWORK_MAP: Record<string, CdpNetwork> = {
  ethereum: "ethereum",
  base: "base",
  optimism: "optimism",
  arbitrum: "arbitrum",
  polygon: "polygon",
  "base-sepolia": "base-sepolia",
};

const resolveCdpNetwork = (chainName: string): CdpNetwork => {
  const network = CDP_NETWORK_MAP[chainName.toLowerCase().trim()];
  if (!network) {
    throw new Error(`CDP wallet does not support signing transactions on ${chainName}`);
  }
  return network;
};

/**
 * MEE Supertransaction Rebalance Action
 * 
 * Enables gasless portfolio rebalancing and multi-output operations using Biconomy's
 * MEE (Modular Execution Environment). Supports:
 * - Single token to multiple target tokens (portfolio split)
 * - Cross-chain distribution with weight-based allocation
 * - Gas paid from input token - no native gas required
 */
export const meeSupertransactionRebalanceAction: Action = {
  name: "MEE_SUPERTRANSACTION_REBALANCE",
  description: `Execute gasless multi-chain portfolio rebalancing via Biconomy MEE Supertransaction. Use this for:
- Splitting one token into multiple tokens across chains (e.g., "Split 1000 USDC into 60% WETH on Base and 40% USDT on Optimism")
- Cross-chain portfolio distribution with weight-based allocation
- Gasless rebalancing - gas is paid from the input token, no native gas needed
Supports: Ethereum, Base, Arbitrum, Polygon, Optimism, BSC, Scroll, Gnosis, and more.`,
  similes: [
    "MEE_REBALANCE",
    "SUPERTRANSACTION_REBALANCE",
    "PORTFOLIO_REBALANCE",
    "SPLIT_TOKENS",
    "MULTI_CHAIN_REBALANCE",
    "GASLESS_REBALANCE",
  ],

  parameters: {
    inputToken: {
      type: "string",
      description: "Input token symbol or address (e.g., 'usdc', 'eth', '0x...')",
      required: true,
    },
    inputChain: {
      type: "string",
      description: "Input chain name (ethereum, base, arbitrum, polygon, optimism, bsc)",
      required: true,
    },
    inputAmount: {
      type: "string",
      description: "Amount to use in human-readable format (e.g., '1000' for 1000 USDC)",
      required: true,
    },
    targetTokens: {
      type: "string",
      description: "Target token symbols or addresses, comma-separated (e.g., 'weth,usdt')",
      required: true,
    },
    targetChains: {
      type: "string",
      description: "Target chain names, comma-separated, matching targetTokens order (e.g., 'base,optimism')",
      required: true,
    },
    targetWeights: {
      type: "string",
      description: "Target weights as decimals summing to 1.0, comma-separated (e.g., '0.6,0.4' for 60%/40%)",
      required: true,
    },
    slippage: {
      type: "number",
      description: "Slippage tolerance as percentage (e.g., 1 for 1%, 5 for 5%). Default: 1. Max: 5% unless confirmed.",
      required: false,
    },
    confirmHighSlippage: {
      type: "boolean",
      description: "Set to true to confirm slippage above 5%. Required if slippage > 5.",
      required: false,
    },
  },

  validate: async (runtime: IAgentRuntime, message: Memory, state?: State) => {
    try {
      const biconomyService = runtime.getService(BiconomyService.serviceType) as BiconomyService;
      if (!biconomyService) {
        logger.warn("[MEE_SUPERTX_REBALANCE] MEE service not available");
        return false;
      }
      return true;
    } catch (error) {
      logger.error("[MEE_SUPERTX_REBALANCE] Validation error:", (error as Error).message);
      return false;
    }
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    options?: { [key: string]: unknown },
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    logger.info("[MEE_SUPERTX_REBALANCE] Handler invoked");

    try {
      // Get services
      const biconomyService = runtime.getService<BiconomyService>(BiconomyService.serviceType);
      if (!biconomyService) {
        const errorMsg = "MEE service not initialized";
        logger.error(`[MEE_SUPERTX_REBALANCE] ${errorMsg}`);
        callback?.({ text: `❌ ${errorMsg}` });
        return { text: `❌ ${errorMsg}`, success: false, error: "service_unavailable" };
      }

      const cdpService = runtime.getService?.("CDP_SERVICE") as unknown as CdpService;
      if (!cdpService || typeof cdpService.getViemClientsForAccount !== "function") {
        const errorMsg = "CDP service not available";
        logger.error(`[MEE_SUPERTX_REBALANCE] ${errorMsg}`);
        callback?.({ text: `❌ ${errorMsg}` });
        return { text: `❌ ${errorMsg}`, success: false, error: "service_unavailable" };
      }

      // Extract parameters from state
      const composedState = await runtime.composeState(message, ["ACTION_STATE"], true);
      const params = composedState?.data?.actionParams || {};

      // Validate required parameters
      const inputToken = params?.inputToken?.toLowerCase().trim();
      const inputChain = params?.inputChain?.toLowerCase().trim();
      const inputAmount = params?.inputAmount?.trim();
      const targetTokens = params?.targetTokens?.toLowerCase().trim();
      const targetChains = params?.targetChains?.toLowerCase().trim();
      const targetWeights = params?.targetWeights?.trim();
      const slippage = params?.slippage ?? 1; // percentage (1 = 1%)
      const confirmHighSlippage = params?.confirmHighSlippage ?? false;

      // Input parameters object for response
      const inputParams = {
        inputToken,
        inputChain,
        inputAmount,
        targetTokens,
        targetChains,
        targetWeights,
        slippage,
        confirmHighSlippage,
      };

      // Validate slippage - max 5% unless explicitly confirmed
      if (slippage > 5 && !confirmHighSlippage) {
        const errorMsg = `⚠️ Slippage of ${slippage}% is above the recommended maximum of 5%. This could result in significant value loss. To proceed, please confirm you're okay with high slippage.`;
        logger.warn(`[MEE_SUPERTX_REBALANCE] High slippage rejected: ${slippage}%`);
        callback?.({ text: errorMsg });
        return {
          text: errorMsg,
          success: false,
          error: "high_slippage_not_confirmed",
          input: inputParams,
        } as ActionResult;
      }

      if (slippage > 5 && confirmHighSlippage) {
        callback?.({ text: `⚠️ Proceeding with high slippage of ${slippage}% as confirmed.` });
      }

      // Validation
      if (!inputToken || !inputChain || !inputAmount) {
        const errorMsg = "Missing required input parameters (inputToken, inputChain, inputAmount)";
        callback?.({ text: `❌ ${errorMsg}` });
        return { text: `❌ ${errorMsg}`, success: false, error: "missing_parameters", input: inputParams } as ActionResult & { input: typeof inputParams };
      }

      const inputAmountFloat = Number(inputAmount);
      if (!Number.isFinite(inputAmountFloat) || inputAmountFloat <= 0) {
        const errorMsg = "inputAmount must be a positive number (e.g., '1000').";
        callback?.({ text: `❌ ${errorMsg}` });
        return {
          text: `❌ ${errorMsg}`,
          success: false,
          error: "invalid_amount",
          input: inputParams,
        } as ActionResult & { input: typeof inputParams };
      }

      if (!targetTokens || !targetChains || !targetWeights) {
        const errorMsg = "Missing required target parameters (targetTokens, targetChains, targetWeights)";
        callback?.({ text: `❌ ${errorMsg}` });
        return { text: `❌ ${errorMsg}`, success: false, error: "missing_parameters", input: inputParams } as ActionResult & { input: typeof inputParams };
      }

      // Parse target arrays
      const tokens = targetTokens.split(",").map((t: string) => t.trim());
      const chains = targetChains.split(",").map((c: string) => c.trim());
      const weights = targetWeights.split(",").map((w: string) => parseFloat(w.trim()));

      if (tokens.length !== chains.length || tokens.length !== weights.length) {
        const errorMsg = "Target arrays must have the same length (tokens, chains, weights)";
        callback?.({ text: `❌ ${errorMsg}` });
        return { text: `❌ ${errorMsg}`, success: false, error: "invalid_parameters", input: inputParams } as ActionResult & { input: typeof inputParams };
      }

      // Validate weights sum to 1.0
      const weightSum = weights.reduce((sum: number, w: number) => sum + w, 0);
      if (Math.abs(weightSum - 1.0) > 0.001) {
        const errorMsg = `Target weights must sum to 1.0 (got ${weightSum.toFixed(3)})`;
        callback?.({ text: `❌ ${errorMsg}` });
        return { text: `❌ ${errorMsg}`, success: false, error: "invalid_weights", input: inputParams } as ActionResult & { input: typeof inputParams };
      }

      // Resolve chain IDs
      const inputChainId = biconomyService.resolveChainId(inputChain);
      if (!inputChainId) {
        const errorMsg = `Unsupported input chain: ${inputChain}`;
        callback?.({ text: `❌ ${errorMsg}` });
        return { text: `❌ ${errorMsg}`, success: false, error: "unsupported_chain", input: inputParams } as ActionResult & { input: typeof inputParams };
      }

      const targetChainIds = chains.map((c: string) => biconomyService.resolveChainId(c));
      for (let i = 0; i < targetChainIds.length; i++) {
        if (!targetChainIds[i]) {
          const errorMsg = `Unsupported target chain: ${chains[i]}`;
          callback?.({ text: `❌ ${errorMsg}` });
          return { text: `❌ ${errorMsg}`, success: false, error: "unsupported_chain", input: inputParams } as ActionResult & { input: typeof inputParams };
        }
      }

      // Get user wallet
      const wallet = await getEntityWallet(runtime as any, message, "MEE_SUPERTX_REBALANCE", callback);
      if (wallet.success === false) {
        logger.warn("[MEE_SUPERTX_REBALANCE] Entity wallet verification failed");
        return { ...wallet.result, input: inputParams } as ActionResult & { input: typeof inputParams };
      }

      const accountName = wallet.metadata?.accountName as string;
      if (!accountName) {
        const errorMsg = "Could not resolve user wallet";
        callback?.({ text: `❌ ${errorMsg}` });
        return { text: `❌ ${errorMsg}`, success: false, error: "missing_wallet", input: inputParams } as ActionResult & { input: typeof inputParams };
      }

      // Get viem clients and CDP account
      const cdpNetwork = resolveCdpNetwork(inputChain);
      const viemClient = await cdpService.getViemClientsForAccount({
        accountName,
        network: cdpNetwork,
      });

      const userAddress = viemClient.address as `0x${string}`;
      const cdpAccount = viemClient.cdpAccount; // Use CDP account for native EIP-712 signing
      const walletClient = viemClient.walletClient;
      const publicClient = viemClient.publicClient;

      const preferredFeeTokenResult = await tryGetBaseUsdcFeeToken(cdpService, accountName);
      if (preferredFeeTokenResult?.usedBaseUsdc) {
        callback?.({ text: "🪙 Using Base USDC to pay Biconomy orchestration fees" });
      }

      // Resolve token addresses using CoinGecko (same as CDP/Relay)
      const inputTokenAddress = await resolveTokenToAddress(inputToken, inputChain);
      if (!inputTokenAddress) {
        const errorMsg = `Cannot resolve input token: ${inputToken} on ${inputChain}`;
        callback?.({ text: `❌ ${errorMsg}` });
        return { text: `❌ ${errorMsg}`, success: false, error: "token_resolution_failed", input: inputParams } as ActionResult & { input: typeof inputParams };
      }

      const targetTokenAddresses: string[] = [];
      for (let i = 0; i < tokens.length; i++) {
        const address = await resolveTokenToAddress(tokens[i], chains[i]);
        if (!address) {
          const errorMsg = `Cannot resolve target token: ${tokens[i]} on ${chains[i]}`;
          callback?.({ text: `❌ ${errorMsg}` });
          return { text: `❌ ${errorMsg}`, success: false, error: "token_resolution_failed", input: inputParams } as ActionResult & { input: typeof inputParams };
        }
        targetTokenAddresses.push(address);
      }

      // Get token decimals from CoinGecko
      const decimals = await getTokenDecimals(inputTokenAddress, inputChain);

      const amountInWei = parseUnits(inputAmount, decimals);

      const onChainBalance = await cdpService.getOnChainBalance({
        accountName,
        network: cdpNetwork,
        tokenAddress: inputTokenAddress as `0x${string}`,
        walletAddress: userAddress,
      });

      if (onChainBalance <= 0n) {
        const errorMsg = `No ${inputToken.toUpperCase()} balance available on ${inputChain}`;
        callback?.({ text: `❌ ${errorMsg}` });
        return {
          text: `❌ ${errorMsg}`,
          success: false,
          error: "insufficient_balance",
          input: inputParams,
        } as ActionResult & { input: typeof inputParams };
      }

      let effectiveAmountInWei = amountInWei;
      if (amountInWei > onChainBalance) {
        effectiveAmountInWei = onChainBalance;
        const balanceHuman = formatUnits(onChainBalance, decimals);
        callback?.({
          text: `🧮 Input exceeds on-chain balance; using ${balanceHuman} ${inputToken.toUpperCase()} available on ${inputChain}`,
        });
      }

      // Build compose flow for rebalancing (convert slippage from percentage to decimal)
      const rebalanceFlow = biconomyService.buildMultiIntentFlow(
        [{ chainId: inputChainId, tokenAddress: inputTokenAddress, amount: effectiveAmountInWei.toString() }],
        targetChainIds.map((chainId: number | undefined, i: number) => ({
          chainId: chainId!,
          tokenAddress: targetTokenAddresses[i],
          weight: weights[i],
        })),
        slippage / 100
      );

      // Build withdrawal instructions for each target token to transfer back to EOA
      // Without these, tokens remain in the Biconomy Nexus/Smart Account
      const withdrawalFlows = targetChainIds.map((chainId: number | undefined, i: number) =>
        biconomyService.buildWithdrawalInstruction(
          targetTokenAddresses[i],
          chainId!,
          userAddress
        )
      );

      // Build quote request - use classic EOA mode with funding token provided
      const feeToken = preferredFeeTokenResult?.feeToken ?? {
        address: inputTokenAddress,
        chainId: inputChainId,
      };

      const quoteRequest: QuoteRequest = {
        mode: "eoa",
        ownerAddress: userAddress,
        composeFlows: [rebalanceFlow, ...withdrawalFlows],
        fundingTokens: [
          {
            tokenAddress: inputTokenAddress,
            chainId: inputChainId,
            amount: effectiveAmountInWei.toString(),
          },
        ],
        // feeToken,
      };

      callback?.({ text: `🔄 Getting quote from MEE...` });

      // Execute the intent using CDP account for native EIP-712 signing
      // This bypasses the RPC and signs directly on Coinbase servers
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
        
        // Build target description
        const targetDesc = tokens.map((t: string, i: number) => 
          `${(weights[i] * 100).toFixed(0)}% ${t.toUpperCase()} on ${chains[i]}`
        ).join(", ");

        const gasTokenDescription = preferredFeeTokenResult?.usedBaseUsdc
          ? "Base USDC"
          : `${inputToken.toUpperCase()} on ${inputChain}`;

        const responseText = `
✅ **MEE Supertransaction Rebalance Executed**

**Input:** ${inputAmount} ${inputToken.toUpperCase()} on ${inputChain}
**Output:** ${targetDesc}
**Slippage:** ${slippage}%
**Gas:** Paid in ${gasTokenDescription}

**Supertx Hash:** \`${result.supertxHash}\`
**Track:** [MEE Explorer](${explorerUrl})
        `.trim();

        callback?.({
          text: responseText,
          actions: ["MEE_SUPERTRANSACTION_REBALANCE"],
          source: message.content.source,
        });

        return {
          text: responseText,
          success: true,
          data: {
            supertxHash: result.supertxHash,
            explorerUrl,
            input: inputParams,
          },
        };
      } else {
        const errorMsg = result.error || "Unknown execution error";
        callback?.({ text: `❌ Execution failed: ${errorMsg}` });
        return {
          text: `❌ Execution failed: ${errorMsg}`,
          success: false,
          error: "execution_failed",
          input: inputParams,
        } as ActionResult;
      }
    } catch (error) {
      const err = error as Error;
      logger.error(`[MEE_SUPERTX_REBALANCE] Handler error: ${err.message}`);
      callback?.({ text: `❌ Error: ${err.message}` });
      return {
        text: `❌ Error: ${err.message}`,
        success: false,
        error: "handler_error",
      };
    }
  },

  examples: [
    [
      {
        name: "{{user}}",
        content: {
          text: "Split 1000 USDC on Base into 60% WETH on Base and 40% USDT on Optimism",
        },
      },
      {
        name: "{{agent}}",
        content: {
          text: "I'll execute this gasless portfolio split via MEE Supertransaction...",
          action: "MEE_SUPERTRANSACTION_REBALANCE",
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: {
          text: "Rebalance my 0.5 ETH on Ethereum to 50% USDC on Base and 50% USDC on Arbitrum",
        },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Executing gasless multi-chain rebalance via MEE Supertransaction...",
          action: "MEE_SUPERTRANSACTION_REBALANCE",
        },
      },
    ],
  ],
};

export default meeSupertransactionRebalanceAction;

