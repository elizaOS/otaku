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

interface MarketRow {
  id: string;
  market_cap?: number | null;
  total_volume?: number | null;
  market_cap_rank?: number | null;
}

export interface TokenMetadataCandidate {
  id: string;
  coinId: string;
  confidence: number;
  marketCap: number | null;
  totalVolume: number | null;
  marketCapRank: number | null;
  metadata?: Record<string, unknown>;
}

export interface TokenMetadataResolution {
  id: string;
  success: boolean;
  resolvedCoinId?: string;
  data?: Record<string, unknown>;
  error?: string;
  candidates: TokenMetadataCandidate[];
}

/**
 * Map of native token symbols to their CoinGecko IDs
 * These tokens can be used directly by symbol in price chart queries
 */
export const nativeTokenIds: Record<string, string> = {
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

export class CoinGeckoService extends Service {
  static serviceType = "COINGECKO_SERVICE" as const;
  capabilityDescription = "Fetch token metadata from CoinGecko (free or Pro).";

  private proApiKey: string | undefined;
  private coinsCache: Array<{ id: string; symbol: string; name: string }> = [];
  private idSet = new Set<string>();
  private symbolToIds = new Map<string, string[]>();
  private nameToIds = new Map<string, string[]>();
  private coinDetailCache = new Map<string, CoinGeckoTokenMetadata>();

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
  async getTokenMetadata(ids: string | string[]): Promise<TokenMetadataResolution[]> {
    const normalizedIds = (Array.isArray(ids) ? ids : [ids])
      .map((identifier) => (identifier || "").trim())
      .filter((identifier) => identifier.length > 0);
    const isPro = Boolean(this.proApiKey);
    const baseUrl = isPro ? "https://pro-api.coingecko.com/api/v3" : "https://api.coingecko.com/api/v3";

    const results: TokenMetadataResolution[] = [];

    for (const rawId of normalizedIds) {
      const q = rawId.trim();

      if (isEvmAddress(q)) {
        const resolution = await this.handleContractLookup(
          baseUrl,
          q,
          ["ethereum", "base", "arbitrum-one", "optimistic-ethereum", "polygon-pos", "bsc"],
          "EVM",
        );
        results.push(resolution);
        continue;
      }

      if (isSolanaAddress(q)) {
        const resolution = await this.handleContractLookup(baseUrl, q, ["solana"], "Solana");
        results.push(resolution);
        continue;
      }

      let candidates: TokenMetadataCandidate[] = [];
      try {
        candidates = await this.resolveCandidates(q);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn(`[CoinGecko] resolveCandidates failed for ${q}: ${message}`);
      }

      if (candidates.length === 0) {
        results.push({
          id: q,
          success: false,
          error: `Unknown coin id/symbol/name: ${q}`,
          candidates: [],
        });
        continue;
      }

      const enrichedCandidates = await this.enrichCandidateMetadata(baseUrl, candidates);
      const primaryCandidate = enrichedCandidates.find((candidate) => Boolean(candidate.metadata));

      if (!primaryCandidate) {
        results.push({
          id: q,
          success: false,
          error: `Failed to fetch metadata for candidates: ${q}`,
          candidates: enrichedCandidates,
        });
        continue;
      }

      results.push({
        id: q,
        success: true,
        resolvedCoinId: primaryCandidate.coinId,
        data: primaryCandidate.metadata,
        candidates: enrichedCandidates,
      });
    }

    return results;
  }

  private async fetchByContractAddress(
    baseUrl: string,
    address: string,
    platforms: string[],
  ): Promise<Record<string, unknown> | null> {
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

        const data = (await res.json()) as CoinGeckoTokenMetadata;
        const tokenId = typeof data.id === "string" && data.id.length > 0 ? data.id : platform;
        return formatCoinMetadata(tokenId, data, platform) as Record<string, unknown>;
      } catch {
        // try next platform
      }
    }
    return null;
  }

  private async handleContractLookup(
    baseUrl: string,
    address: string,
    platforms: string[],
    networkLabel: string,
  ): Promise<TokenMetadataResolution> {
    try {
      const metadata = await this.fetchByContractAddress(baseUrl, address, platforms);
      if (!metadata) {
        return {
          id: address,
          success: false,
          error: `No CoinGecko match for ${networkLabel} address: ${address}`,
          candidates: [],
        };
      }

      const coinId = this.extractCoinId(metadata, address);
      const ranked = await this.rankByMarkets([coinId]);
      const metrics = ranked[0] ?? {
        id: coinId,
        coinId,
        confidence: 1,
        marketCap: null,
        totalVolume: null,
        marketCapRank: null,
      };

      const candidate: TokenMetadataCandidate = {
        ...metrics,
        confidence: 1,
        metadata,
      };

      return {
        id: address,
        success: true,
        resolvedCoinId: candidate.coinId,
        data: candidate.metadata,
        candidates: [candidate],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`[CoinGecko] Contract lookup failed for ${address}: ${message}`);
      return {
        id: address,
        success: false,
        error: message,
        candidates: [],
      };
    }
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

  private async resolveCandidates(input: string): Promise<TokenMetadataCandidate[]> {
    const query = (input || "").trim().toLowerCase();
    if (!query) {
      return [];
    }

    const candidateIds = new Set<string>();

    if (this.idSet.has(query)) {
      candidateIds.add(query);
    }

    const symbolMatches = this.symbolToIds.get(query);
    if (symbolMatches) {
      symbolMatches.forEach((id) => candidateIds.add(id));
    }

    const nameMatches = this.nameToIds.get(query);
    if (nameMatches) {
      nameMatches.forEach((id) => candidateIds.add(id));
    }

    if (candidateIds.size > 0) {
      const ranked = await this.rankByMarkets(Array.from(candidateIds));
      if (ranked.length > 0) {
        logger.debug({ query, ranked: ranked.map((candidate) => candidate.coinId) }, "[CoinGecko] Ranked candidate matches");
        return ranked;
      }

      const uniformConfidence = 1 / candidateIds.size;
      return Array.from(candidateIds).map((id) => ({
        id,
        coinId: id,
        confidence: uniformConfidence,
        marketCap: null,
        totalVolume: null,
        marketCapRank: null,
      }));
    }

    const nearSymbols = Array.from(this.symbolToIds.keys())
      .filter((key) => key === query || key.startsWith(query) || key.includes(query))
      .slice(0, 10);
    const nearNames = Array.from(this.nameToIds.keys())
      .filter((key) => key === query || key.startsWith(query) || key.includes(query))
      .slice(0, 10);

    logger.debug({ query, nearSymbols, nearNames }, "[CoinGecko] No direct candidate matches");
    return [];
  }

  private async rankByMarkets(ids: string[]): Promise<TokenMetadataCandidate[]> {
    if (ids.length === 0) {
      return [];
    }

    const rows = await this.fetchMarketRows(ids);
    const rowMap = new Map<string, MarketRow>();
    rows.forEach((row) => {
      rowMap.set(row.id, row);
    });

    const candidates = ids.map<TokenMetadataCandidate>((id) => {
      const marketRow = rowMap.get(id);
      const marketCap = typeof marketRow?.market_cap === "number" ? marketRow.market_cap : null;
      const totalVolume = typeof marketRow?.total_volume === "number" ? marketRow.total_volume : null;
      const marketCapRank = typeof marketRow?.market_cap_rank === "number" ? marketRow.market_cap_rank : null;
      return {
        id,
        coinId: id,
        confidence: 0,
        marketCap,
        totalVolume,
        marketCapRank,
      };
    });

    if (candidates.length === 1) {
      return [{ ...candidates[0], confidence: 1 }];
    }

    const capValues = candidates.map((candidate) => candidate.marketCap ?? 0);
    const volumeValues = candidates.map((candidate) => candidate.totalVolume ?? 0);
    const maxCap = capValues.length > 0 ? Math.max(...capValues) : 0;
    const maxVolume = volumeValues.length > 0 ? Math.max(...volumeValues) : 0;

    const scored = candidates.map((candidate) => {
      const capScore = maxCap > 0 ? (candidate.marketCap ?? 0) / maxCap : 0;
      const volumeScore = maxVolume > 0 ? (candidate.totalVolume ?? 0) / maxVolume : 0;
      const rankScore = candidate.marketCapRank && candidate.marketCapRank > 0 ? 1 / candidate.marketCapRank : 0;
      const rawScore = capScore * 0.65 + volumeScore * 0.25 + rankScore * 0.1;
      return {
        candidate,
        rawScore,
      };
    });

    const totalScore = scored.reduce((sum, entry) => sum + entry.rawScore, 0);
    const fallbackConfidence = scored.length > 0 ? 1 / scored.length : 0;

    return scored
      .map((entry) => ({
        ...entry.candidate,
        confidence: totalScore > 0 ? entry.rawScore / totalScore : fallbackConfidence,
      }))
      .sort((a, b) => b.confidence - a.confidence);
  }

  private async fetchMarketRows(ids: string[]): Promise<MarketRow[]> {
    if (ids.length === 0) {
      return [];
    }

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
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          ...(isPro && this.proApiKey ? { "x-cg-pro-api-key": this.proApiKey } : {}),
          "User-Agent": "ElizaOS-CoinGecko-Plugin/1.0",
        },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        const body = await safeReadJson(response);
        logger.debug(
          {
            status: response.status,
            statusText: response.statusText,
            body,
            ids,
          },
          "[CoinGecko] fetchMarketRows request failed",
        );
        return [];
      }

      const rows = (await response.json()) as MarketRow[];
      return rows.filter((row) => ids.includes(row.id));
    } catch (error) {
      clearTimeout(timeout);
      const message = error instanceof Error ? error.message : String(error);
      logger.debug({ ids, message }, "[CoinGecko] fetchMarketRows error");
      return [];
    }
  }

  private async enrichCandidateMetadata(
    baseUrl: string,
    candidates: TokenMetadataCandidate[],
    limit: number = 3,
  ): Promise<TokenMetadataCandidate[]> {
    if (candidates.length === 0) {
      return [];
    }

    const cappedLimit = Math.max(1, Math.min(limit, candidates.length));
    const primaryCandidates = candidates.slice(0, cappedLimit);
    const enriched: TokenMetadataCandidate[] = [];

    for (const candidate of primaryCandidates) {
      const detail = await this.fetchCoinDetail(baseUrl, candidate.coinId);
      if (detail) {
        const formatted = formatCoinMetadata(candidate.coinId, detail) as Record<string, unknown>;
        enriched.push({
          ...candidate,
          metadata: formatted,
        });
      } else {
        enriched.push(candidate);
      }
    }

    if (cappedLimit < candidates.length) {
      enriched.push(...candidates.slice(cappedLimit));
    }

    return enriched;
  }

  private async fetchCoinDetail(baseUrl: string, coinId: string): Promise<CoinGeckoTokenMetadata | null> {
    if (this.coinDetailCache.has(coinId)) {
      return this.coinDetailCache.get(coinId) ?? null;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const url = `${baseUrl}/coins/${encodeURIComponent(coinId)}`;
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          ...(this.proApiKey ? { "x-cg-pro-api-key": this.proApiKey } : {}),
          "User-Agent": "ElizaOS-CoinGecko-Plugin/1.0",
        },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        const body = await safeReadJson(response);
        logger.debug(
          {
            coinId,
            status: response.status,
            statusText: response.statusText,
            body,
          },
          "[CoinGecko] fetchCoinDetail request failed",
        );
        return null;
      }

      const data = (await response.json()) as CoinGeckoTokenMetadata;
      this.coinDetailCache.set(coinId, data);
      return data;
    } catch (error) {
      clearTimeout(timeout);
      const message = error instanceof Error ? error.message : String(error);
      logger.debug({ coinId, message }, "[CoinGecko] fetchCoinDetail error");
      return null;
    }
  }

  private extractCoinId(metadata: Record<string, unknown>, fallback: string): string {
    const attributesRaw = (metadata as { attributes?: unknown }).attributes;
    if (attributesRaw && typeof attributesRaw === "object") {
      const coinIdValue = (attributesRaw as { coingecko_coin_id?: unknown }).coingecko_coin_id;
      if (typeof coinIdValue === "string" && coinIdValue.trim().length > 0) {
        return coinIdValue;
      }
    }
    return fallback;
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
      const normalizedToken = tokenIdentifier.toLowerCase();
      const coinId = nativeTokenIds[normalizedToken] || normalizedToken;

      url = `${baseUrl}/coins/${coinId}/market_chart?vs_currency=usd&days=${days}`;
      tokenSymbol = tokenIdentifier.toUpperCase();
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
      const marketCaps = data.market_caps || [];

      // Filter data based on timeframe
      let filteredPrices = prices;
      let filteredMarketCaps = marketCaps;
      if (timeframe === '1h') {
        // Last hour - get last 60 data points
        filteredPrices = prices.slice(-60);
        filteredMarketCaps = marketCaps.slice(-60);
      }

      // Format price data points
      const dataPoints = filteredPrices.map(([timestamp, price]: [number, number]) => ({
        timestamp,
        price,
        date: this.formatDateForTimeframe(timestamp, timeframe),
      }));

      // Format market cap data points
      const marketCapDataPoints = filteredMarketCaps.map(([timestamp, marketCap]: [number, number]) => ({
        timestamp,
        marketCap,
        date: this.formatDateForTimeframe(timestamp, timeframe),
      }));

      // Get current price from last data point if not already set
      if (!currentPrice && dataPoints.length > 0) {
        currentPrice = dataPoints[dataPoints.length - 1].price;
      }

      // Get current market cap
      const currentMarketCap = marketCapDataPoints.length > 0 
        ? marketCapDataPoints[marketCapDataPoints.length - 1].marketCap 
        : null;

      return {
        token_identifier: tokenIdentifier,
        token_symbol: tokenSymbol,
        chain: chain,
        timeframe: timeframe,
        current_price: currentPrice,
        current_market_cap: currentMarketCap,
        data_points: dataPoints,
        market_cap_data_points: marketCapDataPoints,
        data_points_count: dataPoints.length,
        market_cap_data_points_count: marketCapDataPoints.length,
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

  /**
   * Get list of all coin categories (ID map)
   * Uses Pro API when COINGECKO_API_KEY is set; otherwise public API.
   */
  async getCategoriesList(): Promise<Array<{ category_id: string; name: string }>> {
    const isPro = Boolean(this.proApiKey);
    const baseUrl = isPro ? "https://pro-api.coingecko.com/api/v3" : "https://api.coingecko.com/api/v3";
    
    const url = `${baseUrl}/coins/categories/list`;

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
        const msg = `CoinGecko categories list API error ${res.status}: ${res.statusText}${body ? ` - ${JSON.stringify(body)}` : ""}`;
        logger.warn(`[CoinGecko] categories list request failed: ${msg}`);
        throw new Error(msg);
      }

      const data = (await res.json()) as Array<{ category_id: string; name: string }>;
      return data;
    } catch (err) {
      clearTimeout(timeout);
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[CoinGecko] getCategoriesList failed: ${msg}`);
      throw err;
    }
  }

  /**
   * Get list of all coin categories with market data
   * Uses Pro API when COINGECKO_API_KEY is set; otherwise public API.
   */
  async getCategoriesWithMarketData(
    order: 'market_cap_desc' | 'market_cap_asc' | 'name_desc' | 'name_asc' | 'market_cap_change_24h_desc' | 'market_cap_change_24h_asc' = 'market_cap_desc'
  ): Promise<Array<{
    id: string;
    name: string;
    market_cap: number;
    market_cap_change_24h: number;
    content: string;
    top_3_coins_id: string[];
    top_3_coins: string[];
    volume_24h: number;
    updated_at: string;
  }>> {
    const isPro = Boolean(this.proApiKey);
    const baseUrl = isPro ? "https://pro-api.coingecko.com/api/v3" : "https://api.coingecko.com/api/v3";
    
    const params = new URLSearchParams();
    if (order) {
      params.append('order', order);
    }

    const url = `${baseUrl}/coins/categories${params.toString() ? `?${params.toString()}` : ''}`;

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
        const msg = `CoinGecko categories API error ${res.status}: ${res.statusText}${body ? ` - ${JSON.stringify(body)}` : ""}`;
        logger.warn(`[CoinGecko] categories request failed: ${msg}`);
        throw new Error(msg);
      }

      const data = (await res.json()) as Array<{
        id: string;
        name: string;
        market_cap: number;
        market_cap_change_24h: number;
        content: string;
        top_3_coins_id: string[];
        top_3_coins: string[];
        volume_24h: number;
        updated_at: string;
      }>;

      return data;
    } catch (err) {
      clearTimeout(timeout);
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[CoinGecko] getCategoriesWithMarketData failed: ${msg}`);
      throw err;
    }
  }
}

function isEvmAddress(s: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(s);
}

function isSolanaAddress(s: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
}


