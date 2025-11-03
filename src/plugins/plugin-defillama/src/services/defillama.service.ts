import { logger, Service, type IAgentRuntime } from "@elizaos/core";

type ChainTvlsRawRecord = Record<string, number | string | null | { tvl?: number }>;

export type DefiLlamaProtocol = {
  id: string;
  name: string;
  symbol: string | null;
  slug?: string;
  url?: string;
  logo?: string;
  category?: string;
  chains?: string[];
  address?: string;
  gecko_id?: string;
  cmcId?: string;
  twitter?: string;
  tvl?: number;
  change_1h?: number;
  change_1d?: number;
  change_7d?: number;
  chainTvls?: ChainTvlsRawRecord;
};

export type YieldPool = {
  pool: string;
  project: string;
  chain: string;
  symbol: string;
  tvlUsd: number;
  apy: number | null;
  apyBase: number | null;
  apyReward: number | null;
  rewardTokens: string[] | null;
  stablecoin: boolean;
  underlyingTokens: string[] | null;
  apyPct1D: number | null;
  apyPct7D: number | null;
  apyPct30D: number | null;
  apyMean30d: number | null;
};

export type YieldChartPoint = {
  timestamp: string;
  tvlUsd: number;
  apy: number | null;
  apyBase: number | null;
  apyReward: number | null;
};

type RawYieldPool = {
  pool?: string;
  project?: string;
  chain?: string;
  symbol?: string;
  tvlUsd?: number;
  apy?: number | null;
  apyBase?: number | null;
  apyReward?: number | null;
  rewardTokens?: string[] | null;
  stablecoin?: boolean;
  underlyingTokens?: string[] | null;
  apyPct1D?: number | null;
  apyPct7D?: number | null;
  apyPct30D?: number | null;
  apyMean30d?: number | null;
};

export type ProtocolTvlPoint = {
  date: number;
  totalLiquidityUsd: number;
};

export type ProtocolTvlHistory = {
  slug: string;
  name: string;
  symbol: string | null;
  currentTvl: number | null;
  lastUpdated: number | null;
  totalSeries: ProtocolTvlPoint[];
  chainSeries: Record<string, ProtocolTvlPoint[]>;
};

export type ChainTvlPoint = {
  date: number;
  tvl: number;
};

export type ChainTvlHistoryOptions = {
  filter?: string;
};

export type ProtocolSummary = {
  id: string;
  slug: string | null;
  name: string;
  symbol: string | null;
  url: string | null;
  logo: string | null;
  category: string | null;
  chains: string[];
  address: string | null;
  geckoId: string | null;
  cmcId: string | null;
  twitter: string | null;
  tvl: number | null;
  tvlChange1h: number | null;
  tvlChange1d: number | null;
  tvlChange7d: number | null;
  chainTvls: Record<string, number>;
};

export type ProtocolLookupResult = {
  id: string;
  success: boolean;
  data?: ProtocolSummary;
  error?: string;
};

export class DefiLlamaService extends Service {
  static serviceType = "defillama_protocols" as const;
  capabilityDescription = "Look up DeFiLlama protocols by name/symbol and yield opportunities (TTL-cached)";

  // Protocol TVL cache
  private cache: DefiLlamaProtocol[] = [];
  private cacheTimestampMs: number = 0;
  private ttlMs: number = 300000; // 5 minutes
  private protocolIndex: Map<string, DefiLlamaProtocol> = new Map();

  // Protocol history cache
  private protocolHistoryCache: Map<string, { timestamp: number; data: ProtocolTvlHistory }> = new Map();
  private protocolHistoryTtlMs: number = 300000;
  private protocolHistoryMaxEntries: number = 128;

  // Chain history cache
  private chainHistoryCache: Map<string, { timestamp: number; data: ChainTvlPoint[] }> = new Map();
  private chainHistoryTtlMs: number = 300000;
  private chainHistoryMaxEntries: number = 128;

  // Yields cache
  private yieldsCache: YieldPool[] = [];
  private yieldsCacheTimestampMs: number = 0;
  private yieldsTtlMs: number = 300000; // 5 minutes

  constructor(runtime: IAgentRuntime) { super(runtime); }

  static async start(runtime: IAgentRuntime): Promise<DefiLlamaService> {
    const svc = new DefiLlamaService(runtime);
    await svc.initialize(runtime);
    return svc;
  }

  async initialize(runtime: IAgentRuntime): Promise<void> {
    // Initialize protocols TTL
    const ttlSetting = runtime.getSetting("DEFILLAMA_PROTOCOLS_TTL_MS");
    if (ttlSetting) {
      const parsed = Number(ttlSetting);
      if (!Number.isNaN(parsed) && parsed >= 0) this.ttlMs = parsed;
    }

    const protocolHistoryTtlSetting = runtime.getSetting("DEFILLAMA_PROTOCOL_HISTORY_TTL_MS");
    if (protocolHistoryTtlSetting) {
      const parsed = Number(protocolHistoryTtlSetting);
      if (!Number.isNaN(parsed) && parsed >= 0) this.protocolHistoryTtlMs = parsed;
    }

    const protocolHistoryMaxSetting = runtime.getSetting("DEFILLAMA_PROTOCOL_HISTORY_MAX_ENTRIES");
    if (protocolHistoryMaxSetting) {
      const parsed = Number(protocolHistoryMaxSetting);
      if (!Number.isNaN(parsed) && parsed > 0) this.protocolHistoryMaxEntries = parsed;
    }

    const chainHistoryTtlSetting = runtime.getSetting("DEFILLAMA_CHAIN_TVL_TTL_MS");
    if (chainHistoryTtlSetting) {
      const parsed = Number(chainHistoryTtlSetting);
      if (!Number.isNaN(parsed) && parsed >= 0) this.chainHistoryTtlMs = parsed;
    }

    const chainHistoryMaxSetting = runtime.getSetting("DEFILLAMA_CHAIN_TVL_MAX_ENTRIES");
    if (chainHistoryMaxSetting) {
      const parsed = Number(chainHistoryMaxSetting);
      if (!Number.isNaN(parsed) && parsed > 0) this.chainHistoryMaxEntries = parsed;
    }

    // Initialize yields TTL
    const yieldsTtlSetting = runtime.getSetting("DEFILLAMA_YIELDS_TTL_MS");
    if (yieldsTtlSetting) {
      const parsed = Number(yieldsTtlSetting);
      if (!Number.isNaN(parsed) && parsed >= 0) this.yieldsTtlMs = parsed;
    }

    // Load both caches in parallel
    await Promise.all([
      this.loadIndex(),
      this.loadYieldsPools()
    ]);
  }

  async stop(): Promise<void> {}

  async getProtocolsByNames(names: string[]): Promise<ProtocolLookupResult[]> {
    await this.ensureFresh();
    const inputs = Array.isArray(names) ? names : [];
    const results: ProtocolLookupResult[] = [];

    for (const raw of inputs) {
      const q = (raw || "").trim();
      if (!q) {
        results.push({ id: q, success: false, error: "Empty protocol name" });
        continue;
      }

      const qLower = q.toLowerCase();

      let picked = this.protocolIndex.get(qLower) ?? null;

      if (!picked) {
        for (const protocol of this.cache) {
          const name = (protocol.name || "").toLowerCase();
          if (name.startsWith(qLower)) {
            picked = protocol;
            break;
          }
        }
      }
      if (!picked) {
        for (const protocol of this.cache) {
          const slugValue = typeof protocol.slug === "string" ? protocol.slug.toLowerCase() : "";
          if (slugValue.startsWith(qLower)) {
            picked = protocol;
            break;
          }
        }
      }

      if (picked) {
        results.push({ id: q, success: true, data: shapeProtocol(picked) });
      } else {
        results.push({ id: q, success: false, error: `No protocol match for: ${q}` });
      }
    }

    return results;
  }

  /**
   * Search for multiple protocol candidates matching a query (0-5 matches)
   * Returns protocols sorted by relevance and TVL
   */
  async searchProtocolCandidates(query: string, maxResults: number = 5): Promise<ProtocolSummary[]> {
    await this.ensureFresh();
    const q = (query || "").trim();
    if (!q) {
      return [];
    }

    const qLower = q.toLowerCase();
    const candidates: Array<{ protocol: DefiLlamaProtocol; score: number }> = [];

    for (const protocol of this.cache) {
      const name = (protocol.name || "").toLowerCase();
      const symbol = (protocol.symbol || "").toLowerCase();
      const slug = typeof protocol.slug === "string" ? protocol.slug.toLowerCase() : "";

      let score = 0;

      // Exact matches get highest priority
      if (name === qLower || symbol === qLower || slug === qLower) {
        score = 1000;
      }
      // Starts with query
      else if (name.startsWith(qLower) || symbol.startsWith(qLower) || slug.startsWith(qLower)) {
        score = 500;
      }
      // Contains query
      else if (name.includes(qLower) || symbol.includes(qLower) || slug.includes(qLower)) {
        score = 100;
      }

      if (score > 0) {
        // Boost score by TVL (protocols with higher TVL ranked higher among same match type)
        const tvlBoost = protocol.tvl ? Math.log10(protocol.tvl + 1) : 0;
        candidates.push({ protocol, score: score + tvlBoost });
      }
    }

    // Sort by score descending
    candidates.sort((a, b) => b.score - a.score);

    // Take top N results
    const topCandidates = candidates.slice(0, maxResults);

    return topCandidates.map((c) => shapeProtocol(c.protocol));
  }

  /**
   * Search for yield opportunities by protocol, token, and/or chain
   */
  async searchYields(params: {
    protocol?: string;
    token?: string;
    chain?: string;
    minApy?: number;
    stablecoinOnly?: boolean;
    limit?: number;
  }): Promise<YieldPool[]> {
    await this.ensureYieldsFresh();
    
    let results = this.yieldsCache;

    // Filter by protocol (fuzzy match)
    if (params.protocol) {
      const projectLower = params.protocol.toLowerCase();
      results = results.filter(p => 
        p.project.toLowerCase().includes(projectLower)
      );
    }

    // Filter by token symbol (exact match, case-insensitive)
    if (params.token) {
      const tokenLower = params.token.toLowerCase();
      results = results.filter(p => 
        p.symbol.toLowerCase() === tokenLower
      );
    }

    // Filter by chain (case-insensitive)
    if (params.chain) {
      const chainLower = params.chain.toLowerCase();
      results = results.filter(p => 
        p.chain.toLowerCase() === chainLower
      );
    }

    // Filter by minimum APY
    if (params.minApy !== undefined) {
      results = results.filter(p => 
        p.apy !== null && p.apy >= params.minApy!
      );
    }

    // Filter stablecoins only
    if (params.stablecoinOnly) {
      results = results.filter(p => p.stablecoin);
    }

    // Sort by APY descending (highest yields first)
    results.sort((a, b) => (b.apy || 0) - (a.apy || 0));

    // Apply limit (default to top 10)
    const limit = params.limit || 10;
    return results.slice(0, limit);
  }

  /**
   * Get historical yield chart data for a specific pool
   */
  async getPoolChart(poolId: string): Promise<YieldChartPoint[]> {
    const url = `https://yields.llama.fi/chart/${poolId}`;
    const maxAttempts = 3;
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      
      try {
        logger.debug(`[DefiLlama] Fetching chart for pool ${poolId} (attempt ${attempt}/${maxAttempts})`);
        const res = await fetch(url, {
          method: "GET",
          headers: { 
            Accept: "application/json",
            "User-Agent": "ElizaOS-DefiLlama/1.0"
          },
          signal: controller.signal
        });
        
        clearTimeout(timeout);
        if (!res.ok) throw new Error(`Failed ${res.status} ${res.statusText}`);
        
        const json = await res.json();
        return json.data || [];
      } catch (e) {
        clearTimeout(timeout);
        const isLast = attempt === maxAttempts;
        const msg = e instanceof Error ? e.message : String(e);
        
        if (isLast) {
          logger.error(`[DefiLlama] Failed to fetch chart for ${poolId} after ${maxAttempts} attempts: ${msg}`);
          throw new Error(`Failed to fetch pool chart: ${msg}`);
        }
        
        const backoff = 500 * Math.pow(2, attempt - 1);
        logger.warn(`[DefiLlama] Chart fetch failed (attempt ${attempt}): ${msg}. Retrying in ${backoff}ms...`);
        await new Promise((r) => setTimeout(r, backoff));
      }
    }
    
    return [];
  }

  async getProtocolTvlHistory(slug: string): Promise<ProtocolTvlHistory> {
    const trimmedSlug = slug.trim();
    if (!trimmedSlug) {
      throw new Error("Protocol slug is required for TVL history lookup");
    }

    const cacheKey = trimmedSlug.toLowerCase();
    const now = Date.now();
    this.evictExpiredHistoryCaches(now);
    const cached = this.protocolHistoryCache.get(cacheKey);
    if (cached && now - cached.timestamp <= this.protocolHistoryTtlMs) {
      return cached.data;
    }

    const url = `https://api.llama.fi/protocol/${encodeURIComponent(trimmedSlug)}`;
    const raw = await this.fetchJsonWithRetry<RawProtocolHistory>(url, {
      timeoutMs: 20000,
      maxAttempts: 4,
      baseDelayMs: 600,
    });

    const shaped = shapeProtocolHistory(raw, trimmedSlug);
    this.setProtocolHistoryCache(cacheKey, shaped, now);
    return shaped;
  }

  async getChainTvlHistory(chain: string, options?: ChainTvlHistoryOptions): Promise<ChainTvlPoint[]> {
    const trimmedChain = chain.trim();
    if (!trimmedChain) {
      throw new Error("Chain name is required for TVL history lookup");
    }

    const filterSegment = options?.filter?.trim();
    const cacheKey = `${trimmedChain.toLowerCase()}${filterSegment ? `__${filterSegment.toLowerCase()}` : ""}`;
    const now = Date.now();
    this.evictExpiredHistoryCaches(now);
    const cached = this.chainHistoryCache.get(cacheKey);
    if (cached && now - cached.timestamp <= this.chainHistoryTtlMs) {
      return cached.data;
    }

    const params = filterSegment ? `?filter=${encodeURIComponent(filterSegment)}` : "";
    const url = `https://api.llama.fi/v2/historicalChainTvl/${encodeURIComponent(trimmedChain)}${params}`;
    const rawSeries = await this.fetchJsonWithRetry<RawChainTvlPoint[]>(url, {
      timeoutMs: 20000,
      maxAttempts: 5,
      baseDelayMs: 600,
    });

    if (!Array.isArray(rawSeries)) {
      throw new Error("Unexpected response structure from DefiLlama chain TVL endpoint");
    }

    const shapedSeries: ChainTvlPoint[] = [];
    for (const entry of rawSeries) {
      if (isRawChainTvlPoint(entry)) {
        shapedSeries.push({ date: entry.date, tvl: entry.tvl });
      }
    }

    if (shapedSeries.length === 0) {
      throw new Error(`No TVL history returned for chain: ${trimmedChain}`);
    }

    this.setChainHistoryCache(cacheKey, shapedSeries, now);
    return shapedSeries;
  }

  private async ensureFresh(): Promise<void> {
    const now = Date.now();
    if (this.cache.length === 0 || now - this.cacheTimestampMs > this.ttlMs) {
      await this.loadIndex();
    } else if (this.cache.length > 0 && this.protocolIndex.size === 0) {
      this.rebuildProtocolIndex();
    }
  }

  private async ensureYieldsFresh(): Promise<void> {
    const now = Date.now();
    if (this.yieldsCache.length === 0 || now - this.yieldsCacheTimestampMs > this.yieldsTtlMs) {
      await this.loadYieldsPools();
    }
  }

  private async fetchJsonWithRetry<T>(url: string, options: { timeoutMs: number; maxAttempts: number; baseDelayMs?: number }): Promise<T> {
    const { timeoutMs, maxAttempts, baseDelayMs } = options;
    const headers = {
      Accept: "application/json",
      "User-Agent": "ElizaOS-DefiLlama/1.0",
    } as const;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        logger.debug(`[DefiLlama] Fetching ${url} (attempt ${attempt}/${maxAttempts})`);
        const response = await fetch(url, { method: "GET", headers, signal: controller.signal });
        clearTimeout(timeout);
        if (!response.ok) {
          throw new Error(`Failed ${response.status} ${response.statusText}`);
        }
        const json = (await response.json()) as T;
        return json;
      } catch (error) {
        clearTimeout(timeout);
        const message = error instanceof Error ? error.message : String(error);
        const isLastAttempt = attempt === maxAttempts;
        if (isLastAttempt) {
          throw new Error(`Failed to fetch ${url}: ${message}`);
        }
        const delayMs = (baseDelayMs ?? 500) * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 200);
        logger.warn(`[DefiLlama] Request failed (attempt ${attempt}): ${message}. Retrying in ${delayMs}ms...`);
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      }
    }

    throw new Error(`Exhausted retries for ${url}`);
  }

  private async loadIndex(): Promise<void> {
    const url = "https://api.llama.fi/protocols";
    const maxAttempts = 5;
    const baseDelayMs = 500;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      try {
        logger.debug(`[DefiLlama] Loading protocols (attempt ${attempt}/${maxAttempts}): ${url}`);
        const res = await fetch(url, { method: "GET", headers: { Accept: "application/json", "User-Agent": "ElizaOS-DefiLlama/1.0" }, signal: controller.signal });
        clearTimeout(timeout);
        if (!res.ok) throw new Error(`Failed ${res.status} ${res.statusText}`);
        const list = (await res.json()) as DefiLlamaProtocol[];
        this.cache = Array.isArray(list) ? list : [];
        this.cacheTimestampMs = Date.now();
        this.rebuildProtocolIndex();
        logger.info(`[DefiLlama] Protocols loaded: ${this.cache.length} (ttlMs=${this.ttlMs})`);
        return;
      } catch (e) {
        clearTimeout(timeout);
        const isLast = attempt === maxAttempts;
        const msg = e instanceof Error ? e.message : String(e);
        if (isLast) { logger.error(`[DefiLlama] Failed to load protocols after ${maxAttempts} attempts: ${msg}`); throw new Error(`Unable to load DefiLlama protocol index: ${msg}`); }
        const backoff = baseDelayMs * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 200);
        logger.warn(`[DefiLlama] Fetch failed (attempt ${attempt}): ${msg}. Retrying in ${backoff}ms...`);
        await new Promise((r) => setTimeout(r, backoff));
      }
    }
  }

  private async loadYieldsPools(): Promise<void> {
    const url = "https://yields.llama.fi/pools";
    const maxAttempts = 5;
    const baseDelayMs = 500;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000); // 20s for larger response
      try {
        logger.debug(`[DefiLlama] Loading yields pools (attempt ${attempt}/${maxAttempts}): ${url}`);
        const res = await fetch(url, { method: "GET", headers: { Accept: "application/json", "User-Agent": "ElizaOS-DefiLlama/1.0" }, signal: controller.signal });
        clearTimeout(timeout);
        if (!res.ok) throw new Error(`Failed ${res.status} ${res.statusText}`);
        const json = await res.json();
        const pools = Array.isArray((json as { data?: RawYieldPool[] }).data)
          ? ((json as { data?: RawYieldPool[] }).data as RawYieldPool[])
          : [];

        const shapedPools: YieldPool[] = [];
        for (const rawPool of pools) {
          const shaped = shapeYieldPool(rawPool);
          if (shaped) {
            shapedPools.push(shaped);
          }
        }

        this.yieldsCache = shapedPools;
        
        this.yieldsCacheTimestampMs = Date.now();
        logger.info(`[DefiLlama] Yields pools loaded: ${this.yieldsCache.length} (ttlMs=${this.yieldsTtlMs})`);
        return;
      } catch (e) {
        clearTimeout(timeout);
        const isLast = attempt === maxAttempts;
        const msg = e instanceof Error ? e.message : String(e);
        if (isLast) { logger.error(`[DefiLlama] Failed to load yields pools after ${maxAttempts} attempts: ${msg}`); throw new Error(`Unable to load DefiLlama yields pools: ${msg}`); }
        const backoff = baseDelayMs * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 200);
        logger.warn(`[DefiLlama] Yields fetch failed (attempt ${attempt}): ${msg}. Retrying in ${backoff}ms...`);
        await new Promise((r) => setTimeout(r, backoff));
      }
    }
  }

  private setProtocolHistoryCache(key: string, data: ProtocolTvlHistory, now: number): void {
    if (this.protocolHistoryCache.has(key)) {
      this.protocolHistoryCache.delete(key);
    }
    while (this.protocolHistoryCache.size >= this.protocolHistoryMaxEntries) {
      const oldestKey = this.protocolHistoryCache.keys().next().value as string | undefined;
      if (!oldestKey) break;
      this.protocolHistoryCache.delete(oldestKey);
    }
    this.protocolHistoryCache.set(key, { timestamp: now, data });
  }

  private setChainHistoryCache(key: string, data: ChainTvlPoint[], now: number): void {
    if (this.chainHistoryCache.has(key)) {
      this.chainHistoryCache.delete(key);
    }
    while (this.chainHistoryCache.size >= this.chainHistoryMaxEntries) {
      const oldestKey = this.chainHistoryCache.keys().next().value as string | undefined;
      if (!oldestKey) break;
      this.chainHistoryCache.delete(oldestKey);
    }
    this.chainHistoryCache.set(key, { timestamp: now, data });
  }

  private evictExpiredHistoryCaches(now: number): void {
    for (const [key, entry] of this.protocolHistoryCache.entries()) {
      if (now - entry.timestamp > this.protocolHistoryTtlMs) {
        this.protocolHistoryCache.delete(key);
      }
    }
    for (const [key, entry] of this.chainHistoryCache.entries()) {
      if (now - entry.timestamp > this.chainHistoryTtlMs) {
        this.chainHistoryCache.delete(key);
      }
    }
  }

  private rebuildProtocolIndex(): void {
    this.protocolIndex.clear();
    for (const protocol of this.cache) {
      const nameKey = (protocol.name || "").toLowerCase();
      if (nameKey) {
        this.protocolIndex.set(nameKey, protocol);
      }
      const symbolKey = (protocol.symbol || "").toLowerCase();
      if (symbolKey) {
        this.protocolIndex.set(symbolKey, protocol);
      }
      const slugKey = typeof protocol.slug === "string" ? protocol.slug.toLowerCase() : "";
      if (slugKey) {
        this.protocolIndex.set(slugKey, protocol);
      }
    }
  }
}

type RawProtocolHistoryPoint = {
  date?: number;
  totalLiquidityUSD?: number;
};

type RawChainHistoryEntry = {
  tvl?: RawProtocolHistoryPoint[];
};

type RawProtocolHistory = {
  slug?: string;
  name?: string;
  symbol?: string | null;
  tvl?: RawProtocolHistoryPoint[];
  chainTvls?: Record<string, RawChainHistoryEntry>;
};

type RawChainTvlPoint = {
  date?: number;
  tvl?: number;
};

function shapeYieldPool(raw: RawYieldPool): YieldPool | null {
  if (
    typeof raw.pool !== "string" ||
    typeof raw.project !== "string" ||
    typeof raw.chain !== "string" ||
    typeof raw.symbol !== "string"
  ) {
    return null;
  }

  if (typeof raw.tvlUsd !== "number" || !Number.isFinite(raw.tvlUsd)) {
    return null;
  }

  const rewardTokens = Array.isArray(raw.rewardTokens)
    ? raw.rewardTokens.filter((token) => typeof token === "string")
    : null;

  const underlyingTokens = Array.isArray(raw.underlyingTokens)
    ? raw.underlyingTokens.filter((token) => typeof token === "string")
    : null;

  return {
    pool: raw.pool,
    project: raw.project,
    chain: raw.chain,
    symbol: raw.symbol,
    tvlUsd: raw.tvlUsd,
    apy: normalizeNullableNumber(raw.apy),
    apyBase: normalizeNullableNumber(raw.apyBase),
    apyReward: normalizeNullableNumber(raw.apyReward),
    rewardTokens,
    stablecoin: Boolean(raw.stablecoin),
    underlyingTokens,
    apyPct1D: normalizeNullableNumber(raw.apyPct1D),
    apyPct7D: normalizeNullableNumber(raw.apyPct7D),
    apyPct30D: normalizeNullableNumber(raw.apyPct30D),
    apyMean30d: normalizeNullableNumber(raw.apyMean30d),
  };
}

function normalizeNullableNumber(value: number | string | null | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (!Number.isNaN(parsed) && Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function shapeProtocol(p: DefiLlamaProtocol): ProtocolSummary {
  const chains: string[] = Array.isArray(p.chains) ? Array.from(new Set(p.chains)) : [];
  const chainTvls = shapeChainTvlsRecord((p as { chainTvls?: ChainTvlsRawRecord }).chainTvls);

  const toNumberOrNull = (value: number | string | null | undefined): number | null =>
    typeof value === "number" && Number.isFinite(value) ? value : null;

  const slugValue = typeof p.slug === "string" ? p.slug : null;
  const urlValue = typeof p.url === "string" ? p.url : null;
  const logoValue = typeof p.logo === "string" ? p.logo : null;
  const categoryValue = typeof p.category === "string" ? p.category : null;
  const addressValue = typeof p.address === "string" ? p.address : null;
  const geckoValue = typeof p.gecko_id === "string" ? p.gecko_id : null;
  const cmcValue = typeof p.cmcId === "string" ? p.cmcId : null;
  const twitterValue = typeof p.twitter === "string" ? p.twitter : null;
  const symbolValue = typeof p.symbol === "string" ? p.symbol : null;

  return {
    id: p.id,
    slug: slugValue,
    name: p.name,
    symbol: symbolValue,
    url: urlValue,
    logo: logoValue,
    category: categoryValue,
    chains,
    address: addressValue,
    geckoId: geckoValue,
    cmcId: cmcValue,
    twitter: twitterValue,
    tvl: toNumberOrNull((p as { tvl?: number }).tvl),
    tvlChange1h: toNumberOrNull((p as { change_1h?: number }).change_1h),
    tvlChange1d: toNumberOrNull((p as { change_1d?: number }).change_1d),
    tvlChange7d: toNumberOrNull((p as { change_7d?: number }).change_7d),
    chainTvls,
  };
}

function shapeChainTvlsRecord(value: ChainTvlsRawRecord | undefined): Record<string, number> {
  if (!value) {
    return {};
  }

  const shaped: Record<string, number> = {};
  for (const [chainName, rawValue] of Object.entries(value)) {
    if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
      shaped[chainName] = rawValue;
    } else if (typeof rawValue === "string") {
      const parsed = Number(rawValue);
      if (!Number.isNaN(parsed)) {
        shaped[chainName] = parsed;
      }
    } else if (rawValue && typeof rawValue === "object" && typeof rawValue.tvl === "number" && Number.isFinite(rawValue.tvl)) {
      shaped[chainName] = rawValue.tvl;
    }
  }
  return shaped;
}

function shapeProtocolHistory(raw: RawProtocolHistory, fallbackSlug: string): ProtocolTvlHistory {
  const totalSeries: ProtocolTvlPoint[] = Array.isArray(raw.tvl)
    ? raw.tvl.filter(isRawProtocolHistoryPoint).map((point) => ({
        date: point.date,
        totalLiquidityUsd: point.totalLiquidityUSD,
      }))
    : [];

  const chainSeries: Record<string, ProtocolTvlPoint[]> = {};
  if (raw.chainTvls) {
    for (const [chainName, chainData] of Object.entries(raw.chainTvls)) {
      const series = Array.isArray(chainData?.tvl)
        ? chainData.tvl.filter(isRawProtocolHistoryPoint).map((point) => ({
            date: point.date,
            totalLiquidityUsd: point.totalLiquidityUSD,
          }))
        : [];

      if (series.length > 0) {
        chainSeries[chainName] = series;
      }
    }
  }

  const latestPoint = totalSeries.length > 0 ? totalSeries[totalSeries.length - 1] : undefined;

  return {
    slug: raw.slug ?? fallbackSlug,
    name: raw.name ?? fallbackSlug,
    symbol: raw.symbol ?? null,
    currentTvl: latestPoint ? latestPoint.totalLiquidityUsd : null,
    lastUpdated: latestPoint ? latestPoint.date : null,
    totalSeries,
    chainSeries,
  };
}

function isRawProtocolHistoryPoint(point: RawProtocolHistoryPoint | undefined): point is { date: number; totalLiquidityUSD: number } {
  return Boolean(
    point &&
      typeof point.date === "number" &&
      Number.isFinite(point.date) &&
      typeof point.totalLiquidityUSD === "number" &&
      Number.isFinite(point.totalLiquidityUSD)
  );
}

function isRawChainTvlPoint(point: RawChainTvlPoint | undefined): point is { date: number; tvl: number } {
  return Boolean(
    point &&
      typeof point.date === "number" &&
      Number.isFinite(point.date) &&
      typeof point.tvl === "number" &&
      Number.isFinite(point.tvl)
  );
}
