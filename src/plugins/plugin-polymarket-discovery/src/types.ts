/**
 * Polymarket Discovery Plugin Type Definitions
 *
 * Phase 1: Read-only market discovery and analysis
 * No trading capabilities - just market data and pricing
 */

/**
 * Market outcome token (Yes/No binary outcomes)
 */
export interface PolymarketToken {
  token_id: string;
  outcome: "Yes" | "No";
  price?: number;
  winner?: boolean;
}

/**
 * Rewards/Incentives structure for markets
 */
export interface PolymarketRewards {
  min_order_size?: number;
  max_spread?: number;
  event_start_date?: string;
  event_end_date?: string;
  multipliers?: number[];
}

/**
 * Complete market data from Gamma API
 */
export interface PolymarketMarket {
  condition_id: string;           // 66 char hex ID (0x...)
  question: string;                // Market question
  description?: string;            // Detailed description
  market_slug?: string;            // URL-friendly slug
  end_date_iso?: string;           // ISO 8601 end date
  game_start_time?: string;        // ISO 8601 game start
  tokens: PolymarketToken[];       // Yes/No outcome tokens
  rewards?: PolymarketRewards;     // Rewards program data
  active?: boolean;                // Market is active
  closed?: boolean;                // Market is closed
  resolved?: boolean;              // Market has been resolved
  volume?: string;                 // Trading volume (USD)
  liquidity?: string;              // Available liquidity (USD)
  category?: string;               // Market category
  tags?: string[];                 // Market tags
  icon?: string;                   // Icon URL
  image?: string;                  // Image URL
  competitive?: number;            // Competitiveness score (0-5)
  enableOrderBook?: boolean;       // Order book enabled
  neg_risk?: boolean;              // Negative risk market
}

/**
 * Paginated markets response from Gamma API
 */
export interface MarketsResponse {
  limit: number;
  count: number;
  next_cursor?: string;
  data: PolymarketMarket[];
}

/**
 * Order book entry (bid/ask)
 */
export interface OrderBookEntry {
  price: string;      // Price as string (0.01 - 0.99)
  size: string;       // Size as string
}

/**
 * Complete order book for a token
 */
export interface OrderBook {
  timestamp: number;
  market: string;
  asset_id: string;
  bids: OrderBookEntry[];
  asks: OrderBookEntry[];
}

/**
 * Real-time token price from CLOB API
 */
export interface TokenPrice {
  token_id: string;
  price: string;
  best_bid?: string;
  best_ask?: string;
  spread?: string;
  mid_price?: string;
}

/**
 * Market prices for both outcomes
 */
export interface MarketPrices {
  condition_id: string;
  yes_price: string;
  no_price: string;
  yes_price_formatted: string;
  no_price_formatted: string;
  spread: string;
  last_updated: number;
}

/**
 * Search parameters for market discovery
 */
export interface MarketSearchParams {
  query?: string;              // Keyword search
  category?: string;           // Filter by category
  active?: boolean;            // Only active markets
  closed?: boolean;            // Include closed markets
  limit?: number;              // Results limit (default 20)
  offset?: number;             // Pagination offset
}

/**
 * Market category information
 */
export interface MarketCategory {
  name: string;
  count: number;
  description?: string;
}

/**
 * Cached market data with TTL
 */
export interface CachedMarket {
  data: PolymarketMarket;
  timestamp: number;
  ttl: number;
}

/**
 * Cached price data with TTL
 */
export interface CachedPrice {
  data: MarketPrices;
  timestamp: number;
  ttl: number;
}

/**
 * Service configuration
 */
export interface PolymarketServiceConfig {
  gammaApiUrl: string;
  clobApiUrl: string;
  marketCacheTtl: number;     // TTL for market data (default 60s)
  priceCacheTtl: number;      // TTL for price data (default 15s)
  maxRetries: number;         // Max retry attempts (default 3)
  requestTimeout: number;     // Request timeout in ms (default 10000)
}

/**
 * Formatted market for display
 */
export interface FormattedMarket {
  question: string;
  yes_price: string;
  no_price: string;
  volume: string;
  category?: string;
  ends_at?: string;
  condition_id: string;
}

/**
 * Historical price data point
 */
export interface PriceHistoryPoint {
  t: number;  // Unix timestamp
  p: string;  // Price as string (0.01 - 0.99)
}

/**
 * Price history response from CLOB API
 */
export interface PriceHistoryResponse {
  history: PriceHistoryPoint[];
}

/**
 * Formatted price history for charting
 */
export interface MarketPriceHistory {
  condition_id: string;
  outcome: "YES" | "NO";
  token_id: string;
  interval: string;
  data_points: Array<{
    timestamp: number;
    price: number;
  }>;
  current_price?: number;
  market_question?: string;
}

/**
 * API error response
 */
export interface PolymarketError {
  message: string;
  code?: string;
  statusCode?: number;
  details?: unknown;
}
