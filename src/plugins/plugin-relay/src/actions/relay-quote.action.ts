import {
  type Action,
  type ActionResult,
  composePromptFromState,
  type HandlerCallback,
  type IAgentRuntime,
  logger,
  type Memory,
  ModelType,
  parseKeyValueXml,
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

const parseQuoteParams = (text: string): QuoteParams | null => {
  const parsed = parseKeyValueXml(text);
  
  if (!parsed?.originChain || !parsed?.destinationChain || !parsed?.currency || !parsed?.amount) {
    console.warn(`Missing required quote parameters: ${JSON.stringify({ parsed })}`);
    return null;
  }

  return {
    originChain: parsed.originChain.toLowerCase().trim(),
    destinationChain: parsed.destinationChain.toLowerCase().trim(),
    currency: parsed.currency.toLowerCase().trim(),
    toCurrency: parsed.toCurrency?.toLowerCase().trim(),
    amount: parsed.amount,
    recipient: parsed.recipient?.trim(),
    tradeType: (parsed.tradeType || "EXACT_INPUT") as "EXACT_INPUT" | "EXACT_OUTPUT",
  };
};

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

const quoteTemplate = `# Cross-Chain Quote Request

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
Determine and extract the user's quote details from the conversation context.

**Important Notes:**
- Use lowercase chain names ONLY (e.g., "ethereum", "base", "arbitrum")
- Do NOT provide chain IDs - only chain names
- For amounts, use human-readable format (e.g., "0.1" for 0.1 ETH, NOT in wei)
- Use token symbols (eth, usdc, usdt, weth, etc.)

Respond with the quote parameters in this exact format:
<response>
  <originChain>ethereum</originChain>
  <destinationChain>base</destinationChain>
  <currency>eth</currency>
  <toCurrency>eth</toCurrency>
  <amount>0.1</amount>
  <tradeType>EXACT_INPUT</tradeType>
</response>`;

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

        // Compose state and get quote parameters from LLM
        const composedState = await runtime.composeState(message, ["RECENT_MESSAGES"], true);
        const context = composePromptFromState({
          state: composedState,
          template: quoteTemplate,
        });

        // Extract quote parameters using LLM
        const xmlResponse = await runtime.useModel(ModelType.TEXT_LARGE, {
          prompt: context,
        });

        const quoteParams = parseQuoteParams(xmlResponse);

        if (!quoteParams) {
          throw new Error("Failed to parse quote parameters from request");
        }

        const cdp = runtime.getService?.("CDP_SERVICE") as CdpService;
        if (!cdp || typeof cdp.getViemClientsForAccount !== "function") {
          throw new Error("CDP not available");
        }
        const wallet = await getEntityWallet(
          runtime,
          message,
          "GET_RELAY_QUOTE",
          callback,
        );

        if (wallet.success === false) {
          return wallet.result;
        }

        const accountName = wallet.metadata?.accountName as string | undefined;

        if (!accountName) {
          throw new Error("Could not resolve user wallet for quote generation");
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
          throw new Error(`Unsupported origin chain: ${quoteParams.originChain}. Supported chains: ${Object.keys(SUPPORTED_CHAINS).join(", ")}`);
        }

        if (!destinationChainId) {
          throw new Error(`Unsupported destination chain: ${quoteParams.destinationChain}. Supported chains: ${Object.keys(SUPPORTED_CHAINS).join(", ")}`);
        }

        // Resolve token symbols to contract addresses
        const currencyAddress = await resolveTokenToAddress(quoteParams.currency, quoteParams.originChain);
        const toCurrencySymbol = quoteParams.toCurrency || quoteParams.currency;
        const toCurrencyAddress = await resolveTokenToAddress(toCurrencySymbol, quoteParams.destinationChain);

        if (!currencyAddress) {
          throw new Error(`Could not resolve currency: ${quoteParams.currency} on ${quoteParams.originChain}`);
        }

        if (!toCurrencyAddress) {
          throw new Error(`Could not resolve destination currency: ${toCurrencySymbol} on ${quoteParams.destinationChain}`);
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
      const response: ActionResult = {
        text: formatQuoteResponse(
          quote as Execute, 
          originChainId, 
          destinationChainId,
          quoteParams.amount,
          quoteParams.currency
        ),
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
      };

      if (callback) {
        callback({
          text: response.text,
          actions: ["GET_RELAY_QUOTE"],
          source: message.content.source,
          data: response.data,
        });
      }

        return response;
      } catch (error: unknown) {
        const errorMessage = (error as Error).message;
        logger.error(`Relay quote failed: ${errorMessage}`);
      
      const errorResponse: ActionResult = {
        text: `Failed to get Relay quote: ${errorMessage}`,
        success: false,
        error: errorMessage,
      };

      if (callback) {
        callback({
          text: errorResponse.text,
          content: { error: "relay_quote_failed", details: errorMessage },
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
