import { z } from "zod";
import type { 
  Execute, 
  ExecuteStep, 
  ExecuteStepItem,
  ProgressData,
  CallFees,
  CallBreakdown,
  QuoteDetails,
} from "@relayprotocol/relay-sdk";

// Re-export SDK types for convenience
export type { Execute, ExecuteStep, ExecuteStepItem, ProgressData, CallFees, CallBreakdown, QuoteDetails };

// Supported chains for Relay
export const RelaySupportedChains = {
  ETHEREUM: 1,
  BASE: 8453,
  ARBITRUM: 42161,
  POLYGON: 137,
  OPTIMISM: 10,
  ZORA: 7777777,
  BLAST: 81457,
  SCROLL: 534352,
  LINEA: 59144,
} as const;

export type RelayChainId = (typeof RelaySupportedChains)[keyof typeof RelaySupportedChains];

// Supported currencies
export const RelayCurrencies = [
  "eth",
  "usdc",
  "usdt",
  "weth",
  "usdc.e",
  "wbtc",
  "degen",
  "tia",
] as const;

export type RelayCurrency = (typeof RelayCurrencies)[number];

// Quote request schema - Updated for Relay SDK 2.x
export const QuoteRequestSchema = z.object({
  user: z.string().describe("User wallet address"),
  chainId: z.number().describe("Origin chain ID"),  // renamed from originChainId
  toChainId: z.number().describe("Destination chain ID"),  // renamed from destinationChainId
  currency: z.string().describe("Currency on origin chain"),  // renamed from originCurrency
  toCurrency: z.string().optional().describe("Currency on destination chain"),  // renamed from destinationCurrency
  amount: z.string().describe("Amount in wei"),
  recipient: z.string().optional().describe("Recipient address (defaults to user)"),
  tradeType: z.enum(["EXACT_INPUT", "EXACT_OUTPUT"]).optional().default("EXACT_INPUT"),
  referrer: z.string().optional().describe("Referrer address for fees"),
});

export type QuoteRequest = z.infer<typeof QuoteRequestSchema>;

// Note: Using SDK's Execute type as the quote response instead of custom RelayQuote

// Bridge request schema - LLM provides chain names, not IDs
// Note: user address is derived from EVM_PRIVATE_KEY, not from LLM
export const BridgeRequestSchema = z.object({
  originChain: z.string().describe("Origin chain name (e.g., 'ethereum', 'base', 'arbitrum')"),
  destinationChain: z.string().describe("Destination chain name (e.g., 'ethereum', 'base', 'arbitrum')"),
  currency: z.string().describe("Currency to bridge (symbol like 'eth', 'usdc')"),
  amount: z.string().describe("Amount in human-readable format (e.g., '0.5' for 0.5 ETH)"),
  recipient: z.string().optional().describe("Recipient address (defaults to user's wallet)"),
  useExactInput: z.boolean().optional().default(true),
  useExternalLiquidity: z.boolean().optional().default(false),
  referrer: z.string().optional().describe("Referrer address"),
});

export type BridgeRequest = z.infer<typeof BridgeRequestSchema>;

// Internal bridge request with resolved chain IDs
export interface ResolvedBridgeRequest {
  user: string;
  originChainId: number;
  destinationChainId: number;
  currency: string;  // Contract address on origin chain
  toCurrency?: string;  // Contract address on destination chain
  amount: string; // in wei
  recipient?: string;
  useExactInput?: boolean;
  useExternalLiquidity?: boolean;
  referrer?: string;
}

// Execute call request schema
export const ExecuteCallRequestSchema = z.object({
  user: z.string().describe("User wallet address"),
  originChainId: z.number().describe("Origin chain ID"),
  destinationChainId: z.number().describe("Destination chain ID"),
  originCurrency: z.string().describe("Currency on origin chain"),
  amount: z.string().describe("Amount in wei"),
  txs: z.array(
    z.object({
      to: z.string().describe("Contract address to call"),
      value: z.string().describe("Value to send"),
      data: z.string().describe("Calldata"),
    })
  ).describe("Array of transactions to execute on destination"),
  recipient: z.string().optional().describe("Recipient address"),
});

export type ExecuteCallRequest = z.infer<typeof ExecuteCallRequestSchema>;

// Status request schema
export const StatusRequestSchema = z.object({
  requestId: z.string().optional().describe("Request ID to check status"),
  txHash: z.string().optional().describe("Transaction hash to check status"),
  user: z.string().optional().describe("Filter by user address"),
});

export type StatusRequest = z.infer<typeof StatusRequestSchema>;

// Transaction status
export interface RelayStatus {
  id: string;
  status: "pending" | "success" | "failed";
  user: string;
  recipient: string;
  createdAt: string;
  updatedAt: string;
  data: {
    fees: {
      gas?: string;
      relayer?: string;
    };
    inTxs: Array<{
      hash: string;
      chainId: number;
      timestamp: number;
    }>;
    outTxs: Array<{
      hash: string;
      chainId: number;
      timestamp: number;
    }>;
  };
}

// Helper type for extracting request ID from Execute result
// The SDK's Execute type has a 'request' field which is an AxiosRequestConfig
// For our purposes, we need to check the actual result structure
export interface RelayExecuteResult {
  data?: {
    request?: {
      id: string;
    };
  };
  requestId?: string;
}

// Chain information
export interface RelayChain {
  id: number;
  name: string;
  displayName: string;
  httpRpcUrl: string;
  wsRpcUrl?: string;
  explorerUrl: string;
  depositEnabled: boolean;
  withdrawEnabled: boolean;
}

// Currency information
export interface RelayCurrencyInfo {
  currency: {
    contract: string;
    decimals: number;
    name: string;
    symbol: string;
  };
  chainId: number;
  depositEnabled: boolean;
  withdrawEnabled: boolean;
  minAmount: string;
  maxAmount: string;
}

// Plugin configuration
export interface RelayPluginConfig {
  RELAY_API_URL?: string;
  RELAY_API_KEY?: string;
  DEFAULT_SLIPPAGE?: string;
  MAX_PRICE_IMPACT?: string;
  ENABLE_TESTNET?: boolean;
}
