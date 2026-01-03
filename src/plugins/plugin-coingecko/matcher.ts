import type { Memory, State } from "@elizaos/core";
import { matchesPluginContext, type PluginKeywordPatterns } from "@/utils/plugin-context-matcher";

/**
 * Keyword patterns for CoinGecko plugin context activation
 */
export const coingeckoKeywordPatterns: PluginKeywordPatterns = {
  keywords: [
    // Brand / explicit references
    "coingecko",
    "coin gecko",
    "gecko price",
    // Focused user intents
    "token price",
    "coin price",
    "price chart",
    "market cap",
    "fdv",
    "volume data",
    "nft floor price",
    "historical price",
    "all-time high",
    "all-time low",
  ],
  regexPatterns: [
    /(?:price|value)\s+(?:of|for)\s+[^\s]+/i,
    /\b(?:btc|eth|sol|matic|op|arb|base)\b.*(?:price|market\s+cap|fdv|volume)/i,
    /(?:market\s+cap|volume|fdv)\s+(?:of|for)\s+[^\s]+/i,
    /(?:price|market)\s+chart/i,
    /nft\s+(?:floor|collection)\s+price/i,
  ],
};

/**
 * Check if CoinGecko plugin should be active based on recent conversation
 *
 * Use this in each CoinGecko action's validate function:
 *
 * @example
 * ```ts
 * validate: async (_runtime: IAgentRuntime, message: Memory, state?: State) => {
 *   // Check plugin context first
 *   if (!shouldCoingeckoPluginBeInContext(state, message)) {
 *     return false;
 *   }
 *
 *   // Then check service availability
 *   const coingeckoService = _runtime.getService(CoinGeckoService.serviceType) as CoinGeckoService;
 *   return !!coingeckoService;
 * }
 * ```
 */
export function shouldCoingeckoPluginBeInContext(state?: State, message?: Memory): boolean {
  if (!state) return true; // If no state, always active (fallback)
  return matchesPluginContext(state, coingeckoKeywordPatterns, message);
}
