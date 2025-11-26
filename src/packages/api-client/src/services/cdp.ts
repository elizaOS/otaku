import { BaseApiClient } from '../lib/base-client';
import type { TopAndTrendingTokensRequest, TopAndTrendingTokensResponse } from '../types/cdp';

/**
 * Native token address used by swap protocols
 * This special address represents native tokens (ETH, MATIC, etc.)
 */
export const NATIVE_TOKEN_ADDRESS = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';

export interface Token {
  symbol: string;
  name: string;
  balance: string;
  balanceFormatted: string;
  usdValue: number;
  usdPrice: number;
  contractAddress: string | null;
  chain: string;
  decimals: number;
  icon?: string; // Token icon URL from CoinGecko
}

export interface NFT {
  chain: string;
  contractAddress: string;
  tokenId: string;
  name: string;
  description: string;
  image: string;
  contractName: string;
  tokenType: string;
  balance?: string; // For ERC1155
}

export interface Transaction {
  chain: string;
  hash: string;
  from: string;
  to: string;
  value: string;
  asset: string;
  category: string;
  timestamp: number;
  blockNum: string;
  explorerUrl: string;
  direction: 'sent' | 'received';
}

export interface WalletInfo {
  address: string;
  accountName: string;
}

export interface TokensResponse {
  tokens: Token[];
  totalUsdValue: number;
  address: string;
  fromCache?: boolean;
  synced?: boolean;
}

export interface NFTsResponse {
  nfts: NFT[];
  address: string;
  fromCache?: boolean;
  synced?: boolean;
}

export interface TransactionHistoryResponse {
  transactions: Transaction[];
  address: string;
}

export interface SendTokenRequest {
  network: string;
  to: string;
  token: string;
  amount: string;
}

export interface SendTokenResponse {
  transactionHash: string;
  from: string;
  to: string;
  amount: string;
  token: string;
  network: string;
}

export interface SendNFTRequest {
  network: string;
  to: string;
  contractAddress: string;
  tokenId: string;
}

export interface SendNFTResponse {
  transactionHash: string;
  from: string;
  to: string;
  contractAddress: string;
  tokenId: string;
  network: string;
}

export interface SwapPriceRequest {
  network: string;
  fromToken: string;
  toToken: string;
  fromAmount: string;
}

export interface SwapPriceResponse {
  liquidityAvailable: boolean;
  toAmount: string;
  minToAmount: string;
  fromAmount: string;
  fromToken: string;
  toToken: string;
  network: string;
}

export interface SwapRequest {
  network: string;
  fromToken: string;
  toToken: string;
  fromAmount: string;
  slippageBps: number;
}

export interface SwapResponse {
  transactionHash: string;
  from: string;
  fromToken: string;
  toToken: string;
  fromAmount: string;
  toAmount: string;
  network: string;
  method: string;
}

export interface SearchTokenRequest {
  query: string;
  chain?: string;
}

export interface CoinGeckoToken {
  id: string;
  symbol: string;
  name: string;
  contractAddress: string | null;
  chain: string | null;
  icon: string | null;
  price: number | null;
  platforms?: Record<string, string>;
  decimals?: number;
  marketCap?: number | null;
  volume24h?: number | null;
  priceChange24h?: number | null;
}

export interface SearchTokenResponse {
  tokens: CoinGeckoToken[];
}

/**
 * Service for interacting with CDP wallet endpoints
 */
export class CdpService extends BaseApiClient {
  /**
   * Get or create a server wallet for a user
   */
  async getOrCreateWallet(name: string): Promise<WalletInfo> {
    const response = await this.post<WalletInfo>('/api/cdp/wallet', { name });
    return response;
  }

  /**
   * Get token balances across all networks (uses cache if available)
   * Uses authenticated userId from JWT token
   * @param chain Optional specific chain to fetch (e.g., 'base', 'ethereum', 'polygon')
   */
  async getTokens(chain?: string): Promise<TokensResponse> {
    const params = chain ? `?chain=${encodeURIComponent(chain)}` : '';
    const response = await this.get<TokensResponse>(`/api/cdp/wallet/tokens${params}`);
    return response;
  }

  /**
   * Force sync token balances (bypasses cache)
   * Uses authenticated userId from JWT token
   * @param chain Optional specific chain to fetch (e.g., 'base', 'ethereum', 'polygon')
   */
  async syncTokens(chain?: string): Promise<TokensResponse> {
    const body = chain ? { chain } : {};
    const response = await this.post<TokensResponse>('/api/cdp/wallet/tokens/sync', body);
    return response;
  }

  /**
   * Get NFT holdings across networks (uses cache if available)
   * Uses authenticated userId from JWT token
   * @param chain Optional specific chain to fetch (e.g., 'base', 'ethereum', 'polygon')
   */
  async getNFTs(chain?: string): Promise<NFTsResponse> {
    const params = chain ? `?chain=${encodeURIComponent(chain)}` : '';
    const response = await this.get<NFTsResponse>(`/api/cdp/wallet/nfts${params}`);
    return response;
  }

  /**
   * Force sync NFTs (bypasses cache)
   * Uses authenticated userId from JWT token
   * @param chain Optional specific chain to fetch (e.g., 'base', 'ethereum', 'polygon')
   */
  async syncNFTs(chain?: string): Promise<NFTsResponse> {
    const body = chain ? { chain } : {};
    const response = await this.post<NFTsResponse>('/api/cdp/wallet/nfts/sync', body);
    return response;
  }

  /**
   * Get transaction history across networks
   * Uses authenticated userId from JWT token
   */
  async getHistory(): Promise<TransactionHistoryResponse> {
    const response = await this.get<TransactionHistoryResponse>('/api/cdp/wallet/history');
    return response;
  }

  /**
   * Send tokens from server wallet
   */
  async sendToken(request: SendTokenRequest): Promise<SendTokenResponse> {
    const response = await this.post<SendTokenResponse>('/api/cdp/wallet/send', request);
    return response;
  }

  /**
   * Send NFT from server wallet
   */
  async sendNFT(request: SendNFTRequest): Promise<SendNFTResponse> {
    const response = await this.post<SendNFTResponse>('/api/cdp/wallet/send-nft', request);
    return response;
  }

  /**
   * Get swap price estimate
   */
  async getSwapPrice(request: SwapPriceRequest): Promise<SwapPriceResponse> {
    const response = await this.post<SwapPriceResponse>('/api/cdp/wallet/swap-price', request);
    return response;
  }

  /**
   * Execute token swap
   */
  async swap(request: SwapRequest): Promise<SwapResponse> {
    const response = await this.post<SwapResponse>('/api/cdp/wallet/swap', request);
    return response;
  }

  /**
   * Search for tokens using CoinGecko
   */
  async searchTokens(request: SearchTokenRequest): Promise<SearchTokenResponse> {
    const params = new URLSearchParams();
    params.append('query', request.query);
    if (request.chain) {
      params.append('chain', request.chain);
    }
    const response = await this.get<SearchTokenResponse>(`/api/cdp/tokens/search?${params.toString()}`);
    return response;
  }

  /**
   * Get top tokens by market cap and trending tokens for a specific chain
   */
  async getTopAndTrendingTokens(request: TopAndTrendingTokensRequest): Promise<TopAndTrendingTokensResponse> {
    const params = new URLSearchParams();
    params.append('chain', request.chain);
    if (request.limit) {
      params.append('limit', request.limit.toString());
    }
    const response = await this.get<TopAndTrendingTokensResponse>(`/api/cdp/tokens/top-and-trending?${params.toString()}`);
    return response;
  }
}
