// Re-export CowSwap SDK types
export type {
  OrderKind,
  OrderStatus,
  SigningScheme,
  OrderBookApi,
  EnrichedOrder,
  OrderCreation,
  OrderQuoteRequest,
  OrderQuoteResponse,
  SupportedChainId,
} from "@cowprotocol/cow-sdk"

// Plugin-specific types

export interface CowSwapQuoteParams {
  sellToken: string // Token symbol or address
  buyToken: string // Token symbol or address
  amount: string // Human-readable amount
  kind: "SELL" | "BUY" // Sell exact or buy exact
  chainId?: number // Optional chain ID
  slippageTolerance?: string // Optional, e.g., "0.5" for 0.5%
}

export interface CowSwapQuoteResult {
  quoteId: number
  sellAmount: string
  buyAmount: string
  feeAmount: string
  buyAmountAfterFee: string
  sellTokenPrice?: string
  buyTokenPrice?: string
  effectivePrice: string
  priceImpact?: string
  validTo: number
  sellToken: {
    symbol: string
    address: string
    decimals: number
  }
  buyToken: {
    symbol: string
    address: string
    decimals: number
  }
}

export interface CowSwapSwapFromQuoteParams {
  quoteId: number
  chainId?: number
  recipient?: string
}

export interface CowSwapSwapParams {
  sellToken: string
  buyToken: string
  amount: string
  kind: "SELL" | "BUY"
  chainId?: number
  slippageTolerance?: string
  recipient?: string
  validTo?: number
}

export interface CowSwapOrderResult {
  orderUid: string
  orderHash: string
  sellToken: string
  buyToken: string
  sellAmount: string
  buyAmount: string
  feeAmount: string
  validTo: number
  status: string
  explorerUrl: string
}

export interface CowSwapLimitOrderParams {
  sellToken: string
  buyToken: string
  sellAmount: string
  buyAmount: string
  chainId?: number
  recipient?: string
  partiallyFillable?: boolean
  validTo?: number
}

export interface CowSwapLimitOrderResult extends CowSwapOrderResult {
  limitPrice: string
  currentPrice: string
  partiallyFillable: boolean
}

export interface CowSwapOrderStatusParams {
  orderUid: string
  chainId?: number
}

export interface CowSwapOrderStatusResult {
  orderUid: string
  status: string
  creationTime: string
  executedBuyAmount?: string
  executedSellAmount?: string
  executedFeeAmount?: string
  txHash?: string
  surplus?: string
  explorerUrl: string
}

export interface CowSwapCancelOrderParams {
  orderUid: string
  chainId?: number
}

export interface CowSwapCancelOrderResult {
  orderUid: string
  cancelled: boolean
  status: string
  message: string
}

export interface CowSwapBridgeParams {
  sellToken: string
  buyToken: string
  amount: string
  fromChainId: number
  toChainId: number
}

export interface TokenInfo {
  symbol: string
  address: string
  decimals: number
  chainId: number
}

export interface CachedQuote {
  quote: any // CowSwap quote object
  timestamp: number
  params: CowSwapQuoteParams
}

// Supported chains configuration
export interface ChainConfig {
  name: string
  vaultRelayer: string
  nativeToken: string
  rpcUrl?: string
}

export const SUPPORTED_CHAINS: Record<number, ChainConfig> = {
  1: {
    name: "Ethereum",
    vaultRelayer: "0xC92E8bdf79f0507f65a392b0ab4667716BFE0110",
    nativeToken: "ETH",
  },
  100: {
    name: "Gnosis",
    vaultRelayer: "0xC92E8bdf79f0507f65a392b0ab4667716BFE0110",
    nativeToken: "xDAI",
  },
  42161: {
    name: "Arbitrum",
    vaultRelayer: "0xC92E8bdf79f0507f65a392b0ab4667716BFE0110",
    nativeToken: "ETH",
  },
  8453: {
    name: "Base",
    vaultRelayer: "0xC92E8bdf79f0507f65a392b0ab4667716BFE0110",
    nativeToken: "ETH",
  },
  137: {
    name: "Polygon",
    vaultRelayer: "0xC92E8bdf79f0507f65a392b0ab4667716BFE0110",
    nativeToken: "POL",
  },
} as const

export type SupportedChainIdType = keyof typeof SUPPORTED_CHAINS
