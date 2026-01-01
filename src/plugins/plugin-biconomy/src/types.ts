/**
 * Biconomy Supertransaction API Types
 * Based on https://docs.biconomy.io/supertransaction-api
 */

// ============================================
// Chain Token Types
// ============================================

export interface ChainToken {
  chainId: number;
  tokenAddress: string;
}

// ============================================
// Input/Target Position Types
// ============================================

export interface InputPosition {
  chainToken: ChainToken;
  amount: string; // in wei
}

export interface TargetPosition {
  chainToken: ChainToken;
  weight: number; // 0-1, all weights must sum to 1.0
}

// ============================================
// Compose Flow Types
// ============================================

export interface IntentFlowData {
  slippage: number; // 0-1, e.g., 0.01 = 1%
  inputPositions: InputPosition[];
  targetPositions: TargetPosition[];
}

export interface IntentSimpleFlowData {
  srcChainId: number;
  dstChainId: number;
  srcToken: string;
  dstToken: string;
  amount: string;
  slippage: number;
  denySwapProviders?: string;
}

export interface BuildFlowData {
  functionSignature: string;
  args: unknown[];
  to: string;
  chainId: number;
  gasLimit?: string;
}

export interface ComposeFlow {
  type: '/instructions/intent' | '/instructions/intent-simple' | '/instructions/build' | '/instructions/build-raw' | '/instructions/build-ccip';
  data: IntentFlowData | IntentSimpleFlowData | BuildFlowData;
  batch?: boolean;
}

// ============================================
// Funding Token Types
// ============================================

export interface FundingToken {
  tokenAddress: string;
  chainId: number;
  amount: string;
}

// ============================================
// Fee Token Types
// ============================================

export interface FeeToken {
  address: string;
  chainId: number;
}

// ============================================
// Quote Request/Response Types
// ============================================

export type ExecutionMode = 'eoa' | 'smart-account';

export interface QuoteRequest {
  mode: ExecutionMode;
  ownerAddress: string;
  composeFlows: ComposeFlow[];
  fundingTokens?: FundingToken[];
  feeToken?: FeeToken; // Optional, defaults to sponsorship (gasless)
  gasLimit?: string;
  lowerBoundTimestamp?: number;
  upperBoundTimestamp?: number;
}

export type QuoteType = 'permit' | 'onchain' | 'simple';

export interface SignablePayload {
  domain: Record<string, unknown>;
  types: Record<string, unknown>;
  message: Record<string, unknown> | string;
  primaryType: string;
}

export interface PayloadToSign {
  signablePayload?: SignablePayload;
  metadata: Record<string, unknown>;
  signature?: string;
  to?: `0x${string}`;
  data?: `0x${string}`;
  value?: string | number | bigint;
  chainId?: number;
  gasLimit?: string;
}

export interface RouteInfo {
  summary: string;
  steps: unknown[];
}

export interface ReturnedData {
  outputAmount: string;
  minOutputAmount: string;
  targetPosition?: TargetPosition;
  route: RouteInfo;
}

export interface FeeDetails {
  amount: string;
  token: string;
  chainId: number;
}

export interface QuoteResponse {
  ownerAddress: string;
  mode: ExecutionMode;
  fee: FeeDetails;
  quoteType: QuoteType;
  quote: {
    hash: string;
    node: string;
    commitment: string;
    paymentInfo: Record<string, unknown>;
    userOps: unknown[];
    fundingTokens?: FundingToken[];
  };
  payloadToSign: PayloadToSign[];
  returnedData: ReturnedData[];
}

// ============================================
// Execute Request/Response Types
// ============================================

export interface ExecuteRequest extends QuoteResponse {
  // payloadToSign should contain signatures
}

export interface ExecuteResponse {
  success: boolean;
  supertxHash: string | null;
  error: string | null;
}

// ============================================
// Status/Tracking Types
// ============================================

export interface SupertxStatus {
  status: 'pending' | 'success' | 'failed';
  supertxHash: string;
  transactions?: {
    chainId: number;
    txHash: string;
    status: string;
  }[];
  error?: string;
}

// ============================================
// Action Parameter Types
// ============================================

export interface BiconomyIntentParams {
  // Input positions
  inputToken: string; // Token symbol or address
  inputChain: string; // Chain name
  inputAmount: string; // Human-readable amount
  
  // Target positions (can be multiple, comma-separated)
  targetTokens: string; // Token symbols or addresses, comma-separated
  targetChains: string; // Chain names, comma-separated
  targetWeights: string; // Weights as decimals (e.g., "0.6,0.4"), comma-separated
  
  slippage?: number; // Default 0.01 (1%)
}

export interface BiconomySimpleSwapParams {
  srcToken: string;
  srcChain: string;
  dstToken: string;
  dstChain: string;
  amount: string;
  slippage?: number;
}

export interface BiconomyStatusParams {
  supertxHash: string;
}

// ============================================
// Supported Chains
// ============================================

export const BICONOMY_SUPPORTED_CHAINS: Record<string, number> = {
  ethereum: 1,
  base: 8453,
  polygon: 137,
  arbitrum: 42161,
  optimism: 10,
  bsc: 56,
  bnb: 56,
  avalanche: 43114,
  scroll: 534352,
  gnosis: 100,
  sonic: 146,
  linea: 59144,
  blast: 81457,
  sei: 1329,
  unichain: 130,
  worldchain: 480,
  lisk: 1135,
  monad: 2222,
};

export const CHAIN_ID_TO_NAME: Record<number, string> = Object.entries(BICONOMY_SUPPORTED_CHAINS)
  .reduce((acc, [name, id]) => {
    acc[id] = name;
    return acc;
  }, {} as Record<number, string>);

// ============================================
// Token Constants
// ============================================

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

// Common token addresses per chain
export const TOKEN_ADDRESSES: Record<number, Record<string, string>> = {
  // Ethereum Mainnet
  1: {
    eth: ZERO_ADDRESS,
    weth: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    usdt: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
  },
  // Base
  8453: {
    eth: ZERO_ADDRESS,
    weth: '0x4200000000000000000000000000000000000006',
    usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    usdt: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2',
  },
  // Polygon
  137: {
    pol: ZERO_ADDRESS,
    matic: ZERO_ADDRESS,
    weth: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619',
    usdc: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
    usdt: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
  },
  // Arbitrum
  42161: {
    eth: ZERO_ADDRESS,
    weth: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
    usdc: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    usdt: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
  },
  // Optimism
  10: {
    eth: ZERO_ADDRESS,
    weth: '0x4200000000000000000000000000000000000006',
    usdc: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
    usdt: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58',
  },
  // BSC
  56: {
    bnb: ZERO_ADDRESS,
    wbnb: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
    usdc: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
    usdt: '0x55d398326f99059fF775485246999027B3197955',
  },
};
