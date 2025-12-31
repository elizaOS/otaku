import { logger } from "@elizaos/core"
import type { TokenInfo } from "../types"

/**
 * Token resolution with CoinGecko integration (adapted from plugin-relay)
 */

// ChainID to CoinGecko platform mapping
const CHAIN_ID_TO_PLATFORM: Record<number, string> = {
  1: "ethereum",
  100: "xdai", // Gnosis Chain
  42161: "arbitrum-one",
  8453: "base",
  137: "polygon-pos",
}

// Hardcoded token addresses for common tokens (fallback before CoinGecko)
const HARDCODED_TOKENS: Record<number, Record<string, { address: string; decimals: number }>> = {
  1: {
    "usdc": { address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6 },
    "usdt": { address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6 },
    "dai": { address: "0x6B175474E89094C44Da98b954EedeAC495271d0F", decimals: 18 },
    "weth": { address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", decimals: 18 },
    "wbtc": { address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", decimals: 8 },
  },
  100: {
    "usdc": { address: "0xDDAfbb505ad214D7b80b1f830fcCc89B60fb7A83", decimals: 6 },
    "usdt": { address: "0x4ECaBa5870353805a9F068101A40E0f32ed605C6", decimals: 6 },
    "weth": { address: "0x6A023CCd1ff6F2045C3309768eAd9E68F978f6e1", decimals: 18 },
    "gno": { address: "0x9C58BAcC331c9aa871AFD802DB6379a98e80CEdb", decimals: 18 },
  },
  42161: {
    "usdc": { address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", decimals: 6 },
    "usdc.e": { address: "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8", decimals: 6 },
    "usdt": { address: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", decimals: 6 },
    "dai": { address: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1", decimals: 18 },
    "weth": { address: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", decimals: 18 },
    "wbtc": { address: "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f", decimals: 8 },
    "arb": { address: "0x912CE59144191C1204E64559FE8253a0e49E6548", decimals: 18 },
  },
  8453: {
    "usdc": { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
    "usdbc": { address: "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA", decimals: 6 },
    "weth": { address: "0x4200000000000000000000000000000000000006", decimals: 18 },
    "dai": { address: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb", decimals: 18 },
    "cbeth": { address: "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22", decimals: 18 },
  },
  137: {
    "usdc": { address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", decimals: 6 },
    "usdc.e": { address: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174", decimals: 6 },
    "usdt": { address: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", decimals: 6 },
    "dai": { address: "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063", decimals: 18 },
    "weth": { address: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619", decimals: 18 },
    "wbtc": { address: "0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6", decimals: 8 },
    "wmatic": { address: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270", decimals: 18 },
    "wpol": { address: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270", decimals: 18 },
  },
}

// CoinGecko API interfaces
interface CoinGeckoTokenResponse {
  symbol?: string
  name?: string
  platforms?: Record<string, string>
  detail_platforms?: Record<string, { decimal_place?: number }>
}

interface CoinGeckoSearchCoin {
  id: string
  symbol: string
  name: string
}

interface CoinGeckoSearchResponse {
  coins?: CoinGeckoSearchCoin[]
}

interface CoinGeckoCoinDetailResponse {
  platforms?: Record<string, string>
  detail_platforms?: Record<string, { decimal_place?: number }>
}

// Token metadata cache
const tokenCache = new Map<string, TokenInfo>()
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes
const cacheTimestamps = new Map<string, number>()

function getCacheKey(chainId: number, address: string): string {
  return `${chainId}:${address.toLowerCase()}`
}

function isCacheValid(key: string): boolean {
  const timestamp = cacheTimestamps.get(key)
  if (!timestamp) return false
  return Date.now() - timestamp < CACHE_TTL
}

function isAddress(value: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(value)
}

/**
 * Get token metadata from CoinGecko by contract address
 */
async function getTokenMetadataFromCoinGecko(
  address: string,
  chainId: number
): Promise<TokenInfo | null> {
  const platformId = CHAIN_ID_TO_PLATFORM[chainId]
  if (!platformId) {
    logger.warn(`[TokenResolver] No CoinGecko platform mapping for chainId ${chainId}`)
    return null
  }

  try {
    const apiKey = process.env.COINGECKO_API_KEY
    const baseUrl = apiKey
      ? "https://pro-api.coingecko.com/api/v3"
      : "https://api.coingecko.com/api/v3"
    const url = `${baseUrl}/coins/${platformId}/contract/${address.toLowerCase()}`

    logger.debug(`[TokenResolver] Fetching from CoinGecko: ${url}`)

    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        ...(apiKey ? { "x-cg-pro-api-key": apiKey } : {}),
      },
    })

    if (!response.ok) {
      if (response.status === 404) {
        logger.warn(`[TokenResolver] Token not found on CoinGecko: ${address}`)
        return null
      }
      if (response.status === 429) {
        logger.error("[TokenResolver] CoinGecko rate limit exceeded")
        return null
      }
      logger.error(`[TokenResolver] CoinGecko API error: ${response.status}`)
      return null
    }

    const data = (await response.json()) as CoinGeckoTokenResponse
    const decimals = data.detail_platforms?.[platformId]?.decimal_place || 18

    return {
      symbol: data.symbol?.toUpperCase() || "",
      address: address.toLowerCase(),
      decimals,
      chainId,
    }
  } catch (error) {
    logger.error(`[TokenResolver] CoinGecko fetch error:`, error instanceof Error ? error.message : String(error))
    return null
  }
}

/**
 * Resolve token symbol to address via CoinGecko
 */
async function resolveSymbolViaCoinGecko(
  symbol: string,
  chainId: number
): Promise<string | null> {
  const platformId = CHAIN_ID_TO_PLATFORM[chainId]
  if (!platformId) {
    logger.warn(`[TokenResolver] No CoinGecko platform mapping for chainId ${chainId}`)
    return null
  }

  try {
    const apiKey = process.env.COINGECKO_API_KEY
    const baseUrl = apiKey
      ? "https://pro-api.coingecko.com/api/v3"
      : "https://api.coingecko.com/api/v3"
    const searchUrl = `${baseUrl}/search?query=${encodeURIComponent(symbol)}`

    logger.debug(`[TokenResolver] Searching CoinGecko for symbol: ${symbol}`)

    const searchResponse = await fetch(searchUrl, {
      headers: {
        Accept: "application/json",
        ...(apiKey ? { "x-cg-pro-api-key": apiKey } : {}),
      },
    })

    if (!searchResponse.ok) {
      logger.error(`[TokenResolver] CoinGecko search error: ${searchResponse.status}`)
      return null
    }

    const searchData = (await searchResponse.json()) as CoinGeckoSearchResponse
    const coin = searchData.coins?.find(
      (c) => c.symbol.toLowerCase() === symbol.toLowerCase()
    )

    if (!coin) {
      logger.warn(`[TokenResolver] Symbol not found on CoinGecko: ${symbol}`)
      return null
    }

    // Fetch coin details to get platform addresses
    const coinUrl = `${baseUrl}/coins/${coin.id}`
    const coinResponse = await fetch(coinUrl, {
      headers: {
        Accept: "application/json",
        ...(apiKey ? { "x-cg-pro-api-key": apiKey } : {}),
      },
    })

    if (!coinResponse.ok) {
      logger.error(`[TokenResolver] CoinGecko coin detail error: ${coinResponse.status}`)
      return null
    }

    const coinData = (await coinResponse.json()) as CoinGeckoCoinDetailResponse
    const address = coinData.platforms?.[platformId]

    if (address) {
      logger.info(`[TokenResolver] Resolved ${symbol} to ${address} on chainId ${chainId}`)
      return address.toLowerCase()
    }

    logger.warn(`[TokenResolver] Symbol ${symbol} not available on chainId ${chainId}`)
    return null
  } catch (error) {
    logger.error(`[TokenResolver] CoinGecko symbol resolution error:`, error instanceof Error ? error.message : String(error))
    return null
  }
}

/**
 * Resolve a token symbol or address to token info
 */
export async function resolveToken(
  input: string,
  chainId: number
): Promise<TokenInfo> {
  logger.info(`[TokenResolver] Resolving token: ${input} on chain ${chainId}`)

  const normalizedInput = input.trim()
  const lowerInput = normalizedInput.toLowerCase()

  // Handle native tokens (ETH on Polygon is WETH, not native)
  if (lowerInput === "eth" && chainId !== 137) {
    return {
      symbol: "ETH",
      address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
      decimals: 18,
      chainId,
    }
  }

  // ETH on Polygon = WETH
  if (lowerInput === "eth" && chainId === 137) {
    logger.debug(`[TokenResolver] ETH on Polygon is WETH`)
    return {
      symbol: "WETH",
      address: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619",
      decimals: 18,
      chainId: 137,
    }
  }

  // POL/MATIC native on Polygon
  if ((lowerInput === "pol" || lowerInput === "matic") && chainId === 137) {
    return {
      symbol: "POL",
      address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
      decimals: 18,
      chainId: 137,
    }
  }

  // xDAI on Gnosis
  if (lowerInput === "xdai" && chainId === 100) {
    return {
      symbol: "xDAI",
      address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
      decimals: 18,
      chainId: 100,
    }
  }

  // If it's an address, validate with CoinGecko
  if (isAddress(normalizedInput)) {
    const cacheKey = getCacheKey(chainId, normalizedInput)
    if (isCacheValid(cacheKey)) {
      const cached = tokenCache.get(cacheKey)
      if (cached) {
        logger.debug(`[TokenResolver] Cache hit: ${cacheKey}`)
        return cached
      }
    }

    const metadata = await getTokenMetadataFromCoinGecko(normalizedInput, chainId)
    if (metadata) {
      tokenCache.set(cacheKey, metadata)
      cacheTimestamps.set(cacheKey, Date.now())
      return metadata
    }

    // Address validation failed, but return it anyway with default decimals
    logger.warn(`[TokenResolver] Address ${normalizedInput} not validated by CoinGecko, using defaults`)
    return {
      symbol: normalizedInput.slice(0, 8) + "...",
      address: normalizedInput.toLowerCase(),
      decimals: 18,
      chainId,
    }
  }

  // Check hardcoded tokens first
  const hardcoded = HARDCODED_TOKENS[chainId]?.[lowerInput]
  if (hardcoded) {
    logger.info(
      `[TokenResolver] Using hardcoded token: ${input} -> ${hardcoded.address}`
    )
    return {
      symbol: input.toUpperCase(),
      address: hardcoded.address,
      decimals: hardcoded.decimals,
      chainId,
    }
  }

  // Fallback to CoinGecko symbol resolution
  const address = await resolveSymbolViaCoinGecko(normalizedInput, chainId)
  if (address) {
    const metadata = await getTokenMetadataFromCoinGecko(address, chainId)
    if (metadata) {
      const cacheKey = getCacheKey(chainId, address)
      tokenCache.set(cacheKey, metadata)
      cacheTimestamps.set(cacheKey, Date.now())
      return metadata
    }
  }

  // Not found anywhere
  throw new Error(
    `Could not resolve token: ${input} on chain ${chainId}. Please provide a valid token address or symbol.`
  )
}

/**
 * Resolve multiple tokens at once
 */
export async function resolveTokens(
  inputs: string[],
  chainId: number
): Promise<TokenInfo[]> {
  const results: TokenInfo[] = []

  for (const input of inputs) {
    try {
      const token = await resolveToken(input, chainId)
      results.push(token)
    } catch (error) {
      logger.error(
        `[TokenResolver] Failed to resolve ${input}:`,
        error instanceof Error ? error.message : String(error)
      )
      throw error
    }
  }

  return results
}

/**
 * Format token amount from human-readable to atoms
 */
export function parseTokenAmount(amount: string, decimals: number): bigint {
  try {
    // Remove any commas
    const cleanAmount = amount.replace(/,/g, "")

    // Split on decimal point
    const [whole = "0", fraction = ""] = cleanAmount.split(".")

    // Pad or truncate fraction to match decimals
    const paddedFraction = fraction.padEnd(decimals, "0").slice(0, decimals)

    // Combine and convert to bigint
    const atoms = whole + paddedFraction
    return BigInt(atoms)
  } catch (error) {
    throw new Error(`Invalid amount: ${amount}`)
  }
}

/**
 * Format token amount from atoms to human-readable
 */
export function formatTokenAmount(atoms: bigint, decimals: number): string {
  const atomsStr = atoms.toString().padStart(decimals + 1, "0")
  const whole = atomsStr.slice(0, -decimals) || "0"
  const fraction = atomsStr.slice(-decimals)

  // Remove trailing zeros
  const trimmedFraction = fraction.replace(/0+$/, "")

  if (trimmedFraction.length === 0) {
    return whole
  }

  return `${whole}.${trimmedFraction}`
}
