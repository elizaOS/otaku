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
 * Note: API returns camelCase fields
 */
export interface PolymarketMarket {
  conditionId: string;             // 66 char hex ID (0x...) - API returns camelCase
  question: string;                // Market question
  description?: string;            // Detailed description
  slug?: string;                   // URL-friendly slug - API returns camelCase
  endDateIso?: string;             // ISO 8601 end date - API returns camelCase
  game_start_time?: string;        // ISO 8601 game start
  clobTokenIds?: string;           // CLOB token IDs (comma-separated) - API returns camelCase
  tokens?: PolymarketToken[];      // Yes/No outcome tokens (if available)
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
  // Snake_case aliases added by mapApiMarketToInterface
  condition_id?: string;           // Alias for conditionId
  end_date_iso?: string;           // Alias for endDateIso
  market_slug?: string;            // Alias for slug
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
  hash?: string;
}

/**
 * Phase 3A: Orderbook summary with calculated metrics
 */
export interface OrderbookSummary {
  token_id: string;
  market: string;
  asset_id: string;
  timestamp: number;
  hash?: string;
  bids: OrderBookEntry[];
  asks: OrderBookEntry[];
  best_bid?: string;
  best_ask?: string;
  spread?: string;
  mid_price?: string;
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
    date: string; // Formatted date for UI display (e.g., "Jan 15")
  }>;
  current_price?: number;
  market_question?: string;
  /** Statistics computed from the data - useful for agent context without full data */
  statistics?: PriceHistoryStatistics;
}

/**
 * Summary statistics for price history data
 * Allows agent to understand the data without seeing all points
 */
export interface PriceHistoryStatistics {
  /** Number of data points returned */
  data_points_count: number;
  /** Original number of points before downsampling (if applicable) */
  original_count?: number;
  /** Whether the data was downsampled */
  was_downsampled: boolean;
  /** Price at the start of the period */
  start_price: number;
  /** Price at the end of the period (current) */
  end_price: number;
  /** Highest price in the period */
  high_price: number;
  /** Lowest price in the period */
  low_price: number;
  /** Average price in the period */
  avg_price: number;
  /** Start timestamp (ms) */
  start_timestamp: number;
  /** End timestamp (ms) */
  end_timestamp: number;
  /** Price change (absolute) */
  price_change: number;
  /** Price change (percentage) */
  price_change_percent: number;
  /** Trend direction: "up", "down", or "stable" */
  trend: "up" | "down" | "stable";
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

/**
 * Phase 2: Portfolio Tracking Types
 */

/**
 * Proxy wallet configuration
 */
export interface ProxyWalletConfig {
  gnosisProxyFactory: string;  // Gnosis Safe proxy factory address
  customProxyFactory?: string;  // Custom proxy factory (if needed)
}

/**
 * User position in a market (matches Polymarket Data API response)
 */
export interface Position {
  proxyWallet: string;         // User's proxy wallet address
  asset: string;               // Token ID
  conditionId: string;         // Condition ID
  size: number;                // Position size
  avgPrice: number;            // Average entry price
  initialValue: number;        // Initial investment value
  currentValue: number;        // Current position value in USD
  cashPnl: number;             // Cash profit/loss (unrealized)
  percentPnl: number;          // PnL as percentage
  totalBought: number;         // Total amount bought
  realizedPnl: number;         // Realized profit/loss
  percentRealizedPnl: number;  // Realized PnL as percentage
  curPrice: number;            // Current market price
  redeemable: boolean;         // Can be redeemed
  mergeable: boolean;          // Can be merged
  title: string;               // Market title
  slug: string;                // Market slug
  icon: string;                // Market icon URL
  eventId: string;             // Event ID
  eventSlug: string;           // Event slug
  outcome: string;             // "Yes" or "No"
  outcomeIndex: number;        // 0 or 1
  oppositeOutcome: string;     // Opposite outcome name
  oppositeAsset: string;       // Opposite token ID
  endDate: string;             // Market end date
  negativeRisk: boolean;       // Negative risk flag
}

/**
 * User balance information
 */
export interface Balance {
  total_value: string;         // Total portfolio value in USD
  available_balance: string;   // Available USDC balance
  positions_value: string;     // Value locked in positions
  realized_pnl: string;        // Realized profit/loss
  unrealized_pnl: string;      // Unrealized profit/loss
  timestamp?: number;          // Data timestamp
}

/**
 * Trade history entry
 */
export interface Trade {
  id: string;                  // Trade ID
  market: string;              // Market identifier
  condition_id: string;        // Condition ID
  asset_id: string;            // Token ID
  outcome: "YES" | "NO";       // Outcome traded
  side: "BUY" | "SELL";        // Trade side
  size: string;                // Trade size
  price: string;               // Execution price
  timestamp: number;           // Unix timestamp
  transaction_hash?: string;   // On-chain tx hash
}

/**
 * Phase 3B: Market Analytics Types
 */

/**
 * Open interest data for market-wide exposure metrics
 */
export interface OpenInterestData {
  total_value: string;         // Total value locked across all markets
  markets_count?: number;      // Number of active markets
  timestamp?: number;          // Data timestamp
}

/**
 * Live volume data for real-time trading activity
 */
export interface VolumeData {
  total_volume_24h: string;    // 24h volume across all markets
  markets?: Array<{
    condition_id: string;      // Market identifier
    volume: string;            // Market-specific volume
    question?: string;         // Market question
  }>;
  timestamp?: number;          // Data timestamp
}

/**
 * Spread data for bid-ask analysis
 */
export interface SpreadData {
  condition_id: string;        // Market identifier
  spread: string;              // Bid-ask spread
  spread_percentage: string;   // Spread as percentage
  best_bid: string;            // Best bid price
  best_ask: string;            // Best ask price
  question?: string;           // Market question
  liquidity_score?: number;    // Liquidity quality score (0-100)
}

/**
 * Phase 4: Events API Types
 */

/**
 * Tag structure from Polymarket API
 */
export interface PolymarketTag {
  id: string;                  // Tag ID
  label: string;               // Tag display label
  slug: string;                // URL-friendly slug
}

/**
 * Polymarket Event (higher-level grouping of markets)
 */
export interface PolymarketEvent {
  id: string;                  // Event ID
  slug?: string;               // URL-friendly slug
  title: string;               // Event title
  description?: string;        // Event description
  start_date?: string;         // ISO 8601 start date
  end_date?: string;           // ISO 8601 end date
  image?: string;              // Event image URL
  icon?: string;               // Event icon URL
  active?: boolean;            // Event is active
  closed?: boolean;            // Event is closed
  archived?: boolean;          // Event is archived
  tags?: PolymarketTag[];      // Event tags
  markets?: PolymarketMarket[]; // Associated markets (only in detail view)
  market_count?: number;       // Number of markets in event
}

/**
 * Event detail response (includes associated markets)
 */
export interface PolymarketEventDetail extends PolymarketEvent {
  markets: PolymarketMarket[];  // Full list of markets for this event
}

/**
 * Event filters for browsing
 */
export interface EventFilters {
  active?: boolean;            // Filter by active status
  closed?: boolean;            // Include closed events
  tag?: string;                // Filter by tag
  limit?: number;              // Results limit (default 20)
  offset?: number;             // Pagination offset
}
/**
 * Phase 5A: Extended Portfolio Types
 */

/**
 * Closed position (resolved market)
 */
export interface ClosedPosition {
  market: string;              // Market identifier
  condition_id: string;        // Condition ID
  asset_id: string;            // Token ID
  outcome: "YES" | "NO";       // Outcome position
  size: string;                // Position size
  avg_price: string;           // Average entry price
  settlement_price: string;    // Final settlement price (0 or 1)
  pnl: string;                 // Realized profit/loss
  pnl_percentage: string;      // PnL as percentage
  closed_at: number;           // Unix timestamp of settlement
  payout: string;              // Total payout received
  won: boolean;                // True if position won
}

/**
 * User activity entry (on-chain events)
 */
export interface UserActivity {
  id: string;                  // Activity ID
  type: "DEPOSIT" | "WITHDRAWAL" | "TRADE" | "REDEMPTION"; // Activity type
  amount: string;              // Amount in USDC
  timestamp: number;           // Unix timestamp
  transaction_hash: string;    // On-chain tx hash
  market?: string;             // Related market (for trades)
  outcome?: "YES" | "NO";      // Related outcome (for trades)
  status: "CONFIRMED" | "PENDING"; // Transaction status
}

/**
 * Top holder in a market
 */
export interface TopHolder {
  address: string;             // Wallet address (may be anonymized)
  outcome: "YES" | "NO";       // Outcome held
  size: string;                // Position size
  value: string;               // Current value in USD
  percentage: string;          // % of total market liquidity
  is_public: boolean;          // Whether wallet is publicly identified
}

