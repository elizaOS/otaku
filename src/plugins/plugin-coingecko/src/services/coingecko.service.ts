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
}

function isEvmAddress(s: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(s);
}

function isSolanaAddress(s: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
}


