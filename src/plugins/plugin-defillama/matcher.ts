import type { Memory, State } from "@elizaos/core";
import { matchesPluginContext, type PluginKeywordPatterns } from "@/utils/plugin-context-matcher";

/**
 * Keyword patterns for DefiLlama plugin context activation
 */
export const defiLlamaKeywordPatterns: PluginKeywordPatterns = {
  keywords: [
    // TVL queries
    "tvl", "total value locked", "defi", "protocol", "llama",
    // Liquidity
    "liquidity", "yields", "yield", "apy", "apr",
    // DeFi protocols
    "aave", "curve", "lido", "uniswap", "compound", "morpho", "eigen",
    // Chain data
    "chain", "chains", "ethereum", "polygon", "arbitrum", "optimism",
    // Market data
    "volume", "fees", "revenue", "ranking", "top protocols",
  ],
  regexPatterns: [
    /tvl.*of/i,
    /yield.*on/i,
    /apy.*(?:of|for|on)/i,
    /protocol.*(?:tvl|liquidity)/i,
    /liquidity.*(?:pool|farming|staking)/i,
  ],
};

/**
 * Check if DefiLlama plugin should be active based on recent conversation
 *
 * Use this in each DefiLlama action's validate function:
 *
 * @example
 * ```ts
 * validate: async (_runtime: IAgentRuntime, message: Memory, state?: State) => {
 *   // Check plugin context first
 *   if (!shouldDefiLlamaPluginBeActive(state, message)) {
 *     return false;
 *   }
 *
 *   // Then check service availability
 *   const defiLlamaService = _runtime.getService(DefiLlamaService.serviceType) as DefiLlamaService;
 *   return !!defiLlamaService;
 * }
 * ```
 */
export function shouldDefiLlamaPluginBeActive(state?: State, message?: Memory): boolean {
  if (!state) return true; // If no state, always active (fallback)
  return matchesPluginContext(state, defiLlamaKeywordPatterns, message);
}
