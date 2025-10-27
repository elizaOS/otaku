import { logger, Service, type IAgentRuntime } from "@elizaos/core";
import { formatCoinMetadata, safeReadJson } from "../utils";

export interface CoinGeckoTokenMetadata {
  id: string;
  symbol: string;
  name: string;
  asset_platform_id?: string | null;
  contract_address?: string | null;
  platforms?: Record<string, string>;
  detail_platforms?: Record<string, { decimal_place?: number; contract_address?: string }>;
  market_data?: unknown;
  links?: unknown;
  image?: unknown;
  [key: string]: unknown;
}

export class CoinGeckoService extends Service {
  static serviceType = "COINGECKO_SERVICE" as const;
  capabilityDescription = "Fetch token metadata from CoinGecko (free or Pro).";

  private proApiKey: string | undefined;
  private coinsCache: Array<{ id: string; symbol: string; name: string }> = [];
  private idSet = new Set<string>();
  private symbolToIds = new Map<string, string[]>();
  private nameToIds = new Map<string, string[]>();

  constructor(runtime: IAgentRuntime) {
    super(runtime);
  }

  static async start(runtime: IAgentRuntime): Promise<CoinGeckoService> {
    const svc = new CoinGeckoService(runtime);
    await svc.initialize(runtime);
    return svc;
  }

  async initialize(runtime: IAgentRuntime): Promise<void> {
    // Prefer runtime settings, fallback to env
    this.proApiKey = (runtime.getSetting("COINGECKO_API_KEY") as string) || process.env.COINGECKO_API_KEY;
    await this.loadCoinsIndex();
  }

  async stop(): Promise<void> {}

  /**
   * Get token metadata for one or more identifiers (CoinGecko ids, symbols, names, or contract addresses).
   * Uses Pro API when COINGECKO_API_KEY is set; otherwise public API.
   * Never throws for per-id failures; returns an entry with error message instead.
   */
  async getTokenMetadata(ids: string | string[]): Promise<Array<{ id: string; success: boolean; data?: any; error?: string }>> {
    const normalizedIds = (Array.isArray(ids) ? ids : [ids])
      .map((s) => (s || "").trim())
      .filter(Boolean);
    const isPro = Boolean(this.proApiKey);
    const baseUrl = isPro ? "https://pro-api.coingecko.com/api/v3" : "https://api.coingecko.com/api/v3";

    const results: Array<{ id: string; success: boolean; data?: any; error?: string }> = [];

    for (const rawId of normalizedIds) {
      const q = (rawId || "").trim();

      // Contract address handling
      if (isEvmAddress(q)) {
        try {
          const platforms = ["ethereum", "base", "arbitrum-one", "optimistic-ethereum", "polygon-pos", "bsc"];
          const byContract = await this.fetchByContractAddress(baseUrl, q, platforms);
          if (byContract) {
            results.push({ id: q, success: true, data: byContract });
          } else {
            results.push({ id: q, success: false, error: `No CoinGecko match for EVM address: ${q}` });
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          logger.warn(`[CoinGecko] EVM address lookup failed for ${q}: ${msg}`);
          results.push({ id: q, success: false, error: msg });
        }
        continue;
      }

      if (isSolanaAddress(q)) {
        try {
          const byContract = await this.fetchByContractAddress(baseUrl, q, ["solana"]);
          if (byContract) {
            results.push({ id: q, success: true, data: byContract });
          } else {
            results.push({ id: q, success: false, error: `No CoinGecko match for Solana address: ${q}` });
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          logger.warn(`[CoinGecko] Solana address lookup failed for ${q}: ${msg}`);
          results.push({ id: q, success: false, error: msg });
        }
        continue;
      }

      // Resolve symbol/name/id via local index
      let resolvedId: string | null = null;
      try {
        resolvedId = await this.resolveIdFromCache(q);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.warn(`[CoinGecko] resolveIdFromCache failed for ${q}: ${msg}`);
      }

      if (!resolvedId) {
        results.push({ id: q, success: false, error: `Unknown coin id/symbol/name: ${q}` });
        continue;
      }

      const endpoint = `/coins/${encodeURIComponent(resolvedId)}`;
      const url = `${baseUrl}${endpoint}`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      try {
        logger.debug(`[CoinGecko] GET ${url}`);
        const res = await fetch(url, {
          method: "GET",
          headers: {
            Accept: "application/json",
            ...(isPro && this.proApiKey ? { "x-cg-pro-api-key": this.proApiKey } : {}),
            "User-Agent": "ElizaOS-CoinGecko-Plugin/1.0",
          },
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!res.ok) {
          const body = await safeReadJson(res);
          const msg = `CoinGecko error ${res.status}: ${res.statusText}${body ? ` - ${JSON.stringify(body)}` : ""}`;
          logger.warn(`[CoinGecko] request failed for ${resolvedId}: ${msg}`);
          results.push({ id: q, success: false, error: msg });
          continue;
        }

        const data = (await res.json()) as CoinGeckoTokenMetadata;
        results.push({ id: q, success: true, data: formatCoinMetadata(resolvedId, data as any) });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`[CoinGecko] request failed for ${resolvedId ?? q}: ${msg}`);
        results.push({ id: q, success: false, error: msg });
      } finally {
        clearTimeout(timeout);
      }
    }

    return results;
  }

  private async fetchByContractAddress(
    baseUrl: string,
    address: string,
    platforms: string[],
  ): Promise<any | null> {
    for (const platform of platforms) {
      const url = `${baseUrl}/coins/${platform}/contract/${address}`;
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        const res = await fetch(url, {
          method: "GET",
          headers: {
            Accept: "application/json",
            ...(this.proApiKey ? { "x-cg-pro-api-key": this.proApiKey } : {}),
            "User-Agent": "ElizaOS-CoinGecko-Plugin/1.0",
          },
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (!res.ok) {
          continue;
        }

        const data = (await res.json()) as Record<string, any>;
        return formatCoinMetadata((data && typeof data === "object" ? (data as any).id : undefined) ?? platform, data, platform);
      } catch {
        // try next platform
      }
    }
    return null;
  }

  private async loadCoinsIndex(): Promise<void> {
    const isPro = Boolean(this.proApiKey);
    const baseUrl = isPro ? "https://pro-api.coingecko.com/api/v3" : "https://api.coingecko.com/api/v3";
    const url = `${baseUrl}/coins/list`;
    const maxAttempts = 5;
    const baseDelayMs = 500;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      try {
        logger.debug(`[CoinGecko] Loading coins index (attempt ${attempt}/${maxAttempts}): ${url}`);
        const res = await fetch(url, {
          method: "GET",
          headers: {
            Accept: "application/json",
            ...(isPro && this.proApiKey ? { "x-cg-pro-api-key": this.proApiKey } : {}),
            "User-Agent": "ElizaOS-CoinGecko-Plugin/1.0",
          },
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (!res.ok) {
          const body = await safeReadJson(res);
          throw new Error(`Failed to load coins list ${res.status}: ${res.statusText}${body ? ` - ${JSON.stringify(body)}` : ""}`);
        }

        const list = (await res.json()) as Array<{ id: string; symbol: string; name: string }>;
        this.coinsCache = list;
        this.idSet.clear();
        this.symbolToIds.clear();
        this.nameToIds.clear();
        for (const item of list) {
          const id = (item.id || "").toLowerCase();
          const sym = (item.symbol || "").toLowerCase();
          const name = (item.name || "").toLowerCase();
          if (id) this.idSet.add(id);
        if (sym) {
          const arr = this.symbolToIds.get(sym) || [];
          arr.push(id);
          this.symbolToIds.set(sym, arr);
        }
        if (name) {
          const arr = this.nameToIds.get(name) || [];
          arr.push(id);
          this.nameToIds.set(name, arr);
        }
        }
        logger.info(`[CoinGecko] Coins index loaded: ${this.coinsCache.length} entries`);
        return;
      } catch (e) {
        clearTimeout(timeout);
        const isLast = attempt === maxAttempts;
        const msg = e instanceof Error ? e.message : String(e);
        if (isLast) {
          logger.error(`[CoinGecko] Failed to load coins index after ${maxAttempts} attempts: ${msg}`);
          break;
        }
        const backoff = baseDelayMs * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 200);
        logger.warn(`[CoinGecko] Coins index fetch failed (attempt ${attempt}): ${msg}. Retrying in ${backoff}ms...`);
        await new Promise((r) => setTimeout(r, backoff));
      }
    }
  }

  private async resolveIdFromCache(input: string): Promise<string | null> {
    const q = (input || "").trim().toLowerCase();
    console.log("[CoinGecko:resolveIdFromCache] query:", q);
    if (!q) return null;
    if (this.idSet.has(q)) {
      console.log("[CoinGecko:resolveIdFromCache] hit idSet");
      return q;
    }
    const bySymbol = this.symbolToIds.get(q);
    if (bySymbol && bySymbol.length > 0) {
      console.log("[CoinGecko:resolveIdFromCache] symbol matches:", bySymbol);
      return await this.pickMostPopular(bySymbol);
    }
    const byName = this.nameToIds.get(q);
    if (byName && byName.length > 0) {
      console.log("[CoinGecko:resolveIdFromCache] name matches:", byName);
      return await this.pickMostPopular(byName);
    }
    const nearSymbols = Array.from(this.symbolToIds.keys())
      .filter((k) => k === q || k.startsWith(q) || k.includes(q))
      .slice(0, 10);
    const nearNames = Array.from(this.nameToIds.keys())
      .filter((k) => k === q || k.startsWith(q) || k.includes(q))
      .slice(0, 10);
    console.log("[CoinGecko:resolveIdFromCache] no matches. Nearby:", {
      nearSymbols,
      nearNames,
    });
    return null;
  }

  private async pickMostPopular(ids: string[]): Promise<string | null> {
    if (ids.length === 1) return ids[0];
    const ranked = await this.rankByMarkets(ids);
    return ranked[0] || ids[0] || null;
  }

  private async rankByMarkets(ids: string[]): Promise<string[]> {
    try {
      const ranked = await this.fetchMarketsAndRank(ids);
      return ranked.length > 0 ? ranked : ids;
    } catch (e) {
      console.log("[CoinGecko:rankByMarkets] ranking failed, fallback to input order", e instanceof Error ? e.message : String(e));
      return ids;
    }
  }

  private async fetchMarketsAndRank(ids: string[]): Promise<string[]> {
    // Note: CoinGecko markets endpoint supports comma-separated ids; default vs_currency=usd
    // We'll request top metrics and sort by market_cap desc, then total_volume desc, then market_cap_rank asc
    const isPro = Boolean(this.proApiKey);
    const baseUrl = isPro ? "https://pro-api.coingecko.com/api/v3" : "https://api.coingecko.com/api/v3";
    const params = new URLSearchParams({
      vs_currency: "usd",
      ids: ids.join(","),
      per_page: String(Math.max(1, ids.length)),
      page: "1",
      price_change_percentage: "24h",
      locale: "en",
    });
    const url = `${baseUrl}/coins/markets?${params.toString()}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const r = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          ...(isPro && this.proApiKey ? { "x-cg-pro-api-key": this.proApiKey } : {}),
          "User-Agent": "ElizaOS-CoinGecko-Plugin/1.0",
        },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!r.ok) return ids;
      const rows = (await r.json()) as Array<{
        id: string;
        market_cap?: number | null;
        total_volume?: number | null;
        market_cap_rank?: number | null;
      }>;
      return rows
        .slice()
        .sort((a, b) => {
          const volA = typeof a.total_volume === "number" ? a.total_volume : 0;
          const volB = typeof b.total_volume === "number" ? b.total_volume : 0;
          if (volB !== volA) return volB - volA; // prioritize higher volume

          const mcA = typeof a.market_cap === "number" ? a.market_cap : 0;
          const mcB = typeof b.market_cap === "number" ? b.market_cap : 0;
          if (mcB !== mcA) return mcB - mcA; // then higher market cap

          const rankA = typeof a.market_cap_rank === "number" && a.market_cap_rank > 0 ? a.market_cap_rank : 10_000_000;
          const rankB = typeof b.market_cap_rank === "number" && b.market_cap_rank > 0 ? b.market_cap_rank : 10_000_000;
          return rankA - rankB; // then lower rank
        })
        .map((row) => row.id);
    } catch (e) {
      clearTimeout(timeout);
      console.log("[CoinGecko:fetchMarketsAndRank] fetch failed", e instanceof Error ? e.message : String(e));
      return ids;
    }
  }

  /**
   * Get trending tokens/pools from GeckoTerminal API for a specific network
   * Note: GeckoTerminal API does not have a Pro tier, uses public API only.
   */
  async getTrendingTokens(network: string = "base", limit: number = 10): Promise<any> {
    const baseUrl = "https://api.geckoterminal.com/api/v2";
    const page = 1;
    const clampedLimit = Math.max(1, Math.min(30, limit));

    const url = `${baseUrl}/networks/${network}/trending_pools?include=base_token,quote_token&page=${page}&limit=${clampedLimit}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      logger.debug(`[CoinGecko] GET ${url}`);
      const res = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "User-Agent": "ElizaOS-CoinGecko-Plugin/1.0",
        },
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!res.ok) {
        const body = await safeReadJson(res);
        const msg = `GeckoTerminal API error ${res.status}: ${res.statusText}${body ? ` - ${JSON.stringify(body)}` : ""}`;
        logger.warn(`[CoinGecko] trending tokens request failed for ${network}: ${msg}`);
        throw new Error(msg);
      }

      const data = await res.json();

      // Create a map of tokens by their ID for quick lookup
      const tokenMap = new Map<string, any>();
      const included = Array.isArray((data as any).included) ? (data as any).included : [];
      
      included
        .filter((item: any) => item.type === "token")
        .forEach((token: any) => {
          const attrs = token.attributes || {};
          tokenMap.set(token.id, {
            name: attrs.name || null,
            symbol: attrs.symbol || null,
            decimals: attrs.decimals || null,
            image: attrs.image_url || null,
            coingecko_coin_id: attrs.coingecko_coin_id || null,
            address: attrs.address || null,
          });
        });

      // Parse and format the response - flatten pools with base token data
      const pools = Array.isArray((data as any).data) ? (data as any).data : [];
      const trendingTokens = pools.map((pool: any, index: number) => {
        const attrs = pool.attributes || {};
        const relationships = pool.relationships || {};
        const baseTokenId = relationships.base_token?.data?.id || null;
        const baseToken = baseTokenId ? tokenMap.get(baseTokenId) : null;

        const priceChangePct = attrs.price_change_percentage || {};
        
        return {
          id: baseTokenId,
          name: baseToken?.name || null,
          symbol: baseToken?.symbol || null,
          image: baseToken?.image || null,
          price_usd: parseFloat(attrs.base_token_price_usd) || null,
          market_cap_usd: attrs.market_cap_usd ? parseFloat(attrs.market_cap_usd) : null,
          volume_24h_usd: attrs.volume_usd?.h24 ? parseFloat(attrs.volume_usd.h24) : null,
          price_change_percentage_24h: priceChangePct.h24 ? parseFloat(priceChangePct.h24) : null,
          network,
          address: baseToken?.address || null,
          rank: index + 1,
          liquidity_usd: attrs.reserve_in_usd ? parseFloat(attrs.reserve_in_usd) : null,
          fdv_usd: attrs.fdv_usd ? parseFloat(attrs.fdv_usd) : null,
          price_change_percentage_1h: priceChangePct.h1 ? parseFloat(priceChangePct.h1) : null,
          price_change_percentage_7d: null, // Not available in GeckoTerminal API
          price_change_percentage_30d: null, // Not available in GeckoTerminal API
          holders_count: null, // Not available in GeckoTerminal API
          created_at: null, // Token creation date not available
          pool_created_at: attrs.pool_created_at || null,
          trending_score: null, // Not provided by API
        };
      });

      return trendingTokens;
    } catch (err) {
      clearTimeout(timeout);
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[CoinGecko] getTrendingTokens failed for ${network}: ${msg}`);
      throw err;
    }
  }

  /**
   * Get NFT collection statistics including floor price, volume, market cap, and owners
   * Uses Pro API when COINGECKO_API_KEY is set; otherwise public API.
   */
  async getNFTCollectionStats(collectionIdentifier: string): Promise<any> {
    const isPro = Boolean(this.proApiKey);
    const baseUrl = isPro ? "https://pro-api.coingecko.com/api/v3" : "https://api.coingecko.com/api/v3";
    
    let collectionId = collectionIdentifier.trim().toLowerCase();

    // If it's a contract address, try to look it up first
    // For now, we'll assume the user provides the collection ID directly
    // In the future, we could add a lookup by contract address

    const url = `${baseUrl}/nfts/${encodeURIComponent(collectionId)}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      logger.debug(`[CoinGecko] GET ${url}`);
      const res = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          ...(isPro && this.proApiKey ? { "x-cg-pro-api-key": this.proApiKey } : {}),
          "User-Agent": "ElizaOS-CoinGecko-Plugin/1.0",
        },
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!res.ok) {
        const body = await safeReadJson(res);
        const msg = `CoinGecko NFT API error ${res.status}: ${res.statusText}${body ? ` - ${JSON.stringify(body)}` : ""}`;
        logger.warn(`[CoinGecko] NFT collection stats request failed for ${collectionId}: ${msg}`);
        throw new Error(msg);
      }

      const data = (await res.json()) as any;

      // Format the response
      const floorPrice = data.floor_price || {};
      const marketCap = data.market_cap || {};
      const volume24h = data.volume_24h || {};

      return {
        id: data.id || collectionId,
        name: data.name || null,
        symbol: data.symbol || null,
        description: data.description || null,
        image: data.image?.large || data.image?.small || data.image?.thumb || null,
        contract_address: data.contract_address || null,
        asset_platform_id: data.asset_platform_id || null,
        
        // Floor price data
        floor_price_usd: floorPrice.usd || null,
        floor_price_native: floorPrice.native_currency || null,
        floor_price_24h_change_percentage: data.floor_price_24h_percentage_change?.usd || null,
        
        // Market cap
        market_cap_usd: marketCap.usd || null,
        market_cap_native: marketCap.native_currency || null,
        
        // Volume
        volume_24h_usd: volume24h.usd || null,
        volume_24h_native: volume24h.native_currency || null,
        volume_24h_change_percentage: data.volume_24h_percentage_change?.usd || null,
        
        // Collection stats
        total_supply: data.total_supply || null,
        number_of_unique_addresses: data.number_of_unique_addresses || null,
        number_of_unique_addresses_24h_percentage_change: data.number_of_unique_addresses_24h_percentage_change || null,
        
        // Links
        homepage: data.links?.homepage || null,
        twitter: data.links?.twitter || null,
        discord: data.links?.discord || null,
        
        // Additional metadata
        native_currency: data.native_currency || null,
        native_currency_symbol: data.native_currency_symbol || null,
        
        // Raw data for reference
        raw_data: data,
      };
    } catch (err) {
      clearTimeout(timeout);
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[CoinGecko] getNFTCollectionStats failed for ${collectionId}: ${msg}`);
      throw err;
    }
  }

  /**
   * Get trending searches from CoinGecko including coins, NFTs, and categories
   * Uses Pro API when COINGECKO_API_KEY is set; otherwise public API.
   */
  async getTrendingSearch(): Promise<any> {
    const isPro = Boolean(this.proApiKey);
    const baseUrl = isPro ? "https://pro-api.coingecko.com/api/v3" : "https://api.coingecko.com/api/v3";
    
    const url = `${baseUrl}/search/trending`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      logger.debug(`[CoinGecko] GET ${url}`);
      const res = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          ...(isPro && this.proApiKey ? { "x-cg-pro-api-key": this.proApiKey } : {}),
          "User-Agent": "ElizaOS-CoinGecko-Plugin/1.0",
        },
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!res.ok) {
        const body = await safeReadJson(res);
        const msg = `CoinGecko trending search API error ${res.status}: ${res.statusText}${body ? ` - ${JSON.stringify(body)}` : ""}`;
        logger.warn(`[CoinGecko] trending search request failed: ${msg}`);
        throw new Error(msg);
      }

      const data = (await res.json()) as any;

      // Format trending coins
      const trendingCoins = (Array.isArray(data.coins) ? data.coins : []).map((coinWrapper: any, index: number) => {
        const coin = coinWrapper.item || {};
        const coinData = coin.data || {};
        const priceChangePercentage24h = coinData.price_change_percentage_24h || {};

        return {
          rank: index + 1,
          name: coin.name || null,
          symbol: coin.symbol || null,
          market_cap_rank: coin.market_cap_rank || null,
          price_usd: coinData.price || null,
          price_change_24h: priceChangePercentage24h.usd || null,
          market_cap: coinData.market_cap || null,
          volume_24h: coinData.total_volume || null,
          search_score: coin.score || 0,
        };
      });

      // Format trending NFTs
      const trendingNFTs = (Array.isArray(data.nfts) ? data.nfts : []).map((nft: any, index: number) => {
        const nftData = nft.data || {};
        
        return {
          rank: index + 1,
          name: nft.name || null,
          symbol: nft.symbol || null,
          floor_price: nftData.floor_price || null,
          floor_price_change_24h: nftData.floor_price_in_usd_24h_percentage_change || null,
          volume_24h: nftData.h24_volume || null,
          avg_sale_price: nftData.h24_average_sale_price || null,
        };
      });

      // Format trending categories
      const trendingCategories = (Array.isArray(data.categories) ? data.categories : []).map((category: any, index: number) => {
        const categoryData = category.data || {};
        
        return {
          rank: index + 1,
          name: category.name || null,
          coins_count: category.coins_count?.toString() || null,
          market_cap_change_24h: categoryData.market_cap_change_percentage_24h?.usd || category.market_cap_change_24h || null,
          total_market_cap: categoryData.market_cap ? categoryData.market_cap.toString() : category.total_market_cap?.toString() || null,
          total_volume: categoryData.total_volume ? categoryData.total_volume.toString() : category.total_volume?.toString() || null,
        };
      });

      return {
        trending_coins: trendingCoins,
        trending_nfts: trendingNFTs,
        trending_categories: trendingCategories,
      };
    } catch (err) {
      clearTimeout(timeout);
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[CoinGecko] getTrendingSearch failed: ${msg}`);
      throw err;
    }
  }

  /**
   * Get token price chart data for visualization
   * Similar to what TokenDetailModal.tsx does
   */
  async getTokenPriceChart(
    tokenIdentifier: string,
    timeframe: string = '24h',
    chain: string = 'base'
  ): Promise<any> {
    const isPro = Boolean(this.proApiKey);
    const baseUrl = isPro ? "https://pro-api.coingecko.com/api/v3" : "https://api.coingecko.com/api/v3";

    // Map timeframes to days
    const daysMap: Record<string, string> = {
      '1h': '1',
      '24h': '1',
      '7d': '7',
      '30d': '30',
      '1y': '365',
    };
    const days = daysMap[timeframe] || '1';

    let url: string;
    let tokenSymbol: string | null = null;
    let currentPrice: number | null = null;

    // Check if it's a contract address (0x...)
    const isContractAddress = /^0x[a-fA-F0-9]{40}$/.test(tokenIdentifier);

    if (isContractAddress) {
      // ERC20 token - use contract address
      const platformMap: Record<string, string> = {
        base: 'base',
        ethereum: 'ethereum',
        polygon: 'polygon-pos',
      };
      const platform = platformMap[chain.toLowerCase()] || chain;
      url = `${baseUrl}/coins/${platform}/contract/${tokenIdentifier}/market_chart?vs_currency=usd&days=${days}`;
      
      // Try to get token symbol from a separate call
      try {
        const infoUrl = `${baseUrl}/coins/${platform}/contract/${tokenIdentifier}`;
        const infoRes = await fetch(infoUrl, {
          headers: {
            Accept: 'application/json',
            ...(isPro && this.proApiKey ? { 'x-cg-pro-api-key': this.proApiKey } : {}),
            'User-Agent': 'ElizaOS-CoinGecko-Plugin/1.0',
          },
        });
        if (infoRes.ok) {
          const info = (await infoRes.json()) as any;
          tokenSymbol = info.symbol?.toUpperCase() || null;
          currentPrice = info.market_data?.current_price?.usd || null;
        }
      } catch (e) {
        logger.warn(`[CoinGecko] Failed to fetch token info for ${tokenIdentifier}`);
      }
    } else {
      // Try to resolve as native token or coin ID
      const nativeTokenIds: Record<string, string> = {
        'eth': 'ethereum',
        'ethereum': 'ethereum',
        'btc': 'bitcoin',
        'bitcoin': 'bitcoin',
        'matic': 'polygon-ecosystem-token',
        'pol': 'polygon-ecosystem-token',
        'polygon': 'polygon-ecosystem-token',
        'sol': 'solana',
        'solana': 'solana',
        'bnb': 'binancecoin',
      };

      const normalizedToken = tokenIdentifier.toLowerCase();
      
      // Check if it's a native token
      let coinId: string;
      if (nativeTokenIds[normalizedToken]) {
        coinId = nativeTokenIds[normalizedToken];
        tokenSymbol = tokenIdentifier.toUpperCase();
      } else {
        // Not a native token, use getTokenMetadata to get the coin ID
        logger.info(`[CoinGecko] Token ${tokenIdentifier} is not a native token or address, using getTokenMetadata to resolve coin ID`);
        try {
          const metadataResults = await this.getTokenMetadata([tokenIdentifier]);
          if (metadataResults.length > 0 && metadataResults[0].success && metadataResults[0].data) {
            coinId = metadataResults[0].data.id;
            tokenSymbol = metadataResults[0].data.symbol?.toUpperCase() || tokenIdentifier.toUpperCase();
            currentPrice = metadataResults[0].data.current_price || null;
            logger.info(`[CoinGecko] Resolved ${tokenIdentifier} to coin ID: ${coinId}`);
          } else {
            // Fallback to using tokenIdentifier as coin ID if metadata lookup fails
            logger.warn(`[CoinGecko] Failed to resolve ${tokenIdentifier} via getTokenMetadata, using as-is`);
            coinId = normalizedToken;
            tokenSymbol = tokenIdentifier.toUpperCase();
          }
        } catch (e) {
          logger.warn(`[CoinGecko] Error calling getTokenMetadata for ${tokenIdentifier}, using as-is: ${e}`);
          coinId = normalizedToken;
          tokenSymbol = tokenIdentifier.toUpperCase();
        }
      }

      url = `${baseUrl}/coins/${coinId}/market_chart?vs_currency=usd&days=${days}`;
    }

    // Add interval for long ranges
    if (timeframe === '1y') {
      url += `&interval=daily`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      logger.debug(`[CoinGecko] GET ${url}`);
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          ...(isPro && this.proApiKey ? { 'x-cg-pro-api-key': this.proApiKey } : {}),
          'User-Agent': 'ElizaOS-CoinGecko-Plugin/1.0',
        },
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!res.ok) {
        const body = await safeReadJson(res);
        const msg = `CoinGecko price chart API error ${res.status}: ${res.statusText}${body ? ` - ${JSON.stringify(body)}` : ''}`;
        logger.warn(`[CoinGecko] price chart request failed for ${tokenIdentifier}: ${msg}`);
        throw new Error(msg);
      }

      const data = (await res.json()) as any;
      const prices = data.prices || [];

      // Filter data based on timeframe
      let filteredPrices = prices;
      if (timeframe === '1h') {
        // Last hour - get last 60 data points
        filteredPrices = prices.slice(-60);
      }

      // Format data points
      const dataPoints = filteredPrices.map(([timestamp, price]: [number, number]) => ({
        timestamp,
        price,
        date: this.formatDateForTimeframe(timestamp, timeframe),
      }));

      // Get current price from last data point if not already set
      if (!currentPrice && dataPoints.length > 0) {
        currentPrice = dataPoints[dataPoints.length - 1].price;
      }

      return {
        token_identifier: tokenIdentifier,
        token_symbol: tokenSymbol,
        chain: chain,
        timeframe: timeframe,
        current_price: currentPrice,
        data_points: dataPoints,
        data_points_count: dataPoints.length,
      };
    } catch (err) {
      clearTimeout(timeout);
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[CoinGecko] getTokenPriceChart failed for ${tokenIdentifier}: ${msg}`);
      throw err;
    }
  }

  /**
   * Helper method to format dates based on timeframe
   */
  private formatDateForTimeframe(timestamp: number, timeframe: string): string {
    const date = new Date(timestamp);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    
    switch (timeframe) {
      case '1h':
      case '24h':
        return `${hours}:${minutes}`;
      case '7d':
      case '30d':
        return `${month}/${day}`;
      case '1y':
        const year = String(date.getFullYear()).slice(-2);
        return `${month}/${year}`;
      default:
        return `${day}/${month}`;
    }
  }
}

function isEvmAddress(s: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(s);
}

function isSolanaAddress(s: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
}


