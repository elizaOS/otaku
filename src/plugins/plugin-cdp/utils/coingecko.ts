import { logger } from "@elizaos/core";

/**
 * Token Resolution Strategy (in priority order):
 * 
 * 1. **Hardcoded Addresses**: Fastest, most reliable for common tokens on each network
 *    - Used for tokens that may not be in CoinGecko yet (e.g., new chains like Base)
 *    - Verified addresses from official bridge/chain documentation
 * 
 * 2. **Known Coin IDs**: Well-known tokens resolved via CoinGecko coin ID
 *    - More reliable than search API
 *    - Direct lookup using stable coin identifiers
 * 
 * 3. **CoinGecko Search**: Fallback for unknown/new tokens
 *    - Search by symbol, then fetch platform address
 *    - May not find newer tokens or return multiple results
 * 
 * This multi-tier approach ensures maximum reliability for common tokens
 * while still supporting discovery of new tokens via CoinGecko.
 */

/**
 * Token metadata from CoinGecko
 */
export interface TokenMetadata {
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  network: string;
}

/**
 * CoinGecko API response types
 */
interface CoinGeckoTokenResponse {
  symbol?: string;
  name?: string;
  platforms?: Record<string, string>;
  detail_platforms?: Record<string, { decimal_place?: number }>;
}

interface CoinGeckoSearchCoin {
  id: string;
  symbol: string;
  name: string;
}

interface CoinGeckoSearchResponse {
  coins?: CoinGeckoSearchCoin[];
}

interface CoinGeckoCoinDetailResponse {
  platforms?: Record<string, string>;
}

/**
 * CoinGecko platform IDs mapping from CDP network names
 */
const NETWORK_TO_PLATFORM: Record<string, string> = {
  "base": "base",
  "base-sepolia": "base", // Use mainnet for testnet lookups
  "ethereum": "ethereum",
  "ethereum-sepolia": "ethereum",
  "ethereum-hoodi": "ethereum",
  "arbitrum": "arbitrum-one",
  "arbitrum-sepolia": "arbitrum-one",
  "optimism": "optimistic-ethereum",
  "optimism-sepolia": "optimistic-ethereum",
  "polygon": "polygon-pos",
  "polygon-mumbai": "polygon-pos",
};

/**
 * Hardcoded token addresses for networks
 * Fallback when CoinGecko doesn't have the data yet (e.g., new chains)
 * Format: network -> symbol -> address
 */
const HARDCODED_TOKEN_ADDRESSES: Record<string, Record<string, string>> = {
  "base": {
    "usdc": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "usdt": "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2",
    "dai": "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb",
    "weth": "0x4200000000000000000000000000000000000006",
    "cbeth": "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22",
  },
  "ethereum": {
    "usdc": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    "usdt": "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    "dai": "0x6B175474E89094C44Da98b954EedeAC495271d0F",
    "weth": "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    "wbtc": "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
  },
  "arbitrum": {
    "usdc": "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    "usdt": "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
    "dai": "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1",
    "weth": "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
    "wbtc": "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f",
    "arb": "0x912CE59144191C1204E64559FE8253a0e49E6548",
  },
  "optimism": {
    "usdc": "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
    "usdt": "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58",
    "dai": "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1",
    "weth": "0x4200000000000000000000000000000000000006",
    "wbtc": "0x68f180fcCe6836688e9084f035309E29Bf0A2095",
    "op": "0x4200000000000000000000000000000000000042",
  },
  "polygon": {
    "usdc": "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
    "usdt": "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
    "dai": "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063",
    "weth": "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619",
    "wbtc": "0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6",
    "wmatic": "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270",
  },
};

/**
 * In-memory cache for token metadata to avoid rate limits
 * Cache key format: "network:address"
 */
const tokenCache = new Map<string, TokenMetadata>();

/**
 * Cache expiry time (5 minutes)
 */
const CACHE_TTL = 5 * 60 * 1000;
const cacheTimestamps = new Map<string, number>();

/**
 * Get CoinGecko platform ID from network name
 */
function getPlatformId(network: string): string {
  return NETWORK_TO_PLATFORM[network] || network;
}

/**
 * Get cache key for token
 */
function getCacheKey(network: string, address: string): string {
  return `${network}:${address.toLowerCase()}`;
}

/**
 * Check if cache entry is still valid
 */
function isCacheValid(key: string): boolean {
  const timestamp = cacheTimestamps.get(key);
  if (!timestamp) return false;
  return Date.now() - timestamp < CACHE_TTL;
}

/**
 * Fetch token metadata from CoinGecko API
 * 
 * @param address - Token contract address
 * @param network - Network name (e.g., "base", "ethereum")
 * @returns Token metadata or null if not found
 */
export async function getTokenMetadata(
  address: string,
  network: string
): Promise<TokenMetadata | null> {
  const normalizedAddress = address.toLowerCase();
  const cacheKey = getCacheKey(network, normalizedAddress);

  // Check cache first
  if (isCacheValid(cacheKey)) {
    const cached = tokenCache.get(cacheKey);
    if (cached) {
      logger.debug(`Token metadata cache hit: ${cacheKey}`);
      return cached;
    }
  }

  try {
    const platformId = getPlatformId(network);
    const apiKey = process.env.COINGECKO_API_KEY;
    const baseUrl = apiKey ? "https://pro-api.coingecko.com/api/v3" : "https://api.coingecko.com/api/v3";
    const url = `${baseUrl}/coins/${platformId}/contract/${normalizedAddress}`;
    
    logger.debug(`Fetching token metadata from CoinGecko: ${url}`);
    
    const response = await fetch(url, {
      headers: {
        "Accept": "application/json",
        ...(apiKey ? { "x-cg-pro-api-key": apiKey } : {}),
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        logger.warn(`Token not found on CoinGecko: ${address} on ${network}`);
        return null;
      }
      if (response.status === 429) {
        logger.error("CoinGecko rate limit exceeded");
        return null;
      }
      logger.error(`CoinGecko API error: ${response.status} ${response.statusText}`);
      return null;
    }

    const data = await response.json() as CoinGeckoTokenResponse;

    // Extract decimals from detail_platforms
    const decimals = data.detail_platforms?.[platformId]?.decimal_place || 18;

    const metadata: TokenMetadata = {
      symbol: data.symbol?.toLowerCase() || "",
      name: data.name || "",
      address: normalizedAddress,
      decimals,
      network,
    };

    // Cache the result
    tokenCache.set(cacheKey, metadata);
    cacheTimestamps.set(cacheKey, Date.now());

    logger.info(`Successfully fetched token metadata: ${metadata.symbol} (${metadata.name}) - ${decimals} decimals`);
    return metadata;
  } catch (error) {
    logger.error(`Error fetching token metadata from CoinGecko: ${error}`);
    return null;
  }
}

/**
 * Resolve token symbol to address for a given network
 * This uses CoinGecko's search API to find the token
 * 
 * @param symbol - Token symbol (e.g., "USDC", "WETH")
 * @param network - Network name
 * @returns Token address or null if not found
 */
export async function resolveTokenSymbol(
  symbol: string,
  network: string
): Promise<string | null> {
  const lowerSymbol = symbol.toLowerCase();
  
  // Priority 1: Check hardcoded addresses (fastest and most reliable)
  const hardcodedAddress = HARDCODED_TOKEN_ADDRESSES[network]?.[lowerSymbol];
  if (hardcodedAddress) {
    logger.info(`Using hardcoded address for ${symbol} on ${network}: ${hardcodedAddress}`);
    return hardcodedAddress.toLowerCase();
  }
  
  try {
    const platformId = getPlatformId(network);
    const apiKey = process.env.COINGECKO_API_KEY;
    const baseUrl = apiKey ? "https://pro-api.coingecko.com/api/v3" : "https://api.coingecko.com/api/v3";
    const url = `${baseUrl}/search?query=${encodeURIComponent(symbol)}`;
    
    logger.debug(`Searching token by symbol: ${symbol}`);
    
    const response = await fetch(url, {
      headers: {
        "Accept": "application/json",
        ...(apiKey ? { "x-cg-pro-api-key": apiKey } : {}),
      },
    });

    if (!response.ok) {
      logger.error(`CoinGecko search API error: ${response.status}`);
      return null;
    }

    const data = await response.json() as CoinGeckoSearchResponse;
    
    // Find the first coin that matches the symbol exactly and has the network
    const coin = data.coins?.find((c) => 
      c.symbol.toLowerCase() === symbol.toLowerCase()
    );

    if (!coin) {
      logger.warn(`Token symbol not found: ${symbol}`);
      return null;
    }

    const coinUrl = `${baseUrl}/coins/${coin.id}`;
    const coinResponse = await fetch(coinUrl, {
      headers: {
        "Accept": "application/json",
        ...(apiKey ? { "x-cg-pro-api-key": apiKey } : {}),
      },
    });
    
    if (!coinResponse.ok) {
      return null;
    }

    const coinDataRaw = await coinResponse.json();
    const coinData = coinDataRaw as CoinGeckoCoinDetailResponse;
    const address = coinData.platforms?.[platformId];

    if (address) {
      logger.info(`Resolved ${symbol} to ${address} on ${network}`);
      return address.toLowerCase();
    }

    logger.warn(`Token ${symbol} not found on network ${network}`);
    return null;
  } catch (error) {
    logger.error(`Error resolving token symbol: ${error}`);
    return null;
  }
}

/**
 * Resolve token to address
 * Handles both symbols (e.g., "USDC") and addresses (0x...)
 * For native tokens (ETH/MATIC), returns zero address
 *
 * IMPORTANT: Always validates addresses with CoinGecko to prevent fake/invalid addresses.
 */
export async function resolveTokenToAddress(
  token: string,
  network: string
): Promise<`0x${string}` | null> {
  logger.debug(`Resolving token: ${token} on network: ${network}`);
  const trimmedToken = token.trim();

  // For native tokens
  const lowerToken = trimmedToken.toLowerCase();
  if (lowerToken === "eth" || lowerToken === "matic" || lowerToken === "pol") {
    logger.debug(`Token ${token} is a native token, using zero address`);
    return "0x0000000000000000000000000000000000000000";
  }

  // If it looks like an address, validate it with CoinGecko to prevent fake addresses
  if (trimmedToken.startsWith("0x") && trimmedToken.length === 42) {
    logger.debug(`Token ${token} looks like an address, validating with CoinGecko`);
    const metadata = await getTokenMetadata(trimmedToken, network);
    if (metadata?.address) {
      logger.info(`Validated address ${token} exists on CoinGecko: ${metadata.symbol} (${metadata.name})`);
      return metadata.address as `0x${string}`;
    }
    logger.warn(`Address ${token} not found on CoinGecko for network ${network} - may be fake/invalid`);
    return null;
  }

  // Try to resolve symbol to address via CoinGecko
  logger.debug(`Resolving token symbol from CoinGecko for ${trimmedToken}`);
  const address = await resolveTokenSymbol(trimmedToken, network);
  if (address) {
    logger.info(`Resolved ${token} to ${address} via CoinGecko`);
    return address as `0x${string}`;
  }

  logger.warn(`Could not resolve token ${token} on ${network}`);
  return null;
}

/**
 * Get token decimals (with fallback to common values)
 * 
 * @param address - Token address
 * @param network - Network name
 * @returns Number of decimals (defaults to 18 if not found)
 */
export async function getTokenDecimals(
  address: string,
  network: string
): Promise<number> {
  const metadata = await getTokenMetadata(address, network);
  
  if (metadata?.decimals) {
    return metadata.decimals;
  }

  // Fallback for common tokens
  const lowerSymbol = metadata?.symbol?.toLowerCase();
  if (lowerSymbol === "usdc" || lowerSymbol === "usdt") {
    return 6;
  }

  // Default to 18 (most ERC20 tokens use 18 decimals)
  logger.warn(`Could not determine decimals for ${address}, defaulting to 18`);
  return 18;
}

/**
 * Clear the token metadata cache
 */
export function clearTokenCache(): void {
  tokenCache.clear();
  cacheTimestamps.clear();
  logger.info("Token metadata cache cleared");
}

/**
 * Get cache statistics
 */
export function getCacheStats(): { size: number; entries: string[] } {
  return {
    size: tokenCache.size,
    entries: Array.from(tokenCache.keys()),
  };
}

/**
 * Add a hardcoded token address for a specific network
 * Useful for tokens not yet in CoinGecko or for faster resolution
 * 
 * @param network - Network name
 * @param symbol - Token symbol (will be converted to lowercase)
 * @param address - Token contract address
 */
export function addHardcodedTokenAddress(
  network: string,
  symbol: string,
  address: string
): void {
  if (!HARDCODED_TOKEN_ADDRESSES[network]) {
    HARDCODED_TOKEN_ADDRESSES[network] = {};
  }
  HARDCODED_TOKEN_ADDRESSES[network][symbol.toLowerCase()] = address.toLowerCase();
  logger.info(`Added hardcoded token address: ${symbol} on ${network} -> ${address}`);
}

/**
 * Get hardcoded token addresses for a network
 */
export function getHardcodedTokens(network: string): Record<string, string> {
  return HARDCODED_TOKEN_ADDRESSES[network] || {};
}

