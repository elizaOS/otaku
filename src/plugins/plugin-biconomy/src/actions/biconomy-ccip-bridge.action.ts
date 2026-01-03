import {
  type Action,
  type IAgentRuntime,
  logger,
  type Memory,
  type State,
  type HandlerCallback,
  type ActionResult,
} from "@elizaos/core";
import { formatUnits, parseUnits } from "viem";
import { BiconomyService } from "../services/biconomy.service";
import { CdpService } from "../../../plugin-cdp/services/cdp.service";
import { type QuoteRequest } from "../types";
import { tryGetBaseUsdcFeeToken } from "../utils/fee-token";
import {
  DEFAULT_SLIPPAGE,
  validateSlippage,
  slippageToDecimal,
} from "../utils/slippage";
import { CdpNetwork } from "../../../plugin-cdp/types";
import { getEntityWallet } from "../../../../utils/entity";
import {
  resolveTokenToAddress,
  getTokenDecimals,
} from "../../../plugin-relay/src/utils/token-resolver";
import { validateBiconomyService } from "../utils/actionHelpers";

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
 * MEE CCIP Bridge Action
 *
 * Bridges tokens across different blockchain networks using Chainlink's 
 * Cross-Chain Interoperability Protocol (CCIP) via Biconomy MEE.
 * 
 * IMPORTANT LIMITATIONS:
 * - Only supports tokens that are CCIP-compatible on the specific lane
 * - Common CCIP tokens: USDC, LINK, WETH, WBTC, DAI
 * - Not all tokens are supported on all chain pairs
 * - Check CCIP supported tokens: https://docs.chain.link/ccip/supported-networks
 * 
 * CCIP provides secure, reliable cross-chain token transfers with:
 * - Direct chain-to-chain bridging (no intermediate swaps)
 * - 15-22 minute finality time
 * - Native token fee payment on source chain
 * - Can be combined with swaps and other operations
 */
export const meeCcipBridgeAction: Action = {
  name: "MEE_CCIP_BRIDGE",
  description: `Bridge tokens across chains using Chainlink CCIP via Biconomy MEE. Use this for:
- Direct token bridging between chains (e.g., "Bridge 100 USDC from Base to Optimism")
- Cross-chain token transfers without swapping
- Secure cross-chain transfers via Chainlink CCIP

⏱️ **WAIT TIME**: 15-22 minutes for bridge finality (much slower than MEE_FUSION_SWAP)

**IMPORTANT**: Only supports CCIP-compatible tokens (USDC, LINK, WETH, WBTC, DAI, etc.).
Not all tokens are supported on all chain pairs. For unsupported tokens, use MEE_FUSION_SWAP instead.

CCIP fees are paid in the native token of the source chain (ETH, POL, etc.).`,
  similes: [
    "CCIP_BRIDGE",
    "CHAINLINK_BRIDGE",
    "MEE_BRIDGE",
    "BICONOMY_BRIDGE",
    "CROSS_CHAIN_BRIDGE",
  ],

  parameters: {
    token: {
      type: "string",
      description:
        "Token symbol or address to bridge (e.g., 'usdc', 'link', 'weth', 'wbtc', 'dai'). Must be CCIP-supported on both source and destination chains. Common CCIP tokens: USDC, LINK, WETH, WBTC, DAI.",
      required: true,
    },
    srcChain: {
      type: "string",
      description:
        "Source chain name (ethereum, base, arbitrum, polygon, optimism, bsc)",
      required: true,
    },
    dstChain: {
      type: "string",
      description:
        "Destination chain name (ethereum, base, arbitrum, polygon, optimism, bsc)",
      required: true,
    },
    amount: {
      type: "string",
      description:
        "Amount to bridge in human-readable format (e.g., '100' for 100 USDC, not in wei)",
      required: true,
    },
  },

  validate: async (runtime: IAgentRuntime, message: Memory, state?: State) => {
    return validateBiconomyService(runtime, "MEE_CCIP_BRIDGE", state, message);
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    options?: { [key: string]: unknown },
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    logger.info("[MEE_CCIP_BRIDGE] Handler invoked");

    try {
      // Get services
      const biconomyService = runtime.getService<BiconomyService>(
        BiconomyService.serviceType
      );
      if (!biconomyService) {
        const errorMsg = "MEE service not initialized";
        logger.error(`[MEE_CCIP_BRIDGE] ${errorMsg}`);
        callback?.({ text: `❌ ${errorMsg}` });
        return {
          text: `❌ ${errorMsg}`,
          success: false,
          error: "service_unavailable",
        };
      }

      const cdpService = runtime.getService?.("CDP_SERVICE") as unknown as CdpService;
      if (
        !cdpService ||
        typeof cdpService.getViemClientsForAccount !== "function"
      ) {
        const errorMsg = "CDP service not available";
        logger.error(`[MEE_CCIP_BRIDGE] ${errorMsg}`);
        callback?.({ text: `❌ ${errorMsg}` });
        return {
          text: `❌ ${errorMsg}`,
          success: false,
          error: "service_unavailable",
        };
      }

      // Extract parameters from state
      const composedState = await runtime.composeState(
        message,
        ["ACTION_STATE"],
        true
      );
      const params = composedState?.data?.actionParams || {};

      // Validate required parameters
      const token = params?.token?.toLowerCase().trim();
      const srcChain = params?.srcChain?.toLowerCase().trim();
      const dstChain = params?.dstChain?.toLowerCase().trim();
      const amount = params?.amount?.trim();

      // Input parameters object for response
      const inputParams = {
        token,
        srcChain,
        dstChain,
        amount,
      };

      // Validation
      if (!token) {
        const errorMsg =
          "Missing required parameter 'token'. Please specify the token to bridge (e.g., 'usdc', 'link').";
        logger.error(`[MEE_CCIP_BRIDGE] ${errorMsg}`);
        callback?.({ text: `❌ ${errorMsg}` });
        return {
          text: `❌ ${errorMsg}`,
          success: false,
          error: "missing_required_parameter",
          input: inputParams,
        } as ActionResult;
      }

      if (!srcChain) {
        const errorMsg =
          "Missing required parameter 'srcChain'. Please specify the source chain (e.g., 'base', 'ethereum').";
        logger.error(`[MEE_CCIP_BRIDGE] ${errorMsg}`);
        callback?.({ text: `❌ ${errorMsg}` });
        return {
          text: `❌ ${errorMsg}`,
          success: false,
          error: "missing_required_parameter",
          input: inputParams,
        } as ActionResult;
      }

      if (!dstChain) {
        const errorMsg =
          "Missing required parameter 'dstChain'. Please specify the destination chain (e.g., 'arbitrum', 'optimism').";
        logger.error(`[MEE_CCIP_BRIDGE] ${errorMsg}`);
        callback?.({ text: `❌ ${errorMsg}` });
        return {
          text: `❌ ${errorMsg}`,
          success: false,
          error: "missing_required_parameter",
          input: inputParams,
        } as ActionResult;
      }

      if (!amount) {
        const errorMsg =
          "Missing required parameter 'amount'. Please specify the amount to bridge (e.g., '100').";
        logger.error(`[MEE_CCIP_BRIDGE] ${errorMsg}`);
        callback?.({ text: `❌ ${errorMsg}` });
        return {
          text: `❌ ${errorMsg}`,
          success: false,
          error: "missing_required_parameter",
          input: inputParams,
        } as ActionResult;
      }

      const amountFloat = Number(amount);
      if (!Number.isFinite(amountFloat) || amountFloat <= 0) {
        const errorMsg = "Amount must be a positive number (e.g., '100').";
        logger.error(`[MEE_CCIP_BRIDGE] ${errorMsg}`);
        callback?.({ text: `❌ ${errorMsg}` });
        return {
          text: `❌ ${errorMsg}`,
          success: false,
          error: "invalid_amount",
          input: inputParams,
        } as ActionResult;
      }

      // Resolve chain IDs
      const srcChainId = biconomyService.resolveChainId(srcChain);
      const dstChainId = biconomyService.resolveChainId(dstChain);

      if (!srcChainId) {
        const errorMsg = `Unsupported source chain: ${srcChain}. Supported: ethereum, base, arbitrum, polygon, optimism, bsc, scroll, gnosis, linea`;
        logger.error(`[MEE_CCIP_BRIDGE] ${errorMsg}`);
        callback?.({ text: `❌ ${errorMsg}` });
        return {
          text: `❌ ${errorMsg}`,
          success: false,
          error: "unsupported_chain",
          input: inputParams,
        } as ActionResult;
      }

      if (!dstChainId) {
        const errorMsg = `Unsupported destination chain: ${dstChain}. Supported: ethereum, base, arbitrum, polygon, optimism, bsc, scroll, gnosis, linea`;
        logger.error(`[MEE_CCIP_BRIDGE] ${errorMsg}`);
        callback?.({ text: `❌ ${errorMsg}` });
        return {
          text: `❌ ${errorMsg}`,
          success: false,
          error: "unsupported_chain",
          input: inputParams,
        } as ActionResult;
      }

      if (srcChainId === dstChainId) {
        const errorMsg = `Source and destination chains cannot be the same. Please specify different chains.`;
        logger.error(`[MEE_CCIP_BRIDGE] ${errorMsg}`);
        callback?.({ text: `❌ ${errorMsg}` });
        return {
          text: `❌ ${errorMsg}`,
          success: false,
          error: "invalid_chains",
          input: inputParams,
        } as ActionResult;
      }

      // Get user wallet
      const wallet = await getEntityWallet(
        runtime as any,
        message,
        "MEE_CCIP_BRIDGE",
        callback
      );
      if (wallet.success === false) {
        logger.warn("[MEE_CCIP_BRIDGE] Entity wallet verification failed");
        return { ...wallet.result, input: inputParams } as ActionResult & { input: typeof inputParams };
      }

      const accountName = wallet.metadata?.accountName as string;
      if (!accountName) {
        const errorMsg = "Could not resolve user wallet";
        callback?.({ text: `❌ ${errorMsg}` });
        return {
          text: `❌ ${errorMsg}`,
          success: false,
          error: "missing_wallet",
          input: inputParams,
        } as ActionResult;
      }

      // Get viem clients and CDP account
      const cdpNetwork = resolveCdpNetwork(srcChain);
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
      const srcTokenAddress = await resolveTokenToAddress(token, srcChain);
      if (!srcTokenAddress) {
        const errorMsg = `Cannot resolve token: ${token} on ${srcChain}. Note: CCIP only supports specific tokens like USDC, LINK, WETH, WBTC, DAI.`;
        callback?.({ text: `❌ ${errorMsg}` });
        return {
          text: `❌ ${errorMsg}`,
          success: false,
          error: "token_resolution_failed",
          input: inputParams,
        } as ActionResult;
      }

      const dstTokenAddress = await resolveTokenToAddress(token, dstChain);
      if (!dstTokenAddress) {
        const errorMsg = `Cannot resolve token: ${token} on ${dstChain}. Note: CCIP only supports specific tokens like USDC, LINK, WETH, WBTC, DAI.`;
        callback?.({ text: `❌ ${errorMsg}` });
        return {
          text: `❌ ${errorMsg}`,
          success: false,
          error: "token_resolution_failed",
          input: inputParams,
        } as ActionResult;
      }

      // Get token decimals from CoinGecko
      const decimals = await getTokenDecimals(srcTokenAddress, srcChain);

      const amountInWei = parseUnits(amount, decimals);

      const onChainBalance = await cdpService.getOnChainBalance({
        accountName,
        network: cdpNetwork,
        tokenAddress: srcTokenAddress as `0x${string}`,
        walletAddress: userAddress,
      });

      if (onChainBalance <= 0n) {
        const errorMsg = `No ${token.toUpperCase()} balance available on ${srcChain}`;
        callback?.({ text: `❌ ${errorMsg}` });
        return {
          text: `❌ ${errorMsg}`,
          success: false,
          error: "insufficient_balance",
          input: inputParams,
        } as ActionResult;
      }

      let bridgeAmountInWei = amountInWei;
      if (amountInWei > onChainBalance) {
        bridgeAmountInWei = onChainBalance;
        const balanceHuman = formatUnits(onChainBalance, decimals);
        callback?.({
          text: `🧮 Input exceeds on-chain balance; using ${balanceHuman} ${token.toUpperCase()} available on ${srcChain}`,
        });
      }

      // Build CCIP bridge flow
      const ccipFlow = biconomyService.buildCcipBridgeFlow(
        srcChainId,
        dstChainId,
        srcTokenAddress,
        dstTokenAddress,
        bridgeAmountInWei.toString()
      );

      // Build withdrawal instruction to transfer bridged tokens back to EOA on destination chain
      // Without this, tokens remain in the Biconomy Nexus/Smart Account
      // Note: CCIP bridging takes 15-22 minutes, so we extend the time window
      const extendedUpperBoundTimestamp = Math.floor(Date.now() / 1000) + 22 * 60; // 22 minutes
      const withdrawalFlow = biconomyService.buildWithdrawalInstruction(
        dstTokenAddress,
        dstChainId,
        userAddress,
        extendedUpperBoundTimestamp
      );

      // Build quote request - use classic EOA mode with funding token provided
      const feeToken = preferredFeeTokenResult?.feeToken ?? {
        address: srcTokenAddress,
        chainId: srcChainId,
      };

      const quoteRequest: QuoteRequest = {
        mode: "eoa",
        ownerAddress: userAddress,
        composeFlows: [ccipFlow, withdrawalFlow],
        fundingTokens: [
          {
            tokenAddress: srcTokenAddress,
            chainId: srcChainId,
            amount: bridgeAmountInWei.toString(),
          },
        ],
        upperBoundTimestamp: extendedUpperBoundTimestamp, // Extended time window for CCIP finality
      };

      callback?.({ text: `🌉 Getting CCIP bridge quote from MEE...` });

      // Execute the bridge using CDP account for native EIP-712 signing
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

        const responseText = `
✅ **CCIP Bridge Executed**

**Token:** ${token.toUpperCase()}
**From:** ${srcChain} → **To:** ${dstChain}
**Amount:** ${amount} ${token.toUpperCase()}
**CCIP Fees:** Paid in native token on ${srcChain}

⏱️ **Bridge finality:** 15-22 minutes

**Note:** If this fails, the token may not be CCIP-supported on this chain pair. Try MEE_FUSION_SWAP instead.

**Supertx Hash:** \`${result.supertxHash}\`
**Track:** [MEE Explorer](${explorerUrl})
        `.trim();

        callback?.({
          text: responseText,
          actions: ["MEE_CCIP_BRIDGE"],
          source: message.content.source,
        });

        return {
          text: responseText,
          success: true,
          data: {
            supertxHash: result.supertxHash,
            explorerUrl,
            srcChain,
            dstChain,
            token,
            amount,
          },
          values: {
            bridgeSuccess: true,
            supertxHash: result.supertxHash,
          },
          input: inputParams,
        } as ActionResult & { input: typeof inputParams };
      } else {
        const errorMsg = result.error || "Unknown execution error";
        callback?.({ text: `❌ Execution failed: ${errorMsg}` });
        return {
          text: `❌ Execution failed: ${errorMsg}`,
          success: false,
          error: "execution_failed",
          input: inputParams,
        } as ActionResult & { input: typeof inputParams };
      }
    } catch (error) {
      const err = error as Error;
      logger.error(`[MEE_CCIP_BRIDGE] Handler error: ${err.message}`);

      // Try to capture input params even in failure
      let failureInputParams = {};
      try {
        const composedState = await runtime.composeState(
          message,
          ["ACTION_STATE"],
          true
        );
        const params = composedState?.data?.actionParams || {};
        failureInputParams = {
          token: params?.token,
          srcChain: params?.srcChain,
          dstChain: params?.dstChain,
          amount: params?.amount,
        };
      } catch (e) {
        // If we can't get params, just use empty object
      }

      callback?.({ text: `❌ Error: ${err.message}` });
      return {
        text: `❌ Error: ${err.message}`,
        success: false,
        error: "handler_error",
        input: failureInputParams,
      } as ActionResult;
    }
  },

  examples: [
    [
      {
        name: "{{user}}",
        content: {
          text: "Bridge 100 USDC from Base to Optimism",
        },
      },
      {
        name: "{{agent}}",
        content: {
          text: "I'll bridge 100 USDC from Base to Optimism using Chainlink CCIP...",
          action: "MEE_CCIP_BRIDGE",
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: {
          text: "Send 50 LINK from Ethereum to Polygon via CCIP",
        },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Executing CCIP bridge to transfer 50 LINK from Ethereum to Polygon...",
          action: "MEE_CCIP_BRIDGE",
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: {
          text: "Bridge 200 USDT from Arbitrum to Base",
        },
      },
      {
        name: "{{agent}}",
        content: {
          text: "I'll bridge 200 USDT from Arbitrum to Base using CCIP...",
          action: "MEE_CCIP_BRIDGE",
        },
      },
    ],
  ],
};

export default meeCcipBridgeAction;
