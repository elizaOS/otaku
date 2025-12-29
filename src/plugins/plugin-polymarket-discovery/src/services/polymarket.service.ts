/**
 * Polymarket Discovery Service
 *
 * Provides market discovery and pricing data via:
 * - Gamma API: Market metadata, categories, search
 * - CLOB API: Real-time orderbook and pricing
 *
 * Features:
 * - In-memory caching with TTL
 * - Retry with exponential backoff
 * - AbortController for timeouts
 * - No authentication required (read-only)
 */

import { type IAgentRuntime, Service, ServiceType, logger } from "@elizaos/core";
import { getProxyWalletAddress } from "@polymarket/sdk";
import type {
  PolymarketMarket,
  MarketsResponse,
  MarketPrices,
  OrderBook,
  OrderbookSummary,
  MarketSearchParams,
  MarketCategory,
  CachedMarket,
  CachedPrice,
  PolymarketServiceConfig,
  PriceHistoryResponse,
  MarketPriceHistory,
  Position,
  Balance,
  Trade,
  PolymarketEvent,
  PolymarketEventDetail,
  EventFilters,
  ClosedPosition,
  UserActivity,
  TopHolder,
  OpenInterestData,
  VolumeData,
  SpreadData,
} from "../types";

export class PolymarketService extends Service {
  static serviceType = "POLYMARKET_DISCOVERY_SERVICE" as const;
  capabilityDescription = "Discover and fetch real-time pricing data for Polymarket prediction markets.";

  // API endpoints
  private gammaApiUrl: string = "https://gamma-api.polymarket.com";
  private clobApiUrl: string = "https://clob.polymarket.com";
  private dataApiUrl: string = "https://data-api.polymarket.com";

  // Proxy wallet constants
  private readonly GNOSIS_PROXY_FACTORY = "0xaB45c5A4B0c941a2F231C04C3f49182e1A254052";
  private readonly POLYGON_CHAIN_ID = 137;

  // Cache configuration
  private marketCacheTtl: number = 60000; // 1 minute
  private priceCacheTtl: number = 15000; // 15 seconds
  private priceHistoryCacheTtl: number = 300000; // 5 minutes (historical data changes less frequently)
  private positionsCacheTtl: number = 60000; // 1 minute
  private tradesCacheTtl: number = 30000; // 30 seconds
  private eventCacheTtl: number = 60000; // 1 minute (event data stable)
  private analyticsCacheTtl: number = 30000; // 30 seconds (analytics change less frequently)
  private closedPositionsCacheTtl: number = 60000; // 1 minute (historical data stable)
  private userActivityCacheTtl: number = 60000; // 1 minute (historical data stable)
  private topHoldersCacheTtl: number = 60000; // 1 minute (historical data stable)
  private maxRetries: number = 3;
  private requestTimeout: number = 10000; // 10 seconds
  private maxMarketCacheSize: number = 100; // Max markets in cache
  private maxPriceCacheSize: number = 200; // Max prices in cache
  private maxPriceHistoryCacheSize: number = 50; // Max price histories in cache
  private maxEventCacheSize: number = 50; // Max events in cache

  // In-memory LRU caches
  private marketCache: Map<string, CachedMarket> = new Map();
  private marketCacheOrder: string[] = []; // Track access order for LRU
  private priceCache: Map<string, CachedPrice> = new Map();
  private priceCacheOrder: string[] = []; // Track access order for LRU
  private priceHistoryCache: Map<string, { data: MarketPriceHistory; timestamp: number }> = new Map();
  private priceHistoryCacheOrder: string[] = []; // Track access order for LRU
  private positionsCache: Map<string, { data: Position[]; timestamp: number }> = new Map();
  private positionsCacheOrder: string[] = []; // Track access order for LRU
  private tradesCache: Map<string, { data: Trade[]; timestamp: number }> = new Map();
  private tradesCacheOrder: string[] = []; // Track access order for LRU
  private eventsCache: Map<string, { data: PolymarketEventDetail; timestamp: number }> = new Map();
  private eventsCacheOrder: string[] = []; // Track access order for LRU
  private eventsListCache: { data: PolymarketEvent[]; timestamp: number } | null = null;
  private marketsListCache: { data: PolymarketMarket[]; timestamp: number } | null = null;

  // Phase 3B: Analytics caches
  private openInterestCache: { data: OpenInterestData; timestamp: number } | null = null;
  private liveVolumeCache: { data: VolumeData; timestamp: number } | null = null;
  private spreadsCache: { data: SpreadData[]; timestamp: number } | null = null;

  // Phase 5A: Extended portfolio caches
  private closedPositionsCache: Map<string, { data: ClosedPosition[]; timestamp: number }> = new Map();
  private closedPositionsCacheOrder: string[] = []; // Track access order for LRU
  private userActivityCache: Map<string, { data: UserActivity[]; timestamp: number }> = new Map();
  private userActivityCacheOrder: string[] = []; // Track access order for LRU
  private topHoldersCache: Map<string, { data: TopHolder[]; timestamp: number }> = new Map();
  private topHoldersCacheOrder: string[] = []; // Track access order for LRU

  constructor(runtime: IAgentRuntime) {
    super(runtime);
  }

  async initialize(runtime: IAgentRuntime): Promise<void> {
    // Load configuration with defaults and type guards
    this.gammaApiUrl = runtime.getSetting("POLYMARKET_GAMMA_API_URL") as string || "https://gamma-api.polymarket.com";
    this.clobApiUrl = runtime.getSetting("POLYMARKET_CLOB_API_URL") as string || "https://clob.polymarket.com";

    // Safe parsing with validation
    const marketCacheTtlSetting = runtime.getSetting("POLYMARKET_MARKET_CACHE_TTL") as string;
    this.marketCacheTtl = marketCacheTtlSetting ? Number(marketCacheTtlSetting) : 60000;
    if (isNaN(this.marketCacheTtl) || this.marketCacheTtl <= 0) {
      this.marketCacheTtl = 60000; // Default 1 minute
    }

    const priceCacheTtlSetting = runtime.getSetting("POLYMARKET_PRICE_CACHE_TTL") as string;
    this.priceCacheTtl = priceCacheTtlSetting ? Number(priceCacheTtlSetting) : 15000;
    if (isNaN(this.priceCacheTtl) || this.priceCacheTtl <= 0) {
      this.priceCacheTtl = 15000; // Default 15 seconds
    }

    const maxRetriesSetting = runtime.getSetting("POLYMARKET_MAX_RETRIES") as string;
    this.maxRetries = maxRetriesSetting ? Number(maxRetriesSetting) : 3;
    if (isNaN(this.maxRetries) || this.maxRetries < 0) {
      this.maxRetries = 3; // Default 3 retries
    }

    const requestTimeoutSetting = runtime.getSetting("POLYMARKET_REQUEST_TIMEOUT") as string;
    this.requestTimeout = requestTimeoutSetting ? Number(requestTimeoutSetting) : 10000;
    if (isNaN(this.requestTimeout) || this.requestTimeout <= 0) {
      this.requestTimeout = 10000; // Default 10 seconds
    }

    logger.info(`[PolymarketService] Initialized with Gamma API: ${this.gammaApiUrl}, CLOB API: ${this.clobApiUrl}`);
  }

  static async start(runtime: IAgentRuntime): Promise<PolymarketService> {
    const service = new PolymarketService(runtime);
    await service.initialize(runtime);
    return service;
  }

  async stop(): Promise<void> {
    this.clearCache();
  }

  /**
   * LRU cache helper: Update access order for a key
   */
  private updateCacheOrder(key: string, order: string[]): void {
    const index = order.indexOf(key);
    if (index > -1) {
      order.splice(index, 1);
    }
    order.push(key); // Most recently used at the end
  }

  /**
   * LRU cache helper: Evict oldest entry if cache exceeds max size
   */
  private evictIfNeeded(cache: Map<string, any>, order: string[], maxSize: number): void {
    while (cache.size >= maxSize && order.length > 0) {
      const oldestKey = order.shift(); // Remove least recently used (first in array)
      if (oldestKey) {
        cache.delete(oldestKey);
        logger.debug(`[PolymarketService] Evicted cache entry: ${oldestKey}`);
      }
    }
  }

  /**
   * LRU cache helper: Get from cache and update access order
   */
  private getCached<T>(
    key: string,
    cache: Map<string, T>,
    order: string[],
    ttl: number
  ): T | null {
    const cached = cache.get(key);
    if (!cached) {
      return null;
    }

    // Check TTL
    const cachedItem = cached as any;
    const age = Date.now() - cachedItem.timestamp;
    if (age >= ttl) {
      cache.delete(key);
      const index = order.indexOf(key);
      if (index > -1) {
        order.splice(index, 1);
      }
      return null;
    }

    // Update access order
    this.updateCacheOrder(key, order);
    return cached;
  }

  /**
   * LRU cache helper: Set in cache with LRU eviction
   */
  private setCached<T>(
    key: string,
    value: T,
    cache: Map<string, T>,
    order: string[],
    maxSize: number
  ): void {
    this.evictIfNeeded(cache, order, maxSize);
    cache.set(key, value);
    this.updateCacheOrder(key, order);
  }

  /**
   * Fetch with timeout using AbortController
   */
  private async fetchWithTimeout(url: string, options: RequestInit = {}): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.requestTimeout);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      if ((error as Error).name === "AbortError") {
        throw new Error(`Request timeout after ${this.requestTimeout}ms: ${url}`);
      }
      throw error;
    }
  }

  /**
   * Retry with exponential backoff
   */
  private async retryFetch<T>(
    fn: () => Promise<T>,
    retries: number = this.maxRetries
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error as Error;
        const isLastAttempt = attempt === retries - 1;

        if (isLastAttempt) {
          break;
        }

        // Exponential backoff: 1s, 2s, 4s
        const backoffMs = Math.pow(2, attempt) * 1000;
        logger.warn(
          `[PolymarketService] Attempt ${attempt + 1}/${retries} failed: ${lastError.message}. Retrying in ${backoffMs}ms...`
        );
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }

    throw lastError || new Error("Retry failed with unknown error");
  }

  /**
   * Parse clobTokenIds JSON string into tokens array
   *
   * Transforms API response from:
   *   { clobTokenIds: "[\"123\", \"456\"]", outcomes: "[\"Yes\", \"No\"]", outcomePrices: "[\"0.5\", \"0.5\"]" }
   * Into:
   *   { tokens: [{ token_id: "123", outcome: "Yes", price: 0.5 }, { token_id: "456", outcome: "No", price: 0.5 }] }
   */
  private parseTokens(market: any): any {
    if (!market.clobTokenIds) return market;
    try {
      const tokenIds = JSON.parse(market.clobTokenIds);
      const outcomes = market.outcomes ? JSON.parse(market.outcomes) : [];
      const prices = market.outcomePrices ? JSON.parse(market.outcomePrices) : [];

      market.tokens = tokenIds.map((id: string, i: number) => ({
        token_id: id,
        outcome: outcomes[i],
        price: prices[i] ? parseFloat(prices[i]) : undefined
      }));
    } catch (e) {
      logger.warn(`[PolymarketService] Failed to parse tokens for market ${market.conditionId}: ${e instanceof Error ? e.message : String(e)}`);
    }
    return market;
  }

  /**
   * Get active/trending markets from Gamma API
   */
  async getActiveMarkets(limit: number = 20): Promise<PolymarketMarket[]> {
    logger.info(`[PolymarketService] Fetching ${limit} active markets`);

    // Check cache
    if (this.marketsListCache) {
      const age = Date.now() - this.marketsListCache.timestamp;
      if (age < this.marketCacheTtl) {
        logger.debug(`[PolymarketService] Returning cached markets list (age: ${age}ms)`);
        return this.marketsListCache.data.slice(0, limit);
      }
    }

    return this.retryFetch(async () => {
      const url = `${this.gammaApiUrl}/markets?limit=${limit}&active=true&closed=false`;
      const response = await this.fetchWithTimeout(url);

      if (!response.ok) {
        throw new Error(`Gamma API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as PolymarketMarket[];

      // Parse tokens from JSON strings
      const marketsWithTokens = data.map(market => this.parseTokens(market));

      // Update cache
      this.marketsListCache = {
        data: marketsWithTokens,
        timestamp: Date.now(),
      };

      logger.info(`[PolymarketService] Fetched ${marketsWithTokens.length} active markets`);
      return marketsWithTokens;
    });
  }

  /**
   * Search markets by keyword or category
   *
   * LIMITATION: Gamma API does not provide a server-side search endpoint.
   * This method fetches markets based on pagination params and filters client-side.
   * For better performance with large result sets, consider:
   * - Using smaller limit values to reduce payload size
   * - Caching results when searching the same criteria repeatedly
   * - Using specific category filters to narrow results server-side
   *
   * @param params - Search parameters including query, category, active status, and pagination
   * @returns Filtered array of markets matching search criteria
   */
  async searchMarkets(params: MarketSearchParams): Promise<PolymarketMarket[]> {
    const { query, category, active = true, limit = 20, offset = 0 } = params;
    logger.info(`[PolymarketService] Searching markets: query="${query}", category="${category}", limit=${limit}`);

    return this.retryFetch(async () => {
      // Build query parameters
      const queryParams = new URLSearchParams();
      queryParams.set("limit", limit.toString());
      queryParams.set("offset", offset.toString());

      if (active !== undefined) {
        queryParams.set("active", active.toString());
      }

      // NOTE: Gamma API doesn't provide server-side text search or category filtering.
      // We fetch based on pagination params and filter client-side.
      // This is a limitation of the Gamma API, not our implementation.
      const url = `${this.gammaApiUrl}/markets?${queryParams.toString()}`;
      const response = await this.fetchWithTimeout(url);

      if (!response.ok) {
        throw new Error(`Gamma API error: ${response.status} ${response.statusText}`);
      }

      let markets = await response.json() as PolymarketMarket[];

      // Parse tokens from JSON strings
      markets = markets.map(market => this.parseTokens(market));

      // Client-side filtering by query text
      if (query) {
        const lowerQuery = query.toLowerCase();
        markets = markets.filter(
          (m) =>
            m.question?.toLowerCase().includes(lowerQuery) ||
            m.description?.toLowerCase().includes(lowerQuery) ||
            m.tags?.some((tag) => tag.toLowerCase().includes(lowerQuery))
        );
      }

      // Client-side filtering by category
      if (category) {
        const lowerCategory = category.toLowerCase();
        markets = markets.filter(
          (m) => m.category?.toLowerCase() === lowerCategory
        );
      }

      logger.info(`[PolymarketService] Found ${markets.length} markets matching search criteria`);
      return markets;
    });
  }

  /**
   * Get detailed market information by condition ID
   *
   * LIMITATION: Gamma API does not provide a single-market endpoint by condition_id.
   * This method fetches all markets and filters client-side to find the requested market.
   * Results are cached using LRU eviction to minimize repeated full-list fetches.
   *
   * OPTIMIZATION: Individual markets are cached by conditionId, so subsequent requests
   * for the same market will hit the cache instead of fetching the entire markets list.
   *
   * @param conditionId - The unique condition ID for the market
   * @returns Market details
   * @throws Error if market is not found
   */
  async getMarketDetail(conditionId: string): Promise<PolymarketMarket> {
    logger.info(`[PolymarketService] Fetching market detail: ${conditionId}`);

    // Check LRU cache
    const cached = this.getCached(
      conditionId,
      this.marketCache,
      this.marketCacheOrder,
      this.marketCacheTtl
    );

    if (cached) {
      logger.debug(`[PolymarketService] Returning cached market (conditionId: ${conditionId})`);
      return cached.data;
    }

    return this.retryFetch(async () => {
      // NOTE: Gamma API does not provide a /markets/:conditionId endpoint.
      // We must fetch the full markets list and filter client-side.
      // This is a known limitation of the Gamma API.
      const url = `${this.gammaApiUrl}/markets`;
      const response = await this.fetchWithTimeout(url);

      if (!response.ok) {
        throw new Error(`Gamma API error: ${response.status} ${response.statusText}`);
      }

      const markets = await response.json() as PolymarketMarket[];
      const market = markets.find((m) => m.conditionId === conditionId);

      if (!market) {
        throw new Error(`Market not found: ${conditionId}`);
      }

      // Parse tokens from JSON strings
      const marketWithTokens = this.parseTokens(market);

      // Update LRU cache
      this.setCached(
        conditionId,
        {
          data: marketWithTokens,
          timestamp: Date.now(),
          ttl: this.marketCacheTtl,
        },
        this.marketCache,
        this.marketCacheOrder,
        this.maxMarketCacheSize
      );

      logger.info(`[PolymarketService] Fetched market: ${marketWithTokens.question}`);
      return marketWithTokens;
    });
  }

  /**
   * Get real-time market prices from CLOB API
   *
   * Fetches orderbook data for both YES and NO tokens and extracts best ask prices.
   * Results are cached with shorter TTL than market metadata for near-real-time updates.
   *
   * @param conditionId - The unique condition ID for the market
   * @returns Current market prices with spread calculation
   */
  async getMarketPrices(conditionId: string): Promise<MarketPrices> {
    logger.info(`[PolymarketService] Fetching prices for market: ${conditionId}`);

    // Check LRU cache
    const cached = this.getCached(
      conditionId,
      this.priceCache,
      this.priceCacheOrder,
      this.priceCacheTtl
    );

    if (cached) {
      logger.debug(`[PolymarketService] Returning cached prices (conditionId: ${conditionId})`);
      return cached.data;
    }

    return this.retryFetch(async () => {
      // First get market to find token IDs
      const market = await this.getMarketDetail(conditionId);

      if (!market.tokens || market.tokens.length < 2) {
        throw new Error(`Market ${conditionId} has invalid token structure`);
      }

      const yesToken = market.tokens.find((t) => t.outcome === "Yes");
      const noToken = market.tokens.find((t) => t.outcome === "No");

      if (!yesToken || !noToken) {
        throw new Error(`Market ${conditionId} missing Yes/No tokens`);
      }

      // Fetch orderbooks for both tokens in parallel
      const [yesBook, noBook] = await Promise.all([
        this.getOrderBook(yesToken.token_id),
        this.getOrderBook(noToken.token_id),
      ]);

      // Extract best bid/ask prices
      // FALLBACK: If orderbook is empty (no liquidity), default to 50/50 (0.50)
      // This represents maximum uncertainty when no market makers are providing quotes
      const yesPrice = yesBook.asks[0]?.price || "0.50";
      const noPrice = noBook.asks[0]?.price || "0.50";

      // Log warning if using fallback prices (indicates low/no liquidity)
      if (!yesBook.asks[0]?.price || !noBook.asks[0]?.price) {
        logger.warn(
          `[PolymarketService] Empty orderbook for market ${conditionId}, ` +
          `using fallback 50/50 prices (YES: ${yesBook.asks[0]?.price ? 'has price' : 'NO LIQUIDITY'}, ` +
          `NO: ${noBook.asks[0]?.price ? 'has price' : 'NO LIQUIDITY'})`
        );
      }

      // Calculate spread (difference between yes and no prices)
      const yesPriceNum = parseFloat(yesPrice);
      const noPriceNum = parseFloat(noPrice);
      const spread = Math.abs(yesPriceNum - noPriceNum).toFixed(4);

      const prices: MarketPrices = {
        condition_id: conditionId,
        yes_price: yesPrice,
        no_price: noPrice,
        yes_price_formatted: `${(yesPriceNum * 100).toFixed(1)}%`,
        no_price_formatted: `${(noPriceNum * 100).toFixed(1)}%`,
        spread,
        last_updated: Date.now(),
      };

      // Update LRU cache
      this.setCached(
        conditionId,
        {
          data: prices,
          timestamp: Date.now(),
          ttl: this.priceCacheTtl,
        },
        this.priceCache,
        this.priceCacheOrder,
        this.maxPriceCacheSize
      );

      logger.info(
        `[PolymarketService] Fetched prices - YES: ${prices.yes_price_formatted}, NO: ${prices.no_price_formatted}`
      );
      return prices;
    });
  }

  /**
   * Get orderbook for a specific token
   */
  async getOrderBook(tokenId: string): Promise<OrderBook> {
    logger.debug(`[PolymarketService] Fetching orderbook for token: ${tokenId}`);

    return this.retryFetch(async () => {
      const url = `${this.clobApiUrl}/book?token_id=${tokenId}`;
      const response = await this.fetchWithTimeout(url);

      if (!response.ok) {
        throw new Error(`CLOB API error: ${response.status} ${response.statusText}`);
      }

      const orderBook = await response.json() as OrderBook;
      return orderBook;
    });
  }

  /**
   * Get available market categories
   */
  async getMarketCategories(): Promise<MarketCategory[]> {
    logger.info("[PolymarketService] Fetching market categories");

    return this.retryFetch(async () => {
      // Fetch all markets and extract unique categories
      const markets = await this.getActiveMarkets(500); // Fetch more to get all categories

      const categoryMap = new Map<string, number>();

      for (const market of markets) {
        if (market.category) {
          const count = categoryMap.get(market.category) || 0;
          categoryMap.set(market.category, count + 1);
        }
      }

      const categories: MarketCategory[] = Array.from(categoryMap.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count);

      logger.info(`[PolymarketService] Found ${categories.length} categories`);
      return categories;
    });
  }

  /**
   * Get historical price data for a market
   *
   * Fetches price history from CLOB API for charting and trend analysis.
   * Supports different time intervals and outcomes (YES/NO).
   *
   * @param conditionId - The unique condition ID for the market
   * @param outcome - Which outcome to fetch prices for ("YES" or "NO", defaults to "YES")
   * @param interval - Time interval: "1m", "1h", "6h", "1d", "1w", "max" (defaults to "1d")
   * @param fidelity - Data resolution in minutes (optional)
   * @returns Historical price data formatted for charting
   */
  async getMarketPriceHistory(
    conditionId: string,
    outcome: "YES" | "NO" = "YES",
    interval: string = "1d",
    fidelity?: number
  ): Promise<MarketPriceHistory> {
    logger.info(
      `[PolymarketService] Fetching price history: ${conditionId}, outcome: ${outcome}, interval: ${interval}`
    );

    // Create cache key
    const cacheKey = `${conditionId}-${outcome}-${interval}-${fidelity || "default"}`;

    // Check LRU cache
    const cached = this.getCached(
      cacheKey,
      this.priceHistoryCache,
      this.priceHistoryCacheOrder,
      this.priceHistoryCacheTtl
    );

    if (cached) {
      logger.debug(`[PolymarketService] Returning cached price history (${cacheKey})`);
      return cached.data;
    }

    return this.retryFetch(async () => {
      // Get market to find token IDs
      const market = await this.getMarketDetail(conditionId);

      if (!market.tokens || market.tokens.length < 2) {
        throw new Error(`Market ${conditionId} has invalid token structure`);
      }

      // Find the token for the requested outcome
      const token = market.tokens.find(
        (t) => t.outcome.toUpperCase() === outcome.toUpperCase()
      );

      if (!token) {
        throw new Error(
          `Market ${conditionId} missing ${outcome} token. Available outcomes: ${market.tokens.map((t) => t.outcome).join(", ")}`
        );
      }

      // Build query parameters
      const queryParams = new URLSearchParams();
      queryParams.set("market", token.token_id);
      queryParams.set("interval", interval);
      if (fidelity) {
        queryParams.set("fidelity", fidelity.toString());
      }

      // Fetch price history from CLOB API
      const url = `${this.clobApiUrl}/prices-history?${queryParams.toString()}`;
      const response = await this.fetchWithTimeout(url);

      if (!response.ok) {
        throw new Error(`CLOB API error: ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as PriceHistoryResponse;

      // Format data for charting (convert to numbers and timestamps to ms)
      const dataPoints = data.history.map((point) => {
        const timestamp = point.t * 1000; // Convert seconds to milliseconds
        const date = new Date(timestamp);
        return {
          timestamp,
          price: parseFloat(point.p),
          date: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), // Format: "Jan 15"
        };
      });

      // Calculate current price (last data point)
      const currentPrice =
        dataPoints.length > 0 ? dataPoints[dataPoints.length - 1].price : undefined;

      const priceHistory: MarketPriceHistory = {
        condition_id: conditionId,
        outcome,
        token_id: token.token_id,
        interval,
        data_points: dataPoints,
        current_price: currentPrice,
        market_question: market.question,
      };

      // Update LRU cache
      this.setCached(
        cacheKey,
        {
          data: priceHistory,
          timestamp: Date.now(),
        },
        this.priceHistoryCache,
        this.priceHistoryCacheOrder,
        this.maxPriceHistoryCacheSize
      );

      logger.info(
        `[PolymarketService] Fetched price history: ${dataPoints.length} data points, current price: ${currentPrice?.toFixed(4) || "N/A"}`
      );
      return priceHistory;
    });
  }

  /**
   * Phase 2: Portfolio Tracking Methods
   */

  /**
   * Check if address is a contract (proxy) or EOA
   *
   * Makes a simple RPC call to check if the address has bytecode.
   * EOAs have no code, contracts/proxies do.
   *
   * @param address - Address to check
   * @returns True if address is a contract (proxy), false if EOA
   */
  private async isContract(address: string): Promise<boolean> {
    try {
      // Use Polygon RPC to check for bytecode
      const rpcUrl = "https://polygon-rpc.com";
      const response = await this.fetchWithTimeout(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "eth_getCode",
          params: [address, "latest"],
          id: 1,
        }),
      });

      const data = await response.json() as { result?: string; error?: { code: number; message: string } };

      // Check for JSON-RPC error response (rate limiting, server error, etc.)
      if (data.error) {
        logger.warn(
          `[PolymarketService] RPC error checking contract: ${data.error.message}. Assuming EOA.`
        );
        return false; // Default to treating as EOA on RPC error
      }

      // Check if result field exists
      if (data.result === undefined) {
        logger.warn(
          `[PolymarketService] Invalid RPC response (missing result field). Assuming EOA.`
        );
        return false;
      }

      // '0x' means no code (EOA), anything else means contract
      return data.result !== "0x";
    } catch (error) {
      logger.warn(
        `[PolymarketService] Failed to check if address is contract: ${error instanceof Error ? error.message : String(error)}. Assuming EOA.`
      );
      return false; // Default to treating as EOA on error
    }
  }

  /**
   * Get proxy wallet address from EOA or pass through if already proxy
   *
   * If the input is an EOA, derives the Gnosis Safe proxy address.
   * If the input is already a proxy/contract address, returns it as-is.
   * Polymarket uses Gnosis Safe proxy wallets for trading to enable
   * gasless orders via meta-transactions.
   *
   * @param walletAddress - User's EOA or proxy wallet address
   * @returns Proxy wallet address (checksum format)
   */
  async getOrDeriveProxyAddress(walletAddress: string): Promise<string> {
    logger.debug(`[PolymarketService] Getting or deriving proxy for: ${walletAddress}`);

    // Check if address is already a contract (proxy)
    const isProxy = await this.isContract(walletAddress);

    if (isProxy) {
      logger.info(`[PolymarketService] Address ${walletAddress} is already a proxy, using as-is`);
      return walletAddress;
    }

    // It's an EOA, derive the proxy
    const proxyAddress = getProxyWalletAddress(this.GNOSIS_PROXY_FACTORY, walletAddress);
    logger.info(`[PolymarketService] Derived proxy: ${proxyAddress} from EOA: ${walletAddress}`);
    return proxyAddress;
  }

  /**
   * Get user positions across all markets
   *
   * Fetches active positions from Data API with automatic proxy address derivation.
   * Results are cached for 60s to reduce API load.
   *
   * @param walletAddress - User's EOA or proxy wallet address
   * @returns Array of positions with current values and P&L
   */
  async getUserPositions(walletAddress: string): Promise<Position[]> {
    logger.info(`[PolymarketService] Fetching positions for wallet: ${walletAddress}`);

    // Get proxy address (derive if EOA, pass through if already proxy)
    const proxyAddress = await this.getOrDeriveProxyAddress(walletAddress);

    // Check LRU cache
    const cached = this.getCached(
      proxyAddress,
      this.positionsCache,
      this.positionsCacheOrder,
      this.positionsCacheTtl
    );

    if (cached) {
      logger.debug(`[PolymarketService] Returning cached positions (wallet: ${proxyAddress})`);
      return cached.data;
    }

    return this.retryFetch(async () => {
      const url = `${this.dataApiUrl}/positions?user=${proxyAddress}`;
      const response = await this.fetchWithTimeout(url);

      if (!response.ok) {
        throw new Error(`Data API error: ${response.status} ${response.statusText}`);
      }

      const positions = await response.json() as Position[];

      // Update LRU cache
      this.setCached(
        proxyAddress,
        {
          data: positions,
          timestamp: Date.now(),
        },
        this.positionsCache,
        this.positionsCacheOrder,
        100 // Max 100 wallets cached
      );

      logger.info(`[PolymarketService] Fetched ${positions.length} positions for wallet: ${proxyAddress}`);
      return positions;
    });
  }

  /**
   * Get user balance and portfolio summary
   *
   * Fetches total portfolio value, available balance, and P&L metrics.
   * Results are cached with positions data.
   *
   * @param walletAddress - User's EOA or proxy wallet address
   * @returns Balance summary with total value and P&L
   */
  async getUserBalance(walletAddress: string): Promise<Balance> {
    logger.info(`[PolymarketService] Fetching balance for wallet: ${walletAddress}`);

    // Get proxy address (derive if EOA, pass through if already proxy)
    const proxyAddress = await this.getOrDeriveProxyAddress(walletAddress);

    return this.retryFetch(async () => {
      const url = `${this.dataApiUrl}/value?user=${proxyAddress}`;
      const response = await this.fetchWithTimeout(url);

      if (!response.ok) {
        throw new Error(`Data API error: ${response.status} ${response.statusText}`);
      }

      // API returns array: [{ user: "0x...", value: 0 }]
      const data = await response.json() as Array<{ user: string; value: number }>;

      // Find balance for this user
      const userBalance = data.find(b => b.user.toLowerCase() === proxyAddress.toLowerCase());
      const totalValue = userBalance?.value ?? 0;

      // Transform to Balance interface
      const balance: Balance = {
        total_value: totalValue.toString(),
        available_balance: "0",      // Not provided by API
        positions_value: totalValue.toString(),
        realized_pnl: "0",
        unrealized_pnl: "0",
        timestamp: Date.now()
      };

      logger.info(
        `[PolymarketService] Fetched balance - Total: ${balance.total_value}, Available: ${balance.available_balance}`
      );
      return balance;
    });
  }

  /**
   * Get user trade history
   *
   * Fetches recent trades from Data API with automatic proxy address derivation.
   * Results are cached for 30s to balance freshness with API load.
   *
   * @param walletAddress - User's EOA or proxy wallet address
   * @param limit - Maximum number of trades to return (default: 100)
   * @returns Array of trade history entries
   */
  async getUserTrades(walletAddress: string, limit: number = 100): Promise<Trade[]> {
    logger.info(`[PolymarketService] Fetching trades for wallet: ${walletAddress}, limit: ${limit}`);

    // Get proxy address (derive if EOA, pass through if already proxy)
    const proxyAddress = await this.getOrDeriveProxyAddress(walletAddress);

    // Create cache key with limit
    const cacheKey = `${proxyAddress}-${limit}`;

    // Check LRU cache
    const cached = this.getCached(
      cacheKey,
      this.tradesCache,
      this.tradesCacheOrder,
      this.tradesCacheTtl
    );

    if (cached) {
      logger.debug(`[PolymarketService] Returning cached trades (wallet: ${proxyAddress})`);
      return cached.data;
    }

    return this.retryFetch(async () => {
      const url = `${this.dataApiUrl}/trades?user=${proxyAddress}&limit=${limit}`;
      const response = await this.fetchWithTimeout(url);

      if (!response.ok) {
        throw new Error(`Data API error: ${response.status} ${response.statusText}`);
      }

      const trades = await response.json() as Trade[];

      // Update LRU cache
      this.setCached(
        cacheKey,
        {
          data: trades,
          timestamp: Date.now(),
        },
        this.tradesCache,
        this.tradesCacheOrder,
        100 // Max 100 wallet-limit combinations cached
      );

      logger.info(`[PolymarketService] Fetched ${trades.length} trades for wallet: ${proxyAddress}`);
      return trades;
    });
  }

  /**
   * Phase 4: Events API Methods
   */

  /**
   * Get events from Gamma API
   *
   * Fetches higher-level event groupings that contain multiple markets.
   * Results are cached for 60s as event data is relatively stable.
   *
   * @param filters - Optional filters for active status, tags, pagination
   * @returns Array of events with metadata
   */
  async getEvents(filters?: EventFilters): Promise<PolymarketEvent[]> {
    const { active, closed, tag, limit = 20, offset = 0 } = filters || {};
    logger.info(`[PolymarketService] Fetching events with filters: active=${active}, tag=${tag}, limit=${limit}`);

    // Check cache (only cache if no filters, since filtered results vary)
    if (!filters || (active === undefined && !closed && !tag && offset === 0)) {
      if (this.eventsListCache) {
        const age = Date.now() - this.eventsListCache.timestamp;
        if (age < this.eventCacheTtl) {
          logger.debug(`[PolymarketService] Returning cached events list (age: ${age}ms)`);
          return this.eventsListCache.data.slice(0, limit);
        }
      }
    }

    return this.retryFetch(async () => {
      // Build query parameters
      const queryParams = new URLSearchParams();
      queryParams.set("limit", limit.toString());
      queryParams.set("offset", offset.toString());

      if (active !== undefined) {
        queryParams.set("active", active.toString());
      }

      if (closed !== undefined) {
        queryParams.set("closed", closed.toString());
      }

      if (tag) {
        queryParams.set("tag", tag);
      }

      const url = `${this.gammaApiUrl}/events?${queryParams.toString()}`;
      const response = await this.fetchWithTimeout(url);

      if (!response.ok) {
        throw new Error(`Gamma API error: ${response.status} ${response.statusText}`);
      }

      const events = await response.json() as PolymarketEvent[];

      // Update cache only if no filters
      if (!filters || (active === undefined && !closed && !tag && offset === 0)) {
        this.eventsListCache = {
          data: events,
          timestamp: Date.now(),
        };
      }

      logger.info(`[PolymarketService] Fetched ${events.length} events`);
      return events;
    });
  }

  /**
   * Get event detail by ID or slug
   *
   * Fetches complete event data including all associated markets.
   * Results are cached with LRU eviction.
   *
   * @param eventIdOrSlug - Event ID or URL slug
   * @returns Event detail with associated markets
   */
  async getEventDetail(eventIdOrSlug: string): Promise<PolymarketEventDetail> {
    logger.info(`[PolymarketService] Fetching event detail: ${eventIdOrSlug}`);

    // Check LRU cache
    const cached = this.getCached(
      eventIdOrSlug,
      this.eventsCache,
      this.eventsCacheOrder,
      this.eventCacheTtl
    );

    if (cached) {
      logger.debug(`[PolymarketService] Returning cached event (${eventIdOrSlug})`);
      return cached.data;
    }

    return this.retryFetch(async () => {
      const url = `${this.gammaApiUrl}/events/${eventIdOrSlug}`;
      const response = await this.fetchWithTimeout(url);

      if (!response.ok) {
        throw new Error(`Gamma API error: ${response.status} ${response.statusText}`);
      }

      const event = await response.json() as PolymarketEventDetail;

      // Update LRU cache
      this.setCached(
        eventIdOrSlug,
        {
          data: event,
          timestamp: Date.now(),
        },
        this.eventsCache,
        this.eventsCacheOrder,
        this.maxEventCacheSize
      );

      logger.info(`[PolymarketService] Fetched event: ${event.title} (${event.markets?.length || 0} markets)`);
      return event;
    });
  }

  /**
   * Phase 3B: Market Analytics Methods
   */

  /**
   * Get market-wide open interest (total value locked)
   *
   * Fetches total value locked across all Polymarket markets.
   * Results are cached for 30s as analytics change less frequently.
   *
   * @returns Open interest data with total value and market count
   */
  async getOpenInterest(): Promise<OpenInterestData> {
    logger.info("[PolymarketService] Fetching open interest");

    // Check cache
    if (this.openInterestCache) {
      const age = Date.now() - this.openInterestCache.timestamp;
      if (age < this.analyticsCacheTtl) {
        logger.debug(`[PolymarketService] Returning cached open interest (age: ${age}ms)`);
        return this.openInterestCache.data;
      }
    }

    return this.retryFetch(async () => {
      const url = `${this.dataApiUrl}/oi`;
      const response = await this.fetchWithTimeout(url);

      if (!response.ok) {
        throw new Error(`Data API error: ${response.status} ${response.statusText}`);
      }

      // API returns array format: [{"market": "GLOBAL", "value": 344230134.862965}]
      const responseData = await response.json() as Array<{market: string, value: number}>;
      const rawData = responseData[0] || {market: "GLOBAL", value: 0};

      // Transform to expected format
      const data: OpenInterestData = {
        total_value: rawData.value.toString(),
        timestamp: Date.now()
      };

      // Update cache
      this.openInterestCache = {
        data,
        timestamp: Date.now(),
      };

      logger.info(`[PolymarketService] Fetched open interest: ${data.total_value}`);
      return data;
    });
  }

  /**
   * Get live trading volume (24h rolling)
   *
   * Fetches 24h trading volume across all markets.
   * Results are cached for 30s as analytics change less frequently.
   *
   * NOTE: The API returns array format: [{"total": 0, "markets": null}]
   * The id=1 parameter is required but may return zero volume if no recent activity.
   * This is expected behavior - the endpoint works correctly.
   *
   * @returns Volume data with 24h total and per-market breakdown
   */
  async getLiveVolume(): Promise<VolumeData> {
    logger.info("[PolymarketService] Fetching live volume");

    // Check cache
    if (this.liveVolumeCache) {
      const age = Date.now() - this.liveVolumeCache.timestamp;
      if (age < this.analyticsCacheTtl) {
        logger.debug(`[PolymarketService] Returning cached live volume (age: ${age}ms)`);
        return this.liveVolumeCache.data;
      }
    }

    return this.retryFetch(async () => {
      const url = `${this.dataApiUrl}/live-volume?id=1`;
      const response = await this.fetchWithTimeout(url);

      if (!response.ok) {
        throw new Error(`Data API error: ${response.status} ${response.statusText}`);
      }

      // API returns array format: [{"total": 0, "markets": null}]
      const responseData = await response.json() as Array<{total: number, markets: any}>;
      const rawData = responseData[0] || {total: 0, markets: null};

      // Transform to expected format
      const data: VolumeData = {
        total_volume_24h: rawData.total.toString(),
        markets: rawData.markets || [],
        timestamp: Date.now()
      };

      // Update cache
      this.liveVolumeCache = {
        data,
        timestamp: Date.now(),
      };

      logger.info(`[PolymarketService] Fetched live volume: ${data.total_volume_24h}`);
      return data;
    });
  }

  /**
   * Get bid-ask spreads for markets
   *
   * Fetches spread analysis for assessing liquidity quality.
   * Results are cached for 30s as analytics change less frequently.
   *
   * @returns Array of spread data for markets
   */
  async getSpreads(limit: number = 20): Promise<SpreadData[]> {
    logger.info(`[PolymarketService] Fetching spreads for top ${limit} markets`);

    // Check cache
    if (this.spreadsCache) {
      const age = Date.now() - this.spreadsCache.timestamp;
      if (age < this.analyticsCacheTtl) {
        logger.debug(`[PolymarketService] Returning cached spreads (age: ${age}ms)`);
        return this.spreadsCache.data.slice(0, limit);
      }
    }

    return this.retryFetch(async () => {
      // Fetch active markets with high volume
      const markets = await this.getActiveMarkets(limit);

      if (markets.length === 0) {
        logger.warn("[PolymarketService] No active markets found for spread calculation");
        return [];
      }

      // Fetch spreads for each market in parallel using the CLOB API
      const spreadPromises = markets.map(async (market) => {
        try {
          // Parse clobTokenIds if available
          let tokenIds: string[] = [];
          if (market.clobTokenIds) {
            try {
              tokenIds = JSON.parse(market.clobTokenIds as any);
            } catch (e) {
              logger.debug(`[PolymarketService] Failed to parse clobTokenIds for ${market.conditionId}`);
              return null;
            }
          }

          if (tokenIds.length === 0) {
            logger.debug(`[PolymarketService] No token IDs for ${market.conditionId}`);
            return null;
          }

          // Use the first token ID (YES token) to get spread
          const tokenId = tokenIds[0];
          const spreadUrl = `${this.clobApiUrl}/spread?token_id=${tokenId}`;

          const response = await fetch(spreadUrl, {
            method: "GET",
            headers: {
              "Content-Type": "application/json",
            },
          });

          if (!response.ok) {
            logger.debug(`[PolymarketService] Failed to fetch spread for ${market.question}: ${response.status}`);
            return null;
          }

          const spreadResponse = await response.json() as { spread: string };
          const spread = parseFloat(spreadResponse.spread);

          // Fetch orderbook to get best bid/ask prices for additional context
          const orderbook = await this.getOrderBook(tokenId);
          const bestBid = orderbook.bids[0]?.price ? parseFloat(orderbook.bids[0].price) : 0;
          const bestAsk = orderbook.asks[0]?.price ? parseFloat(orderbook.asks[0].price) : 0;

          // Skip if no liquidity
          if (bestBid === 0 || bestAsk === 0) {
            logger.debug(`[PolymarketService] No liquidity for ${market.question}`);
            return null;
          }

          const spreadPercentage = ((spread / bestAsk) * 100).toFixed(2);

          // Calculate liquidity score based on spread
          let liquidityScore = 0;
          if (spread < 0.01) liquidityScore = 90 + (1 - spread / 0.01) * 10; // 90-100 for <1% spread
          else if (spread < 0.05) liquidityScore = 70 + (1 - spread / 0.05) * 20; // 70-90 for 1-5%
          else if (spread < 0.10) liquidityScore = 50 + (1 - spread / 0.10) * 20; // 50-70 for 5-10%
          else liquidityScore = Math.max(0, 50 - spread * 100); // <50 for >10%

          const spreadData: SpreadData = {
            condition_id: market.conditionId,
            spread: spread.toFixed(4),
            spread_percentage: spreadPercentage,
            best_bid: bestBid.toFixed(4),
            best_ask: bestAsk.toFixed(4),
            question: market.question,
            liquidity_score: Math.round(liquidityScore),
          };

          return spreadData;
        } catch (error) {
          logger.debug(
            `[PolymarketService] Failed to fetch spread for ${market.question}: ${error instanceof Error ? error.message : String(error)}`
          );
          return null;
        }
      });

      const results = await Promise.all(spreadPromises);
      const spreads = results.filter((s): s is SpreadData => s !== null);

      // Update cache
      this.spreadsCache = {
        data: spreads,
        timestamp: Date.now(),
      };

      logger.info(`[PolymarketService] Fetched spreads for ${spreads.length}/${markets.length} markets`);
      return spreads;
    });
  }

  /**
   * Phase 3A: Orderbook Methods
   */

  /**
   * Get orderbook for a single token with summary metrics
   *
   * Fetches orderbook from CLOB API and calculates best bid/ask, spread, and mid price.
   * Results are cached for 10-15s (orderbooks change frequently).
   *
   * @param tokenId - ERC1155 conditional token ID
   * @param side - Optional filter to BUY or SELL side
   * @returns Orderbook summary with bids, asks, and calculated metrics
   */
  async getOrderbook(tokenId: string, side?: "BUY" | "SELL"): Promise<OrderbookSummary> {
    logger.info(`[PolymarketService] Fetching orderbook for token: ${tokenId}${side ? ` (${side} side)` : ""}`);

    return this.retryFetch(async () => {
      const queryParams = new URLSearchParams();
      queryParams.set("token_id", tokenId);
      if (side) {
        queryParams.set("side", side);
      }

      const url = `${this.clobApiUrl}/book?${queryParams.toString()}`;
      const response = await this.fetchWithTimeout(url);

      if (!response.ok) {
        throw new Error(`CLOB API error: ${response.status} ${response.statusText}`);
      }

      const orderbook = await response.json() as OrderBook;

      // Calculate summary metrics
      const bestBid = orderbook.bids.length > 0 ? orderbook.bids[0].price : undefined;
      const bestAsk = orderbook.asks.length > 0 ? orderbook.asks[0].price : undefined;

      let spread: string | undefined;
      let midPrice: string | undefined;

      if (bestBid && bestAsk) {
        const bidNum = parseFloat(bestBid);
        const askNum = parseFloat(bestAsk);
        spread = (askNum - bidNum).toFixed(4);
        midPrice = ((bidNum + askNum) / 2).toFixed(4);
      }

      const summary: OrderbookSummary = {
        token_id: tokenId,
        market: orderbook.market,
        asset_id: orderbook.asset_id,
        timestamp: orderbook.timestamp,
        hash: (orderbook as any).hash,
        bids: orderbook.bids,
        asks: orderbook.asks,
        best_bid: bestBid,
        best_ask: bestAsk,
        spread,
        mid_price: midPrice,
      };

      logger.info(
        `[PolymarketService] Fetched orderbook - ${orderbook.bids.length} bids, ${orderbook.asks.length} asks, ` +
        `best: ${bestBid || "N/A"}/${bestAsk || "N/A"}`
      );

      return summary;
    });
  }

  /**
   * Get orderbooks for multiple tokens
   *
   * Fetches orderbooks for up to 100 tokens in a single batch request.
   * Results are cached for 10-15s (orderbooks change frequently).
   *
   * @param tokenIds - Array of ERC1155 conditional token IDs (max 100)
   * @returns Array of orderbook summaries
   */
  async getOrderbooks(tokenIds: string[]): Promise<OrderbookSummary[]> {
    logger.info(`[PolymarketService] Fetching orderbooks for ${tokenIds.length} tokens`);

    if (tokenIds.length === 0) {
      return [];
    }

    if (tokenIds.length > 100) {
      logger.warn(`[PolymarketService] Token IDs exceeds max of 100, truncating to first 100`);
      tokenIds = tokenIds.slice(0, 100);
    }

    return this.retryFetch(async () => {
      const url = `${this.clobApiUrl}/books`;
      const response = await this.fetchWithTimeout(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token_ids: tokenIds }),
      });

      if (!response.ok) {
        throw new Error(`CLOB API error: ${response.status} ${response.statusText}`);
      }

      const orderbooks = await response.json() as OrderBook[];

      // Convert to summaries with calculated metrics
      // Use asset_id from API response instead of array index to handle out-of-order or partial results
      const summaries: OrderbookSummary[] = orderbooks.map((orderbook) => {
        const tokenId = orderbook.asset_id;
        const bestBid = orderbook.bids.length > 0 ? orderbook.bids[0].price : undefined;
        const bestAsk = orderbook.asks.length > 0 ? orderbook.asks[0].price : undefined;

        let spread: string | undefined;
        let midPrice: string | undefined;

        if (bestBid && bestAsk) {
          const bidNum = parseFloat(bestBid);
          const askNum = parseFloat(bestAsk);
          spread = (askNum - bidNum).toFixed(4);
          midPrice = ((bidNum + askNum) / 2).toFixed(4);
        }

        return {
          token_id: tokenId,
          market: orderbook.market,
          asset_id: orderbook.asset_id,
          timestamp: orderbook.timestamp,
          hash: (orderbook as any).hash,
          bids: orderbook.bids,
          asks: orderbook.asks,
          best_bid: bestBid,
          best_ask: bestAsk,
          spread,
          mid_price: midPrice,
        };
      });

      logger.info(`[PolymarketService] Fetched ${summaries.length} orderbooks`);
      return summaries;
    });
  }

  /**
   * Phase 5A: Extended Portfolio Methods
   */

  /**
   * Get closed positions (historical resolved markets)
   *
   * Fetches resolved positions with final outcomes and payouts.
   * Results are cached for 60s as historical data is stable.
   *
   * @param walletAddress - User's EOA or proxy wallet address
   * @returns Array of closed positions with win/loss info
   */
  async getClosedPositions(walletAddress: string): Promise<ClosedPosition[]> {
    logger.info(`[PolymarketService] Fetching closed positions for wallet: ${walletAddress}`);

    // Get proxy address (derive if EOA, pass through if already proxy)
    const proxyAddress = await this.getOrDeriveProxyAddress(walletAddress);

    // Check LRU cache
    const cached = this.getCached(
      proxyAddress,
      this.closedPositionsCache,
      this.closedPositionsCacheOrder,
      this.closedPositionsCacheTtl
    );

    if (cached) {
      logger.debug(`[PolymarketService] Returning cached closed positions (wallet: ${proxyAddress})`);
      return cached.data;
    }

    return this.retryFetch(async () => {
      const url = `${this.dataApiUrl}/closed-positions?user=${proxyAddress}`;
      const response = await this.fetchWithTimeout(url);

      if (!response.ok) {
        throw new Error(`Data API error: ${response.status} ${response.statusText}`);
      }

      // Transform API response to ClosedPosition interface
      // API returns camelCase fields, interface expects snake_case
      const rawPositions = await response.json() as Array<any>;
      const closedPositions: ClosedPosition[] = rawPositions.map(raw => {
        // Calculate pnl_percentage: (realizedPnl / invested) * 100
        const invested = raw.totalBought * raw.avgPrice;
        const pnlPercentage = invested > 0 ? ((raw.realizedPnl / invested) * 100).toFixed(2) : "0.00";

        // Calculate payout: totalBought * settlement price
        const payout = (raw.totalBought * raw.curPrice).toString();

        return {
          market: raw.title,
          condition_id: raw.conditionId,
          asset_id: raw.asset,
          outcome: raw.outcome.toUpperCase() as "YES" | "NO",
          size: raw.totalBought.toString(),
          avg_price: raw.avgPrice.toString(),
          settlement_price: raw.curPrice.toString(),
          pnl: raw.realizedPnl.toString(),
          pnl_percentage: pnlPercentage,
          closed_at: raw.timestamp,
          payout,
          won: raw.curPrice === 1
        };
      });

      // Update LRU cache
      this.setCached(
        proxyAddress,
        {
          data: closedPositions,
          timestamp: Date.now(),
        },
        this.closedPositionsCache,
        this.closedPositionsCacheOrder,
        100 // Max 100 wallets cached
      );

      logger.info(`[PolymarketService] Fetched ${closedPositions.length} closed positions for wallet: ${proxyAddress}`);
      return closedPositions;
    });
  }

  /**
   * Get user activity log (deposits, withdrawals, trades, redemptions)
   *
   * Fetches on-chain activity history for a wallet.
   * Results are cached for 60s as historical data is stable.
   *
   * @param walletAddress - User's EOA or proxy wallet address
   * @returns Array of user activity entries
   */
  async getUserActivity(walletAddress: string): Promise<UserActivity[]> {
    logger.info(`[PolymarketService] Fetching user activity for wallet: ${walletAddress}`);

    // Get proxy address (derive if EOA, pass through if already proxy)
    const proxyAddress = await this.getOrDeriveProxyAddress(walletAddress);

    // Check LRU cache
    const cached = this.getCached(
      proxyAddress,
      this.userActivityCache,
      this.userActivityCacheOrder,
      this.userActivityCacheTtl
    );

    if (cached) {
      logger.debug(`[PolymarketService] Returning cached user activity (wallet: ${proxyAddress})`);
      return cached.data;
    }

    return this.retryFetch(async () => {
      const url = `${this.dataApiUrl}/activity?user=${proxyAddress}`;
      const response = await this.fetchWithTimeout(url);

      if (!response.ok) {
        throw new Error(`Data API error: ${response.status} ${response.statusText}`);
      }

      // Transform API response to UserActivity interface
      // API returns camelCase fields, interface expects snake_case
      const rawActivity = await response.json() as Array<any>;
      const activity: UserActivity[] = rawActivity.map((raw, index) => ({
        id: raw.transactionHash || `activity_${index}`,
        type: raw.type as "DEPOSIT" | "WITHDRAWAL" | "TRADE" | "REDEMPTION",
        amount: raw.usdcSize.toString(),
        timestamp: raw.timestamp,
        transaction_hash: raw.transactionHash,
        market: raw.title,
        outcome: raw.outcome?.toUpperCase() as "YES" | "NO" | undefined,
        status: "CONFIRMED" as const
      }));

      // Update LRU cache
      this.setCached(
        proxyAddress,
        {
          data: activity,
          timestamp: Date.now(),
        },
        this.userActivityCache,
        this.userActivityCacheOrder,
        100 // Max 100 wallets cached
      );

      logger.info(`[PolymarketService] Fetched ${activity.length} activity entries for wallet: ${proxyAddress}`);
      return activity;
    });
  }

  /**
   * Get top holders in a market
   *
   * Fetches major participants by position size.
   * Results are cached for 60s as holder data changes gradually.
   *
   * IMPORTANT: This endpoint requires the condition ID (hex string starting with 0x),
   * NOT the numeric market ID. Use the market's conditionId field.
   *
   * @param conditionId - Market condition ID (hex string, e.g., "0xfa48...")
   * @returns Array of top holders with position sizes
   */
  async getTopHolders(conditionId: string): Promise<TopHolder[]> {
    logger.info(`[PolymarketService] Fetching top holders for market: ${conditionId}`);

    // Check LRU cache
    const cached = this.getCached(
      conditionId,
      this.topHoldersCache,
      this.topHoldersCacheOrder,
      this.topHoldersCacheTtl
    );

    if (cached) {
      logger.debug(`[PolymarketService] Returning cached top holders (market: ${conditionId})`);
      return cached.data;
    }

    return this.retryFetch(async () => {
      const url = `${this.dataApiUrl}/holders?market=${conditionId}`;
      const response = await this.fetchWithTimeout(url);

      if (!response.ok) {
        throw new Error(`Data API error: ${response.status} ${response.statusText}`);
      }

      // API returns: [{token: string, holders: [{proxyWallet, amount, outcomeIndex, displayUsernamePublic, ...}]}]
      // Need to flatten to TopHolder[]
      const data = await response.json() as Array<{token: string, holders: Array<any>}>;

      const holders: TopHolder[] = data.flatMap(group =>
        group.holders.map(h => ({
          address: h.proxyWallet,
          outcome: h.outcomeIndex === 0 ? "YES" : "NO",
          size: h.amount.toString(),
          value: "0", // Not provided by API
          percentage: "0", // Calculate if needed
          is_public: h.displayUsernamePublic
        }))
      );

      // Update LRU cache
      this.setCached(
        conditionId,
        {
          data: holders,
          timestamp: Date.now(),
        },
        this.topHoldersCache,
        this.topHoldersCacheOrder,
        100 // Max 100 markets cached
      );

      logger.info(`[PolymarketService] Fetched ${holders.length} top holders for market: ${conditionId}`);
      return holders;
    });
  }

  /**
   * Clear all caches
   */
  clearCache(): void {
    this.marketCache.clear();
    this.marketCacheOrder = [];
    this.priceCache.clear();
    this.priceCacheOrder = [];
    this.priceHistoryCache.clear();
    this.priceHistoryCacheOrder = [];
    this.positionsCache.clear();
    this.positionsCacheOrder = [];
    this.tradesCache.clear();
    this.tradesCacheOrder = [];
    this.eventsCache.clear();
    this.eventsCacheOrder = [];
    this.eventsListCache = null;
    this.marketsListCache = null;
    this.openInterestCache = null;
    this.liveVolumeCache = null;
    this.spreadsCache = null;
    this.closedPositionsCache.clear();
    this.closedPositionsCacheOrder = [];
    this.userActivityCache.clear();
    this.userActivityCacheOrder = [];
    this.topHoldersCache.clear();
    this.topHoldersCacheOrder = [];
    logger.info("[PolymarketService] Cache cleared");
  }
}

export default PolymarketService;
