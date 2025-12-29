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
  private maxRetries: number = 3;
  private requestTimeout: number = 10000; // 10 seconds
  private maxMarketCacheSize: number = 100; // Max markets in cache
  private maxPriceCacheSize: number = 200; // Max prices in cache
  private maxPriceHistoryCacheSize: number = 50; // Max price histories in cache

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
  private marketsListCache: { data: PolymarketMarket[]; timestamp: number } | null = null;

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

      // Update cache
      this.marketsListCache = {
        data,
        timestamp: Date.now(),
      };

      logger.info(`[PolymarketService] Fetched ${data.length} active markets`);
      return data;
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
      const market = markets.find((m) => m.condition_id === conditionId);

      if (!market) {
        throw new Error(`Market not found: ${conditionId}`);
      }

      // Update LRU cache
      this.setCached(
        conditionId,
        {
          data: market,
          timestamp: Date.now(),
          ttl: this.marketCacheTtl,
        },
        this.marketCache,
        this.marketCacheOrder,
        this.maxMarketCacheSize
      );

      logger.info(`[PolymarketService] Fetched market: ${market.question}`);
      return market;
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
   * Derive proxy wallet address from EOA address
   *
   * Uses @polymarket/sdk's getProxyWalletAddress to compute the deterministic
   * proxy address for a user's EOA. Polymarket uses Gnosis Safe proxy wallets
   * for trading to enable gasless orders via meta-transactions.
   *
   * @param eoaAddress - User's externally owned account address
   * @returns Proxy wallet address (checksum format)
   */
  deriveProxyAddress(eoaAddress: string): string {
    logger.debug(`[PolymarketService] Deriving proxy address for EOA: ${eoaAddress}`);

    // Use @polymarket/sdk to derive proxy wallet address
    // getProxyWalletAddress(factory, user) computes the deterministic CREATE2 address
    const proxyAddress = getProxyWalletAddress(this.GNOSIS_PROXY_FACTORY, eoaAddress);
    logger.info(`[PolymarketService] Derived proxy: ${proxyAddress} for EOA: ${eoaAddress}`);
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

    // Derive proxy address if this is an EOA
    const proxyAddress = this.deriveProxyAddress(walletAddress);

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

    // Derive proxy address if this is an EOA
    const proxyAddress = this.deriveProxyAddress(walletAddress);

    return this.retryFetch(async () => {
      const url = `${this.dataApiUrl}/value?user=${proxyAddress}`;
      const response = await this.fetchWithTimeout(url);

      if (!response.ok) {
        throw new Error(`Data API error: ${response.status} ${response.statusText}`);
      }

      const balance = await response.json() as Balance;

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

    // Derive proxy address if this is an EOA
    const proxyAddress = this.deriveProxyAddress(walletAddress);

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
    this.marketsListCache = null;
    logger.info("[PolymarketService] Cache cleared");
  }
}

export default PolymarketService;
