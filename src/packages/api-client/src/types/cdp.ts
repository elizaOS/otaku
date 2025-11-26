/**
 * CDP wallet request
 */
export interface WalletRequest {
  name: string;
}

/**
 * CDP wallet response
 */
export interface WalletResponse {
  address: string;
  accountName: string;
}

/**
 * Request for top and trending tokens
 */
export interface TopAndTrendingTokensRequest {
  chain: string;
  limit?: number;
}

/**
 * Response for top and trending tokens
 */
export interface TopAndTrendingTokensResponse {
  topTokens: any[];
  trendingTokens: any[];
}

