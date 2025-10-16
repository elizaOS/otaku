import { BaseApiClient } from '../lib/base-client';

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
}

export interface NFTsResponse {
  nfts: NFT[];
  address: string;
}

export interface TransactionHistoryResponse {
  transactions: Transaction[];
  address: string;
}

export interface SendTokenRequest {
  name: string;
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
  name: string;
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
  name: string;
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
  name: string;
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
   * Get token balances across all networks
   */
  async getTokens(name: string): Promise<TokensResponse> {
    const response = await this.get<TokensResponse>(`/api/cdp/wallet/tokens/${name}`);
    return response;
  }

  /**
   * Get NFT holdings across networks
   */
  async getNFTs(name: string): Promise<NFTsResponse> {
    const response = await this.get<NFTsResponse>(`/api/cdp/wallet/nfts/${name}`);
    return response;
  }

  /**
   * Get transaction history across networks
   */
  async getHistory(name: string): Promise<TransactionHistoryResponse> {
    const response = await this.get<TransactionHistoryResponse>(`/api/cdp/wallet/history/${name}`);
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
}
