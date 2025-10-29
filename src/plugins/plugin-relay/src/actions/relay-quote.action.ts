import {
  type Action,
  type ActionResult,
  type HandlerCallback,
  type IAgentRuntime,
  logger,
  type Memory,
  type State
} from "@elizaos/core";
import type { Execute } from "@relayprotocol/relay-sdk";
import {
  arbitrum,
  base,
  blast,
  type Chain,
  linea,
  mainnet,
  optimism,
  polygon,
  scroll,
  zora
} from "viem/chains";
import { parseUnits } from "viem";
import { RelayService } from "../services/relay.service";
import { getTokenDecimals, resolveTokenToAddress } from "../utils/token-resolver";
import { CdpService } from "../../../plugin-cdp/services/cdp.service";
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

const CDP_NETWORK_MAP: Record<string, CdpNetwork> = {
  ethereum: "ethereum",
  base: "base",
  optimism: "optimism",
  arbitrum: "arbitrum",
  polygon: "polygon",
  "base-sepolia": "base-sepolia",
};

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

const NATIVE_DECIMALS: Record<string, number> = {
  eth: 18,
  matic: 18,
  pol: 18,
};

const resolveCdpNetwork = (chainName: string): CdpNetwork => {
  const network = CDP_NETWORK_MAP[chainName.toLowerCase().trim()];
  if (!network) {
    throw new Error(`CDP wallet does not support signing transactions on ${chainName}`);
  }
  return network;
};

interface QuoteParams {
  originChain: string;
  destinationChain: string;
  currency: string;
  toCurrency?: string;
  amount: string;
  recipient?: string;
  tradeType?: "EXACT_INPUT" | "EXACT_OUTPUT";
}

/**
 * Resolve chain name to chain ID using viem chains
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

export const relayQuoteAction: Action = {
  name: "GET_RELAY_QUOTE",
  description: "Use this action when you need a cross-chain bridge/swap quote.",
  similes: [
    "QUOTE_BRIDGE",
    "QUOTE_CROSS_CHAIN",
    "GET_BRIDGE_QUOTE",
    "CHECK_RELAY_PRICE",
    "ESTIMATE_BRIDGE_COST",
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
      description: "Token symbol to bridge (e.g., 'eth', 'usdc', 'usdt', 'weth')",
      required: true,
    },
    toCurrency: {
      type: "string",
      description: "Destination token symbol (defaults to same as currency if not specified)",
      required: false,
    },
    amount: {
      type: "string",
      description: "Amount to bridge in human-readable format (e.g., '0.1' for 0.1 ETH, not in wei)",
      required: true,
    },
    recipient: {
      type: "string",
      description: "Recipient address on destination chain (defaults to user's address if not specified)",
      required: false,
    },
    tradeType: {
      type: "string",
      description: "Trade type: 'EXACT_INPUT' or 'EXACT_OUTPUT' (default: 'EXACT_INPUT')",
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
        logger.warn("[GET_RELAY_QUOTE] Relay service not available");
        return false;
      }

      return true;
    } catch (error) {
      logger.error(
        "[GET_RELAY_QUOTE] Error validating action:",
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
      logger.info("[GET_RELAY_QUOTE] Handler invoked");
      
      try {
        // Get Relay service
        const relayService = runtime.getService<RelayService>(RelayService.serviceType);

        if (!relayService) {
          const errorMsg = "Relay service not initialized";
          logger.error(`[GET_RELAY_QUOTE] ${errorMsg}`);
          
          // Try to capture input params even in early failure
          let earlyFailureInput = {};
          try {
            const composedState = await runtime.composeState(message, ["ACTION_STATE"], true);
            const params = composedState?.data?.actionParams || {};
            earlyFailureInput = {
              originChain: params?.originChain,
              destinationChain: params?.destinationChain,
              currency: params?.currency,
              toCurrency: params?.toCurrency,
              amount: params?.amount,
              recipient: params?.recipient,
              tradeType: params?.tradeType,
            };
          } catch (e) {
            // If we can't get params, just use empty object
          }
          
          const errorResult: ActionResult = {
            text: `❌ ${errorMsg}`,
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
          logger.error(`[GET_RELAY_QUOTE] ${errorMsg}`);
          const errorResult: ActionResult = {
            text: `❌ ${errorMsg}`,
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
          logger.error(`[GET_RELAY_QUOTE] ${errorMsg}`);
          const errorResult: ActionResult = {
            text: `❌ ${errorMsg}`,
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
          logger.error(`[GET_RELAY_QUOTE] ${errorMsg}`);
          const errorResult: ActionResult = {
            text: `❌ ${errorMsg}`,
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
          const errorMsg = "Missing required parameter 'amount'. Please specify the amount to bridge (e.g., '0.1').";
          logger.error(`[GET_RELAY_QUOTE] ${errorMsg}`);
          const errorResult: ActionResult = {
            text: `❌ ${errorMsg}`,
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

        // Parse quote parameters with defaults
        const quoteParams: QuoteParams = {
          originChain,
          destinationChain,
          currency,
          toCurrency: params?.toCurrency?.toLowerCase().trim() || currency,
          amount,
          recipient: params?.recipient?.trim(),
          tradeType: (params?.tradeType || "EXACT_INPUT") as "EXACT_INPUT" | "EXACT_OUTPUT",
        };

        // Store input parameters for return
        const inputParams = {
          originChain: quoteParams.originChain,
          destinationChain: quoteParams.destinationChain,
          currency: quoteParams.currency,
          toCurrency: quoteParams.toCurrency,
          amount: quoteParams.amount,
          recipient: quoteParams.recipient,
          tradeType: quoteParams.tradeType,
        };

        logger.info(`[GET_RELAY_QUOTE] Quote parameters: ${JSON.stringify(quoteParams)}`);

        const cdp = runtime.getService?.("CDP_SERVICE") as CdpService;
        if (!cdp || typeof cdp.getViemClientsForAccount !== "function") {
          const errorMsg = "CDP service not available";
          logger.error(`[GET_RELAY_QUOTE] ${errorMsg}`);
          const errorResult: ActionResult = {
            text: `❌ ${errorMsg}`,
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
          "GET_RELAY_QUOTE",
          callback,
        );

        if (wallet.success === false) {
          logger.warn("[GET_RELAY_QUOTE] Entity wallet verification failed");
          return {
            ...wallet.result,
            input: inputParams,
          } as ActionResult & { input: typeof inputParams };
        }

        const accountName = wallet.metadata?.accountName as string | undefined;

        if (!accountName) {
          const errorMsg = "Could not resolve user wallet for quote generation";
          logger.error(`[GET_RELAY_QUOTE] ${errorMsg}`);
          const errorResult: ActionResult = {
            text: `❌ ${errorMsg}`,
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

        const cdpNetwork = resolveCdpNetwork(quoteParams.originChain);

        const viemClient = await cdp.getViemClientsForAccount({
          accountName,
          network: cdpNetwork,
        });
        const userAddress = viemClient.address;

        // Resolve chain names to IDs
        const originChainId = resolveChainNameToId(quoteParams.originChain);
        const destinationChainId = resolveChainNameToId(quoteParams.destinationChain);

        if (!originChainId) {
          const errorMsg = `Unsupported origin chain: ${quoteParams.originChain}. Supported chains: ${Object.keys(SUPPORTED_CHAINS).join(", ")}`;
          logger.error(`[GET_RELAY_QUOTE] ${errorMsg}`);
          const errorResult: ActionResult = {
            text: `❌ ${errorMsg}`,
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
          const errorMsg = `Unsupported destination chain: ${quoteParams.destinationChain}. Supported chains: ${Object.keys(SUPPORTED_CHAINS).join(", ")}`;
          logger.error(`[GET_RELAY_QUOTE] ${errorMsg}`);
          const errorResult: ActionResult = {
            text: `❌ ${errorMsg}`,
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

        // Resolve token symbols to contract addresses
        const currencyAddress = await resolveTokenToAddress(quoteParams.currency, quoteParams.originChain);
        const toCurrencySymbol = quoteParams.toCurrency || quoteParams.currency;
        const toCurrencyAddress = await resolveTokenToAddress(toCurrencySymbol, quoteParams.destinationChain);

        if (!currencyAddress) {
          const errorMsg = `Could not resolve currency: ${quoteParams.currency} on ${quoteParams.originChain}`;
          logger.error(`[GET_RELAY_QUOTE] ${errorMsg}`);
          const errorResult: ActionResult = {
            text: `❌ ${errorMsg}`,
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
          const errorMsg = `Could not resolve destination currency: ${toCurrencySymbol} on ${quoteParams.destinationChain}`;
          logger.error(`[GET_RELAY_QUOTE] ${errorMsg}`);
          const errorResult: ActionResult = {
            text: `❌ ${errorMsg}`,
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
          ? NATIVE_DECIMALS[quoteParams.currency] ?? 18
          : await getTokenDecimals(currencyAddress, quoteParams.originChain);

        const amountInWei = parseUnits(quoteParams.amount, decimals);

        // Get quote from Relay
        const quoteRequest = {
          user: userAddress,
          chainId: originChainId,
          toChainId: destinationChainId,
          currency: currencyAddress,
          toCurrency: toCurrencyAddress,
          amount: amountInWei.toString(),
          recipient: quoteParams.recipient || userAddress,
          tradeType: quoteParams.tradeType ?? "EXACT_INPUT",
        };
  
        const quote = await relayService.getQuote(quoteRequest);

      // Serialize BigInt values to strings for storage
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

      // Format response
      const responseText = formatQuoteResponse(
        quote as Execute, 
        originChainId, 
        destinationChainId,
        quoteParams.amount,
        quoteParams.currency
      );
      
      const response: ActionResult = {
        text: responseText,
        success: true,
        data: serializeBigInt({
          quote,
          request: {
            ...quoteParams,
            resolvedOriginChainId: originChainId,
            resolvedDestinationChainId: destinationChainId,
            amountInWei: amountInWei.toString(),
          },
        }),
        input: inputParams,
      } as ActionResult & { input: typeof inputParams };

      callback?.({
        text: response.text,
        actions: ["GET_RELAY_QUOTE"],
        source: message.content.source,
        data: response.data,
      });

        return response;
      } catch (error: unknown) {
        const errorMessage = (error as Error).message;
        logger.error(`[GET_RELAY_QUOTE] Action failed: ${errorMessage}`);
      
      // Try to capture input params even in failure
      let catchFailureInput = {};
      try {
        const composedState = await runtime.composeState(message, ["ACTION_STATE"], true);
        const params = composedState?.data?.actionParams || {};
        catchFailureInput = {
          originChain: params?.originChain,
          destinationChain: params?.destinationChain,
          currency: params?.currency,
          toCurrency: params?.toCurrency,
          amount: params?.amount,
          recipient: params?.recipient,
          tradeType: params?.tradeType,
        };
      } catch (e) {
        // If we can't get params, just use empty object
      }
      
      const errorText = `❌ Failed to get Relay quote: ${errorMessage}`;
      const errorResponse: ActionResult = {
        text: errorText,
        success: false,
        error: "action_failed",
        input: catchFailureInput,
      } as ActionResult & { input: typeof catchFailureInput };

      callback?.({
        text: errorResponse.text,
        content: { error: "relay_quote_failed", details: errorMessage },
      });

      return errorResponse;
    }
  },

  examples: [
    [
      {
        name: "{{user}}",
        content: {
          text: "Get me a quote to bridge 0.1 ETH from Ethereum to Base",
        },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Let me get you a quote for bridging 0.1 ETH from Ethereum to Base...",
          action: "GET_RELAY_QUOTE",
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: {
          text: "How much would it cost to send 100 USDC from Base to Arbitrum?",
        },
      },
      {
        name: "{{agent}}",
        content: {
          text: "I'll check the quote for bridging 100 USDC from Base to Arbitrum...",
          action: "GET_RELAY_QUOTE",
        },
      },
    ],
  ],
};

function formatQuoteResponse(
  quote: Execute, 
  originChainId: number, 
  destinationChainId: number,
  amount: string,
  currency: string
): string {
  // Handle both old and new SDK fee structures
  const gasFeeWei = typeof (quote as any).fees?.gas === "string"
    ? (quote as any).fees.gas as string
    : (quote as any).fees?.gas?.amount ?? "0";
  const relayerFeeWei = typeof (quote as any).fees?.relayer === "string"
    ? (quote as any).fees.relayer as string
    : (quote as any).fees?.relayer?.amount ?? "0";
  const totalFees = BigInt(gasFeeWei) + BigInt(relayerFeeWei);
  const feesInEth = Number(totalFees) / 1e18;

  // Extract details with fallbacks
  const amountIn = ((quote as any).details?.currencyIn?.amount ?? (quote as any).details?.amountIn ?? "0") as string;
  const amountOut = ((quote as any).details?.currencyOut?.amount ?? (quote as any).details?.amountOut ?? "0") as string;
  // Extract currency symbol from the currency object structure
  const currencyInSymbol = ((quote as any).details?.currencyIn?.currency?.symbol ?? currency) as string;
  const currencyOutSymbol = ((quote as any).details?.currencyOut?.currency?.symbol ?? currency) as string;
  const rate = ((quote as any).details?.rate ?? "?") as string;
  const totalImpact = ((quote as any).details?.totalImpact?.percent ?? (quote as any).details?.totalImpact ?? "?") as string;

  return `
🔄 **Cross-Chain Quote**

**Route:** ${getChainName(originChainId)} → ${getChainName(destinationChainId)}
**Amount In:** ${formatAmount(amountIn, currencyInSymbol)}
**Amount Out:** ${formatAmount(amountOut, currencyOutSymbol)}
**Exchange Rate:** ${rate}

**Fees:**
- Gas: ${(Number(gasFeeWei) / 1e18).toFixed(6)} ETH
- Relayer: ${(Number(relayerFeeWei) / 1e18).toFixed(6)} ETH
- Total: ${feesInEth.toFixed(6)} ETH

**Price Impact:** ${totalImpact}%

The quote is ready for execution.
  `.trim();
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

export default relayQuoteAction;
