import {
  type Action,
  type IAgentRuntime,
  logger,
  type Memory,
  type State,
  type HandlerCallback,
  type ActionResult,
} from "@elizaos/core";
import { 
  mainnet, 
  base, 
  arbitrum, 
  polygon, 
  optimism, 
  zora,
  blast,
  scroll,
  linea,
  type Chain
  } from "viem/chains";
import { parseUnits } from "viem";
import { RelayService } from "../services/relay.service"; 
import { CdpService } from "../../../plugin-cdp/services/cdp.service";
import { type BridgeRequest, type ResolvedBridgeRequest, type RelayStatus } from "../types";
import type { ProgressData } from "@relayprotocol/relay-sdk";
import { resolveTokenToAddress, getTokenDecimals } from "../utils/token-resolver";
import { CdpNetwork } from "../../../plugin-cdp/types";
import { getEntityWallet } from "../../../../utils/entity";

// Supported chains mapping
const SUPPORTED_CHAINS: Record<string, Chain> = {
  ethereum: mainnet,
  base: base,
  arbitrum: arbitrum,
  polygon: polygon,
  optimism: optimism,
  zora: zora,
  blast: blast,
  scroll: scroll,
  linea: linea,
};

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

const NATIVE_DECIMALS: Record<string, number> = {
  eth: 18,
  matic: 18,
  pol: 18,
};

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
 * Resolve chain name to chain ID using viem chains
 * Similar to how we resolve token symbols in CDP swap
 */
const resolveChainNameToId = (chainName: string): number | null => {
  const normalized = chainName.toLowerCase().trim();
  const chain = SUPPORTED_CHAINS[normalized];
  
  if (!chain) {
    console.error(`Chain not found: ${chainName}. Available chains: ${Object.keys(SUPPORTED_CHAINS).join(", ")}`);
    return null;
  }
  
  return chain.id;
};

export const relayBridgeAction: Action = {
  name: "EXECUTE_RELAY_BRIDGE",
  description: "Use this action when you need to execute a cross-chain bridge. Native gas tokens: ETH on Base/Ethereum/Arbitrum/Optimism, POL on Polygon. POL is never the native gas token on Base/Ethereum (POL ERC20 exists on Ethereum but is not a native gas token). Treat 'ETH' on Polygon as 'WETH'.",
  similes: [
    "BRIDGE_TOKENS",
    "CROSS_CHAIN_TRANSFER",
    "RELAY_BRIDGE",
    "SEND_CROSS_CHAIN",
    "TRANSFER_CROSS_CHAIN",
  ],

  // Parameter schema for tool calling
  parameters: {
    originChain: {
      type: "string",
      description: "Origin chain name (ethereum, base, arbitrum, polygon, optimism, zora, blast, scroll, or linea)",
      required: true,
    },
    destinationChain: {
      type: "string",
      description: "Destination chain name (ethereum, base, arbitrum, polygon, optimism, zora, blast, scroll, or linea)",
      required: true,
    },
    currency: {
      type: "string",
      description: "Token symbol to bridge (e.g., 'eth', 'usdc', 'usdt', 'weth'). On Polygon, the native gas token is POL ($POL, formerly MATIC). If 'ETH' is specified for Polygon, interpret it as 'WETH'.",
      required: true,
    },
    amount: {
      type: "string",
      description: "Amount to bridge in human-readable format (e.g., '0.5' for 0.5 ETH, not in wei)",
      required: true,
    },
    recipient: {
      type: "string",
      description: "Recipient address on destination chain (defaults to user's address if not specified)",
      required: false,
    },
    useExactInput: {
      type: "boolean",
      description: "Whether to use exact input amount (default: true)",
      required: false,
    },
    useExternalLiquidity: {
      type: "boolean",
      description: "Whether to use external liquidity (default: false)",
      required: false,
    },
    referrer: {
      type: "string",
      description: "Referrer address for the bridge (optional)",
      required: false,
    },
  },

  validate: async (runtime: IAgentRuntime, message: Memory, state?: State) => {
    try {
      // Check if services are available
      const relayService = runtime.getService(
        RelayService.serviceType,
      ) as RelayService;

      if (!relayService) {
        logger.warn("[EXECUTE_RELAY_BRIDGE] Relay service not available");
        return false;
      }

      return true;
    } catch (error) {
      logger.error(
        "[EXECUTE_RELAY_BRIDGE] Error validating action:",
        error instanceof Error ? error.message : String(error),
      );
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
      logger.info("[EXECUTE_RELAY_BRIDGE] Handler invoked");
      
      try {
        // Get Relay service
        const relayService = runtime.getService<RelayService>(RelayService.serviceType);

        if (!relayService) {
          const errorMsg = "Relay service not initialized";
          logger.error(`[EXECUTE_RELAY_BRIDGE] ${errorMsg}`);
          
          // Try to capture input params even in early failure
          let earlyFailureInput = {};
          try {
            const composedState = await runtime.composeState(message, ["ACTION_STATE"], true);
            const params = composedState?.data?.actionParams || {};
            earlyFailureInput = {
              originChain: params?.originChain,
              destinationChain: params?.destinationChain,
              currency: params?.currency,
              amount: params?.amount,
              recipient: params?.recipient,
              useExactInput: params?.useExactInput,
              useExternalLiquidity: params?.useExternalLiquidity,
              referrer: params?.referrer,
            };
          } catch (e) {
            // If we can't get params, just use empty object
          }
          
          const errorResult: ActionResult = {
            text: ` ${errorMsg}`,
            success: false,
            error: "service_unavailable",
            input: earlyFailureInput,
          } as ActionResult & { input: typeof earlyFailureInput };
          callback?.({ 
            text: errorResult.text,
            content: { error: "service_unavailable", details: errorMsg }
          });
          return errorResult;
        }

        // Read parameters from state (extracted by multiStepDecisionTemplate)
        const composedState = await runtime.composeState(message, ["ACTION_STATE"], true);
        const params = composedState?.data?.actionParams || {};

        // Validate required parameters
        const originChain = params?.originChain?.toLowerCase().trim();
        const destinationChain = params?.destinationChain?.toLowerCase().trim();
        const currency = params?.currency?.toLowerCase().trim();
        const amount = params?.amount?.trim();

        if (!originChain) {
          const errorMsg = "Missing required parameter 'originChain'. Please specify the origin chain (e.g., 'ethereum', 'base').";
          logger.error(`[EXECUTE_RELAY_BRIDGE] ${errorMsg}`);
          const errorResult: ActionResult = {
            text: ` ${errorMsg}`,
            success: false,
            error: "missing_required_parameter",
            input: params,
          } as ActionResult & { input: typeof params };
          callback?.({ 
            text: errorResult.text,
            content: { error: "missing_required_parameter", details: errorMsg }
          });
          return errorResult;
        }

        if (!destinationChain) {
          const errorMsg = "Missing required parameter 'destinationChain'. Please specify the destination chain (e.g., 'base', 'arbitrum').";
          logger.error(`[EXECUTE_RELAY_BRIDGE] ${errorMsg}`);
          const errorResult: ActionResult = {
            text: ` ${errorMsg}`,
            success: false,
            error: "missing_required_parameter",
            input: params,
          } as ActionResult & { input: typeof params };
          callback?.({ 
            text: errorResult.text,
            content: { error: "missing_required_parameter", details: errorMsg }
          });
          return errorResult;
        }

        if (!currency) {
          const errorMsg = "Missing required parameter 'currency'. Please specify the token to bridge (e.g., 'eth', 'usdc').";
          logger.error(`[EXECUTE_RELAY_BRIDGE] ${errorMsg}`);
          const errorResult: ActionResult = {
            text: ` ${errorMsg}`,
            success: false,
            error: "missing_required_parameter",
            input: params,
          } as ActionResult & { input: typeof params };
          callback?.({ 
            text: errorResult.text,
            content: { error: "missing_required_parameter", details: errorMsg }
          });
          return errorResult;
        }

        if (!amount) {
          const errorMsg = "Missing required parameter 'amount'. Please specify the amount to bridge (e.g., '0.5').";
          logger.error(`[EXECUTE_RELAY_BRIDGE] ${errorMsg}`);
          const errorResult: ActionResult = {
            text: ` ${errorMsg}`,
            success: false,
            error: "missing_required_parameter",
            input: params,
          } as ActionResult & { input: typeof params };
          callback?.({ 
            text: errorResult.text,
            content: { error: "missing_required_parameter", details: errorMsg }
          });
          return errorResult;
        }

        // Parse bridge parameters with defaults
        const bridgeParams: BridgeRequest = {
          originChain,
          destinationChain,
          currency,
          amount,
          recipient: params?.recipient?.trim(),
          useExactInput: params?.useExactInput !== false,
          useExternalLiquidity: params?.useExternalLiquidity === true,
          referrer: params?.referrer?.trim(),
        };

        // Store input parameters for return
        const inputParams = {
          originChain: bridgeParams.originChain,
          destinationChain: bridgeParams.destinationChain,
          currency: bridgeParams.currency,
          amount: bridgeParams.amount,
          recipient: bridgeParams.recipient,
          useExactInput: bridgeParams.useExactInput,
          useExternalLiquidity: bridgeParams.useExternalLiquidity,
          referrer: bridgeParams.referrer,
        };

        logger.info(`[EXECUTE_RELAY_BRIDGE] Bridge parameters: ${JSON.stringify(bridgeParams)}`);

        const cdp = runtime.getService?.("CDP_SERVICE") as CdpService;
        if (!cdp || typeof cdp.getViemClientsForAccount !== "function") {
          const errorMsg = "CDP service not available";
          logger.error(`[EXECUTE_RELAY_BRIDGE] ${errorMsg}`);
          const errorResult: ActionResult = {
            text: ` ${errorMsg}`,
            success: false,
            error: "service_unavailable",
            input: inputParams,
          } as ActionResult & { input: typeof inputParams };
          callback?.({ 
            text: errorResult.text,
            content: { error: "service_unavailable", details: errorMsg }
          });
          return errorResult;
        }

        const wallet = await getEntityWallet(
          runtime,
          message,
          "EXECUTE_RELAY_BRIDGE",
          callback,
        );

        if (wallet.success === false) {
          logger.warn("[EXECUTE_RELAY_BRIDGE] Entity wallet verification failed");
          return {
            ...wallet.result,
            input: inputParams,
          } as ActionResult & { input: typeof inputParams };
        }

        const accountName = wallet.metadata?.accountName as string | undefined;

        if (!accountName) {
          const errorMsg = "Could not resolve user wallet for bridge execution";
          logger.error(`[EXECUTE_RELAY_BRIDGE] ${errorMsg}`);
          const errorResult: ActionResult = {
            text: ` ${errorMsg}`,
            success: false,
            error: "missing_account_name",
            input: inputParams,
          } as ActionResult & { input: typeof inputParams };
          callback?.({ 
            text: errorResult.text,
            content: { error: "missing_account_name", details: errorMsg }
          });
          return errorResult;
        }

        // Calculate USD volume for gamification
        let volumeUsd = 0;
        try {
          // Get user's wallet info to calculate USD value
          // Pass wallet address to avoid CDP account lookup (prevents "account not initialized" errors)
          const walletInfo = await cdp.getWalletInfoCached(accountName, undefined, wallet.walletAddress);
          
          // Find the token in wallet to get price/value
          const walletToken = walletInfo.tokens.find(t => {
            if (t.chain !== bridgeParams.originChain) return false;
            
            // Match by address if provided
            if (t.contractAddress && bridgeParams.currency.startsWith("0x")) {
              return t.contractAddress.toLowerCase() === bridgeParams.currency.toLowerCase();
            }
            
            // Match by symbol
            return t.symbol.toLowerCase() === bridgeParams.currency.toLowerCase();
          });

          if (walletToken && walletToken.usdValue && parseFloat(walletToken.balanceFormatted) > 0) {
            const tokenBalance = parseFloat(walletToken.balanceFormatted);
            const amountNum = parseFloat(bridgeParams.amount);
            // Calculate proportion of total value
            volumeUsd = (amountNum / tokenBalance) * walletToken.usdValue;
            logger.info(`[EXECUTE_RELAY_BRIDGE] Calculated volume USD: $${volumeUsd.toFixed(2)}`);
          }
        } catch (error) {
          logger.warn(`[EXECUTE_RELAY_BRIDGE] Failed to calculate USD volume: ${error}`);
          // Continue without volumeUsd - shouldn't block the bridge
        }

        const cdpNetwork = resolveCdpNetwork(bridgeParams.originChain);

        const viemClient = await cdp.getViemClientsForAccount({
          accountName,
          network: cdpNetwork,
        });
        const walletClient = viemClient.walletClient;
        const userAddress = viemClient.address;

        if (
          wallet.walletAddress &&
          wallet.walletAddress.toLowerCase() !== userAddress.toLowerCase()
        ) {
          logger.warn(
            `[RELAY_BRIDGE] CDP wallet address mismatch (entity: ${wallet.walletAddress}, cdp: ${userAddress}). Using CDP wallet address.`,
          );
        }
        
        // Resolve chain names to IDs
        const originChainId = resolveChainNameToId(bridgeParams.originChain);
        const destinationChainId = resolveChainNameToId(bridgeParams.destinationChain);

        if (!originChainId) {
          const errorMsg = `Unsupported origin chain: ${bridgeParams.originChain}. Supported chains: ${Object.keys(SUPPORTED_CHAINS).join(", ")}`;
          logger.error(`[EXECUTE_RELAY_BRIDGE] ${errorMsg}`);
          const errorResult: ActionResult = {
            text: ` ${errorMsg}`,
            success: false,
            error: "unsupported_chain",
            input: inputParams,
          } as ActionResult & { input: typeof inputParams };
          callback?.({ 
            text: errorResult.text,
            content: { error: "unsupported_chain", details: errorMsg }
          });
          return errorResult;
        }

        if (!destinationChainId) {
          const errorMsg = `Unsupported destination chain: ${bridgeParams.destinationChain}. Supported chains: ${Object.keys(SUPPORTED_CHAINS).join(", ")}`;
          logger.error(`[EXECUTE_RELAY_BRIDGE] ${errorMsg}`);
          const errorResult: ActionResult = {
            text: ` ${errorMsg}`,
            success: false,
            error: "unsupported_chain",
            input: inputParams,
          } as ActionResult & { input: typeof inputParams };
          callback?.({ 
            text: errorResult.text,
            content: { error: "unsupported_chain", details: errorMsg }
          });
          return errorResult;
        }

        // Resolve token symbols to contract addresses on BOTH chains
        const currencyAddress = await resolveTokenToAddress(bridgeParams.currency, bridgeParams.originChain);
        const toCurrencyAddress = await resolveTokenToAddress(bridgeParams.currency, bridgeParams.destinationChain);

        if (!currencyAddress) {
          const errorMsg = `Could not resolve currency: ${bridgeParams.currency} on ${bridgeParams.originChain}`;
          logger.error(`[EXECUTE_RELAY_BRIDGE] ${errorMsg}`);
          const errorResult: ActionResult = {
            text: ` ${errorMsg}`,
            success: false,
            error: "token_resolution_failed",
            input: inputParams,
          } as ActionResult & { input: typeof inputParams };
          callback?.({ 
            text: errorResult.text,
            content: { error: "token_resolution_failed", details: errorMsg }
          });
          return errorResult;
        }

        if (!toCurrencyAddress) {
          const errorMsg = `Could not resolve currency: ${bridgeParams.currency} on ${bridgeParams.destinationChain}`;
          logger.error(`[EXECUTE_RELAY_BRIDGE] ${errorMsg}`);
          const errorResult: ActionResult = {
            text: ` ${errorMsg}`,
            success: false,
            error: "token_resolution_failed",
            input: inputParams,
          } as ActionResult & { input: typeof inputParams };
          callback?.({ 
            text: errorResult.text,
            content: { error: "token_resolution_failed", details: errorMsg }
          });
          return errorResult;
        }

        // Get token decimals for proper amount conversion
        const decimals = currencyAddress === ZERO_ADDRESS
          ? NATIVE_DECIMALS[bridgeParams.currency] ?? 18
          : await getTokenDecimals(currencyAddress, bridgeParams.originChain);

        const amountInWei = parseUnits(bridgeParams.amount, decimals);

      // Create resolved bridge request with chain IDs and contract addresses
      // Create resolved bridge request
      const resolvedRequest: ResolvedBridgeRequest = {
        user: userAddress,
        originChainId,
        destinationChainId,
        currency: currencyAddress,
        toCurrency: toCurrencyAddress,
        amount: amountInWei.toString(),
        recipient: bridgeParams.recipient || userAddress,
        useExactInput: bridgeParams.useExactInput,
        useExternalLiquidity: bridgeParams.useExternalLiquidity,
        referrer: bridgeParams.referrer,
      };

      // Execute bridge
      let currentStatus = `Initiating bridge from ${bridgeParams.originChain} to ${bridgeParams.destinationChain}...`;
      if (callback) {
        callback({ text: currentStatus });
      }

      // Helper to serialize BigInt for logging
      const serializeBigInt = (obj: any): any => {
        if (obj === null || obj === undefined) return obj;
        if (typeof obj === 'bigint') return obj.toString();
        if (Array.isArray(obj)) return obj.map(serializeBigInt);
        if (typeof obj === 'object') {
          const serialized: any = {};
          for (const key in obj) {
            serialized[key] = serializeBigInt(obj[key]);
          }
          return serialized;
        }
        return obj;
      };

      // Track transaction hashes as they come in
      const collectedTxHashes: Array<{ txHash: string; chainId: number }> = [];

      const requestId = await relayService.executeBridge(
        resolvedRequest,
        { walletClient },
        (data: ProgressData) => {
          // Collect transaction hashes from progress updates
          if (data.txHashes && data.txHashes.length > 0) {
            for (const tx of data.txHashes) {
              if (!collectedTxHashes.find(h => h.txHash === tx.txHash)) {
                collectedTxHashes.push(tx);
                logger.info(`Transaction hash: ${tx.txHash} on chain ${tx.chainId}`);
              }
            }
          }

          // Extract meaningful progress information
          const step = data.currentStep?.description || data.currentStep?.action || 'Processing';
          const state = data.currentStepItem?.progressState || 
                        data.currentStepItem?.checkStatus || 
                        data.currentStepItem?.status
          
          // Only send callback if there's an actual status change
          const newStatus = `Bridge ${state}: ${step}`;
          if (newStatus !== currentStatus) {
            currentStatus = newStatus;
            callback?.({ text: currentStatus });
          }
        },
      );

      // Helper to fetch status (tries requestId, falls back to txHash)
      const fetchStatus = async (): Promise<RelayStatus | undefined> => {
        if (requestId && requestId !== 'pending') {
          try {
            return (await relayService.getStatus({ requestId }))[0];
          } catch (error) {
            logger.debug(`Could not fetch with requestId: ${error}`);
          }
        }
        
        if (collectedTxHashes.length > 0) {
          try {
            return (await relayService.getStatus({ txHash: collectedTxHashes[0].txHash }))[0];
          } catch (error) {
            logger.debug(`Could not fetch with tx hash: ${error}`);
          }
        }
        
        return undefined;
      };

      // Poll for final status until complete
      // Bridge operations can take longer due to cross-chain nature
      const maxAttempts = 60; // 2 minutes max (60 attempts × 2s intervals)
      const pollInterval = 2000; // 2 second intervals
      let status = await fetchStatus();
      
      for (let attempt = 0; attempt < maxAttempts && status?.status !== 'success'; attempt++) {
        await new Promise(resolve => setTimeout(resolve, pollInterval));
        
        const newStatus = await fetchStatus();
        if (newStatus && newStatus.status !== status?.status) {
          status = newStatus;
          logger.info(`Bridge status: ${status.status}`);
          callback?.({ text: `Bridge status: ${status.status}` });
          
          if (status.status === 'success') {
            logger.info('Bridge completed successfully');
            callback?.({ text: 'Bridge completed successfully!' });
            break;
          }
        } else if (newStatus) {
          status = newStatus;
        }
      }

      if (status?.status !== 'success') {
        logger.warn('Bridge polling timed out, but transaction may still be processing');
        callback?.({ text: 'Bridge is still processing. Check status later with the request ID.' });
      }

      // Extract actual requestId from status if available
      const actualRequestId = status?.id || requestId;

      // Format response (using serializeBigInt helper defined above)
      const responseText = formatBridgeResponse(status, resolvedRequest, actualRequestId, collectedTxHashes, bridgeParams.currency);
      const response: ActionResult = {
        text: responseText,
        success: true,
        data: serializeBigInt({
          requestId: actualRequestId,
          status,
          txHashes: collectedTxHashes,
          request: {
            ...bridgeParams,
            resolvedOriginChainId: originChainId,
            resolvedDestinationChainId: destinationChainId,
            amountInWei: amountInWei.toString(),
          },
        }),
        values: {
          destinationChain: bridgeParams.destinationChain,
          toChain: bridgeParams.destinationChain,
          volumeUsd: volumeUsd > 0 ? volumeUsd : undefined,
        },
        input: inputParams,
      } as ActionResult & { input: typeof inputParams };

      callback?.({
        text: response.text,
        actions: ["EXECUTE_RELAY_BRIDGE"],
        source: message.content.source,
        data: response.data,
      });

        return response;
      } catch (error: unknown) {
        const errorMessage = (error as Error).message;
        logger.error(`[EXECUTE_RELAY_BRIDGE] Action failed: ${errorMessage}`);
      
      // Try to capture input params even in failure
      let catchFailureInput = {};
      try {
        const composedState = await runtime.composeState(message, ["ACTION_STATE"], true);
        const params = composedState?.data?.actionParams || {};
        catchFailureInput = {
          originChain: params?.originChain,
          destinationChain: params?.destinationChain,
          currency: params?.currency,
          amount: params?.amount,
          recipient: params?.recipient,
          useExactInput: params?.useExactInput,
          useExternalLiquidity: params?.useExternalLiquidity,
          referrer: params?.referrer,
        };
      } catch (e) {
        // If we can't get params, just use empty object
      }
      
      const errorText = ` Failed to execute bridge: ${errorMessage}`;
      const errorResponse: ActionResult = {
        text: errorText,
        success: false,
        error: "action_failed",
        input: catchFailureInput,
      } as ActionResult & { input: typeof catchFailureInput };

      callback?.({
        text: errorResponse.text,
        content: { error: "relay_bridge_failed", details: errorMessage },
      });

      return errorResponse;
    }
  },

  examples: [
    [
      {
        name: "{{user}}",
        content: {
          text: "Bridge 0.5 ETH from Ethereum to Base",
        },
      },
      {
        name: "{{agent}}",
        content: {
          text: "I'll bridge 0.5 ETH from Ethereum to Base for you...",
          action: "EXECUTE_RELAY_BRIDGE",
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: {
          text: "Send 1000 USDC from Base to Arbitrum",
        },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Executing cross-chain transfer of 1000 USDC from Base to Arbitrum...",
          action: "EXECUTE_RELAY_BRIDGE",
        },
      },
    ],
  ],
};

function formatBridgeResponse(
  status: RelayStatus | undefined, 
  request: ResolvedBridgeRequest, 
  requestId: string,
  collectedTxHashes: Array<{ txHash: string; chainId: number }> = [],
  tokenSymbol?: string
): string {
  const statusIndicator = status?.status === "success" ? "" : status?.status === "pending" ? "" : "";

  // Use token symbol from status metadata if available, otherwise use provided symbol
  const statusData = status?.data as any;
  const symbol = statusData?.metadata?.currencyIn?.currency?.symbol || 
                 statusData?.currency || 
                 tokenSymbol || 
                 'TOKEN';

  let response = `
${statusIndicator} **Bridge ${(status?.status || "PENDING").toUpperCase()}**

**Request ID:** \`${requestId}\`
**Route:** ${getChainName(request.originChainId)}  ${getChainName(request.destinationChainId)}
**Amount:** ${formatAmount(request.amount, symbol)}
**Status:** ${status?.status || "pending"}
  `.trim();

  // Show transaction hashes from status (preferred) or from collected hashes
  const originTxHash = status?.data?.inTxs?.[0]?.hash || 
                       collectedTxHashes.find(tx => tx.chainId === request.originChainId)?.txHash;
  const destTxHash = status?.data?.outTxs?.[0]?.hash || 
                     collectedTxHashes.find(tx => tx.chainId === request.destinationChainId)?.txHash;

  if (originTxHash) {
    response += `\n\n**Origin Transaction:**\n- Hash: \`${originTxHash}\`\n- Chain: ${getChainName(request.originChainId)}`;
  }

  if (destTxHash) {
    response += `\n\n**Destination Transaction:**\n- Hash: \`${destTxHash}\`\n- Chain: ${getChainName(request.destinationChainId)}`;
  }

  // Show all collected tx hashes if there are more than origin/dest
  if (collectedTxHashes.length > 0) {
    const otherTxs = collectedTxHashes.filter(
      tx => tx.txHash !== originTxHash && tx.txHash !== destTxHash
    );
    if (otherTxs.length > 0) {
      response += `\n\n**Other Transactions:**`;
      for (const tx of otherTxs) {
        response += `\n- \`${tx.txHash}\` (Chain ${tx.chainId})`;
      }
    }
  }

  if (status?.data?.fees) {
    const gasFeeWei = status.data.fees.gas ?? "0";
    const relayerFeeWei = status.data.fees.relayer ?? "0";
    const totalFees = BigInt(gasFeeWei) + BigInt(relayerFeeWei);
    response += `\n\n**Total Fees:** ${(Number(totalFees) / 1e18).toFixed(6)} ETH`;
  }

  return response;
}

function getChainName(chainId: number): string {
  const chains: Record<number, string> = {
    1: "Ethereum",
    8453: "Base",
    42161: "Arbitrum",
    137: "Polygon",
    10: "Optimism",
    7777777: "Zora",
    81457: "Blast",
    534352: "Scroll",
    59144: "Linea",
  };
  return chains[chainId] || `Chain ${chainId}`;
}

function formatAmount(amount: string, currency: string): string {
  const decimals = currency.toLowerCase().includes("usdc") || currency.toLowerCase().includes("usdt") ? 6 : 18;
  const value = Number(amount) / Math.pow(10, decimals);
  return `${value.toFixed(6)} ${currency.toUpperCase()}`;
}

export default relayBridgeAction;
