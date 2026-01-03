import type { Memory, State } from "@elizaos/core";
import { matchesPluginContext, type PluginKeywordPatterns } from "@/utils/plugin-context-matcher";

/**
 * Keyword patterns for Morpho plugin context activation
 */
export const morphoKeywordPatterns: PluginKeywordPatterns = {
  keywords: [
    // Lending operations
    "lend", "borrow", "supply", "withdraw", "morpho", "lending", "collateral",
    // APY and rates
    "apy", "rate", "deposit", "loan", "interest", "yield",
    // Market operations
    "market", "vault", "pool",
    // Position management
    "position", "exposure", "ltv", "liquidation",
  ],
  regexPatterns: [
    /lend.*to/i,
    /borrow.*from/i,
    /supply.*to/i,
    /withdraw.*from/i,
    /morpho.*(?:market|vault|pool)/i,
    /(?:market|vault|pool).*(?:apy|rate|yield)/i,
  ],
};

/**
 * Check if Morpho plugin should be active based on recent conversation
 *
 * Use this in each Morpho action's validate function:
 *
 * @example
 * ```ts
 * validate: async (_runtime: IAgentRuntime, message: Memory, state?: State) => {
 *   // Check plugin context first
 *   if (!shouldMorphoPluginBeInContext(state, message)) {
 *     return false;
 *   }
 *
 *   // Then check service availability
 *   const morphoService = _runtime.getService(MorphoService.serviceType) as MorphoService;
 *   return !!morphoService;
 * }
 * ```
 */
export function shouldMorphoPluginBeInContext(state?: State, message?: Memory): boolean {
  if (!state) return true; // If no state, always active (fallback)
  return matchesPluginContext(state, morphoKeywordPatterns, message);
}
