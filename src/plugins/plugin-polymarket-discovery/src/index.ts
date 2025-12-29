/**
 * Polymarket Discovery Plugin
 *
 * Phase 1: Read-only market discovery and analysis
 * - Browse trending/active markets
 * - Search by keyword or category
 * - Get detailed market information
 * - Check real-time pricing
 * - List available categories
 *
 * No trading capabilities in Phase 1 - just data discovery
 */

import type { Plugin } from "@elizaos/core";

// Services
import { PolymarketService } from "./services/polymarket.service";

// Actions
import { getActiveMarketsAction } from "./actions/getActiveMarkets.action";
import { searchMarketsAction } from "./actions/searchMarkets.action";
import { getMarketDetailAction } from "./actions/getMarketDetail.action";
import { getMarketPriceAction } from "./actions/getMarketPrice.action";
import { getMarketCategoriesAction } from "./actions/getMarketCategories.action";
import { getMarketPriceHistoryAction } from "./actions/getMarketPriceHistory.action";

// Types
export type * from "./types";

/**
 * Polymarket Discovery Plugin
 *
 * Provides read-only access to Polymarket prediction markets:
 * - GET_ACTIVE_POLYMARKETS: View trending markets
 * - SEARCH_POLYMARKETS: Search by keyword/category
 * - GET_POLYMARKET_DETAIL: Detailed market info
 * - GET_POLYMARKET_PRICE: Real-time pricing
 * - GET_POLYMARKET_PRICE_HISTORY: Historical price charts
 * - GET_POLYMARKET_CATEGORIES: List categories
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
    "Polymarket prediction markets discovery plugin for browsing and analyzing prediction markets (read-only, no trading)",
  evaluators: [],
  providers: [],
  actions: [
    getActiveMarketsAction,
    searchMarketsAction,
    getMarketDetailAction,
    getMarketPriceAction,
    getMarketPriceHistoryAction,
    getMarketCategoriesAction,
  ],
  services: [PolymarketService],
};

export default polymarketDiscoveryPlugin;
