import type { Memory, State } from "@elizaos/core";
import { matchesPluginContext, type PluginKeywordPatterns } from "@/utils/plugin-context-matcher";

/**
 * Keyword patterns for Relay plugin context activation
 */
export const relayKeywordPatterns: PluginKeywordPatterns = {
  keywords: [
    // Bridging operations
    "bridge", "relay", "cross-chain", "crosschain",
    // Transfer operations
    "transfer", "move", "send",
    // Chain names
    "base", "polygon", "arbitrum", "optimism", "ethereum", "zora", "blast", "scroll", "linea",
    // Bridge-specific terms
    "liquidity", "route", "quote", "request", "status",
  ],
  regexPatterns: [
    /bridge.*to/i,
    /move.*to/i,
    /cross.chain/i,
    /transfer.*(?:base|polygon|arbitrum|optimism|ethereum)/i,
    /send.*(?:base|polygon|arbitrum|optimism|ethereum)/i,
  ],
};

/**
 * Check if Relay plugin should be active based on recent conversation
 *
 * Use this in each Relay action's validate function:
 *
 * @example
 * ```ts
 * validate: async (_runtime: IAgentRuntime, message: Memory, state?: State) => {
 *   // Check plugin context first
 *   if (!shouldRelayPluginBeInContext(state, message)) {
 *     return false;
 *   }
 *
 *   // Then check service availability
 *   const relayService = _runtime.getService(RelayService.serviceType) as RelayService;
 *   return !!relayService;
 * }
 * ```
 */
export function shouldRelayPluginBeInContext(state?: State, message?: Memory): boolean {
  if (!state) return true; // If no state, always active (fallback)
  return matchesPluginContext(state, relayKeywordPatterns, message);
}
