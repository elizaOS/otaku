/**
 * Polymarket Discovery Plugin
 *
 * Phase 1: Read-only market discovery and analysis
 * - Browse trending/active markets
 * - Search by keyword or category
 * - Get detailed market information
 * - Check real-time pricing
 * - List available categories
 * - View price history charts
 *
 * Phase 2: Portfolio tracking
 * - Get user positions across markets
 * - Check portfolio balance and P&L
 * - View trade history
 *
 * No trading capabilities - read-only data access
 */

import type { Plugin } from "@elizaos/core";

// Services
import { PolymarketService } from "./services/polymarket.service";

// Phase 1: Market Discovery Actions
import { getActiveMarketsAction } from "./actions/getActiveMarkets.action";
import { searchMarketsAction } from "./actions/searchMarkets.action";
import { getMarketDetailAction } from "./actions/getMarketDetail.action";
import { getMarketPriceAction } from "./actions/getMarketPrice.action";
import { getMarketCategoriesAction } from "./actions/getMarketCategories.action";
import { getMarketPriceHistoryAction } from "./actions/getMarketPriceHistory.action";

// Phase 2: Portfolio Tracking Actions
import { getUserPositionsAction } from "./actions/getUserPositions.action";
import { getUserBalanceAction } from "./actions/getUserBalance.action";
import { getUserTradeHistoryAction } from "./actions/getUserTradeHistory.action";

// Phase 3A: Orderbook Actions
import { getOrderbookAction } from "./actions/getOrderbook.action";
import { getOrderbooksAction } from "./actions/getOrderbooks.action";

// Phase 3B: Market Analytics Actions
import { getOpenInterestAction } from "./actions/getOpenInterest.action";
import { getLiveVolumeAction } from "./actions/getLiveVolume.action";
import { getSpreadsAction } from "./actions/getSpreads.action";

// Phase 4: Events API Actions
import { getEventsAction } from "./actions/getEvents.action";
import { getEventDetailAction } from "./actions/getEventDetail.action";

// Phase 5A: Extended Portfolio Actions
import { getClosedPositionsAction } from "./actions/getClosedPositions.action";
import { getUserActivityAction } from "./actions/getUserActivity.action";
import { getTopHoldersAction } from "./actions/getTopHolders.action";

// Context Matcher
export { shouldPolymarketPluginBeInContext, polymarketKeywordPatterns } from "../matcher";

// Types
export type * from "./types";

/**
 * Polymarket Discovery Plugin
 *
 * Provides read-only access to Polymarket prediction markets:
 *
 * Phase 1 - Market Discovery:
 * - GET_ACTIVE_POLYMARKETS: View trending markets
 * - SEARCH_POLYMARKETS: Search by keyword/category
 * - GET_POLYMARKET_DETAIL: Detailed market info
 * - GET_POLYMARKET_PRICE: Real-time pricing
 * - GET_POLYMARKET_PRICE_HISTORY: Historical price charts
 * - GET_POLYMARKET_CATEGORIES: List categories
 *
 * Phase 2 - Portfolio Tracking:
 * - GET_POLYMARKET_POSITIONS: User positions across markets
 * - GET_POLYMARKET_BALANCE: Portfolio balance and P&L
 * - GET_POLYMARKET_TRADE_HISTORY: Trade history
 *
 * Phase 3A - Orderbook Actions:
 * - GET_POLYMARKET_ORDERBOOK: Single token orderbook with depth
 * - GET_POLYMARKET_ORDERBOOKS: Multiple token orderbooks (batch)
 *
 * Phase 3B - Market Analytics:
 * - GET_POLYMARKET_OPEN_INTEREST: Market-wide exposure metrics
 * - GET_POLYMARKET_LIVE_VOLUME: Real-time trading volume
 * - GET_POLYMARKET_SPREADS: Bid-ask spread analysis
 *
 * Phase 4 - Events API:
 * - GET_POLYMARKET_EVENTS: Browse prediction events
 * - GET_POLYMARKET_EVENT_DETAIL: Event-specific data with markets
 *
 * Phase 5A - Extended Portfolio:
 * - GET_POLYMARKET_CLOSED_POSITIONS: Historical resolved positions
 * - GET_POLYMARKET_USER_ACTIVITY: On-chain activity log
 * - GET_POLYMARKET_TOP_HOLDERS: Major participants in market
 *
 * Configuration:
 * - POLYMARKET_GAMMA_API_URL (optional): Gamma API endpoint (default: https://gamma-api.polymarket.com)
 * - POLYMARKET_CLOB_API_URL (optional): CLOB API endpoint (default: https://clob.polymarket.com)
 * - POLYMARKET_MARKET_CACHE_TTL (optional): Market cache TTL in ms (default: 60000)
 * - POLYMARKET_PRICE_CACHE_TTL (optional): Price cache TTL in ms (default: 15000)
 * - POLYMARKET_MAX_RETRIES (optional): Max retry attempts (default: 3)
 * - POLYMARKET_REQUEST_TIMEOUT (optional): Request timeout in ms (default: 10000)
 */
export const polymarketDiscoveryPlugin: Plugin = {
  name: "polymarket-discovery",
  description:
    "Polymarket prediction markets plugin - browse markets, track portfolio, analyze positions (read-only, no trading)",
  evaluators: [],
  providers: [],
  actions: [
    // Phase 1: Market Discovery
    getActiveMarketsAction,
    searchMarketsAction,
    getMarketDetailAction,
    getMarketPriceAction,
    getMarketPriceHistoryAction,
    getMarketCategoriesAction,
    // Phase 2: Portfolio Tracking
    getUserPositionsAction,
    getUserBalanceAction,
    getUserTradeHistoryAction,
    // Phase 3A: Orderbook Actions
    getOrderbookAction,
    getOrderbooksAction,
    // Phase 3B: Market Analytics
    getOpenInterestAction,
    getLiveVolumeAction,
    getSpreadsAction,
    // Phase 4: Events API
    getEventsAction,
    getEventDetailAction,
    // Phase 5A: Extended Portfolio
    getClosedPositionsAction,
    getUserActivityAction,
    getTopHoldersAction,
  ],
  services: [PolymarketService],
};

export default polymarketDiscoveryPlugin;
