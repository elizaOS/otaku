import {
  type Action,
  type IAgentRuntime,
  logger,
  type Memory,
  type State,
  type HandlerCallback,
  type ActionResult,
  composePromptFromState,
  parseKeyValueXml,
  ModelType,
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

const parseBridgeParams = (text: string): BridgeRequest | null => {
  const parsed = parseKeyValueXml(text);
  
  if (!parsed?.originChain || !parsed?.destinationChain || !parsed?.currency || !parsed?.amount) {
    console.warn(`Missing required bridge parameters: ${JSON.stringify({ parsed })}`);
    return null;
  }

  return {
    originChain: parsed.originChain.toLowerCase().trim(),
    destinationChain: parsed.destinationChain.toLowerCase().trim(),
    currency: parsed.currency.toLowerCase().trim(),
    amount: parsed.amount,
    recipient: parsed.recipient?.trim() || undefined,
    useExactInput: parsed.useExactInput !== "false",
    useExternalLiquidity: parsed.useExternalLiquidity === "true",
    referrer: parsed.referrer?.trim() || undefined,
  };
};

const bridgeTemplate = `# Cross-Chain Bridge Request

## Conversation Context
{{recentMessages}}

## Available Networks
- ethereum (Ethereum Mainnet)
- base (Base)
- arbitrum (Arbitrum One)
- polygon (Polygon)
- optimism (Optimism)
- zora (Zora)
- blast (Blast)
- scroll (Scroll)
- linea (Linea)

## Instructions
Determine and extract the user's bridge details from the conversation context.

**Important Notes:**
- Use lowercase chain names ONLY (e.g., "ethereum", "base", "arbitrum")
- Do NOT provide chain IDs - only chain names
- For amounts, use human-readable format (e.g., "0.5" for 0.5 ETH, NOT in wei)
- Use token symbols (eth, usdc, usdt, weth, etc.)

Respond with the bridge parameters in this exact format:
<response>
  <originChain>ethereum</originChain>
  <destinationChain>base</destinationChain>
  <currency>eth</currency>
  <amount>0.5</amount>
  <useExactInput>true</useExactInput>
  <useExternalLiquidity>false</useExternalLiquidity>
</response>`;

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
  description: "Use this action when you need to execute a cross-chain bridge.",
  similes: [
    "BRIDGE_TOKENS",
    "CROSS_CHAIN_TRANSFER",
    "RELAY_BRIDGE",
    "SEND_CROSS_CHAIN",
    "TRANSFER_CROSS_CHAIN",
  ],

  validate: async (runtime: IAgentRuntime, message: Memory, state?: State) => {
    try {
      // Check if services are available
      const relayService = runtime.getService(
        RelayService.serviceType,
      ) as RelayService;

      if (!relayService) {
        logger.warn("Required services not available for token deployment");
        return false;
      }

      return true;
    } catch (error) {
      logger.error(
        "Error validating token deployment action:",
        error instanceof Error ? error.message : String(error),
      );
      return false;
    }
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state: State,
    options?: { [key: string]: unknown },
    callback?: HandlerCallback
    ): Promise<ActionResult> => {
      try {
        // Get Relay service
        const relayService = runtime.getService<RelayService>(RelayService.serviceType);

        if (!relayService) {
          throw new Error("Relay service not initialized");
        }

        // Compose state and get bridge parameters from LLM
        const composedState = await runtime.composeState(message, ["RECENT_MESSAGES"], true);
        const context = composePromptFromState({
          state: composedState,
          template: bridgeTemplate,
        });

        // Extract bridge parameters using LLM
        const xmlResponse = await runtime.useModel(ModelType.TEXT_LARGE, {
          prompt: context,
        });

        const bridgeParams = parseBridgeParams(xmlResponse);

        if (!bridgeParams) {
          throw new Error("Failed to parse bridge parameters from request");
        }

        const cdp = runtime.getService?.("CDP_SERVICE") as CdpService;
        if (!cdp || typeof cdp.getViemClientsForAccount !== "function") {
          throw new Error("CDP not available");
        }
        const wallet = await getEntityWallet(
          runtime,
          message,
          "EXECUTE_RELAY_BRIDGE",
          callback,
        );

        if (wallet.success === false) {
          return wallet.result;
        }

        const accountName = wallet.metadata?.accountName as string | undefined;

        if (!accountName) {
          throw new Error("Could not resolve user wallet for bridge execution");
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
          throw new Error(`Unsupported origin chain: ${bridgeParams.originChain}. Supported chains: ${Object.keys(SUPPORTED_CHAINS).join(", ")}`);
        }

        if (!destinationChainId) {
          throw new Error(`Unsupported destination chain: ${bridgeParams.destinationChain}. Supported chains: ${Object.keys(SUPPORTED_CHAINS).join(", ")}`);
        }

        // Resolve token symbols to contract addresses on BOTH chains
        const currencyAddress = await resolveTokenToAddress(bridgeParams.currency, bridgeParams.originChain);
        const toCurrencyAddress = await resolveTokenToAddress(bridgeParams.currency, bridgeParams.destinationChain);

        if (!currencyAddress) {
          throw new Error(`Could not resolve currency: ${bridgeParams.currency} on ${bridgeParams.originChain}`);
        }

        if (!toCurrencyAddress) {
          throw new Error(`Could not resolve currency: ${bridgeParams.currency} on ${bridgeParams.destinationChain}`);
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
      const maxAttempts = 60; // 2 minutes max (2 second intervals)
      const pollInterval = 2000;
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
      const response: ActionResult = {
        text: formatBridgeResponse(status, resolvedRequest, actualRequestId, collectedTxHashes, bridgeParams.currency),
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
      };

      if (callback) {
        callback({
          text: response.text,
          actions: ["EXECUTE_RELAY_BRIDGE"],
          source: message.content.source,
          data: response.data,
        });
      }

        return response;
      } catch (error: unknown) {
        const errorMessage = (error as Error).message;
        logger.error(`Relay bridge failed: ${errorMessage}`);
      
      const errorResponse: ActionResult = {
        text: `Failed to execute bridge: ${errorMessage}`,
        success: false,
        error: errorMessage,
      };

      if (callback) {
        callback({
          text: errorResponse.text,
          content: { error: "relay_bridge_failed", details: errorMessage },
        });
      }

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
  const statusEmoji = status?.status === "success" ? "✅" : status?.status === "pending" ? "⏳" : "⚠️";

  // Use token symbol from status metadata if available, otherwise use provided symbol
  const statusData = status?.data as any;
  const symbol = statusData?.metadata?.currencyIn?.currency?.symbol || 
                 statusData?.currency || 
                 tokenSymbol || 
                 'TOKEN';

  let response = `
${statusEmoji} **Bridge ${(status?.status || "PENDING").toUpperCase()}**

**Request ID:** \`${requestId}\`
**Route:** ${getChainName(request.originChainId)} → ${getChainName(request.destinationChainId)}
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
