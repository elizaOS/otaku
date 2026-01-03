import type { Memory, State } from "@elizaos/core";
import { matchesPluginContext, type PluginKeywordPatterns } from "@/utils/plugin-context-matcher";

/**
 * Keyword patterns for Polymarket plugin context activation
 */
export const polymarketKeywordPatterns: PluginKeywordPatterns = {
  keywords: [
    // Core market concepts
    "market", "polymarket", "prediction", "bet", "odds", "forecast",
    // Outcomes and events
    "outcome", "event", "election", "sports", "crypto",
    // Market operations
    "positions", "portfolio", "balance", "trading", "trade history",
  ],
  regexPatterns: [
    /bet\s+on/i,
    /predict/i,
    /market\s+for/i,
    /odds\s+on/i,
    /prediction\s+market/i,
    /polymarket/i,
  ],
};

/**
 * Check if Polymarket plugin should be active based on recent conversation
 *
 * Use this in each Polymarket action's validate function:
 *
 * @example
 * ```ts
 * validate: async (_runtime: IAgentRuntime, message: Memory, state?: State) => {
 *   // Check plugin context first
 *   if (!shouldPolymarketPluginBeInContext(state, message)) {
 *     return false;
 *   }
 *
 *   // Then check service availability
 *   const service = _runtime.getService(PolymarketService.serviceType) as PolymarketService;
 *   return !!service;
 * }
 * ```
 */
export function shouldPolymarketPluginBeInContext(state?: State, message?: Memory): boolean {
  if (!state) return true; // If no state, always active (fallback)
  return matchesPluginContext(state, polymarketKeywordPatterns, message);
}
