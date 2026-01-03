import type { Memory, State } from "@elizaos/core";
import { matchesPluginContext, type PluginKeywordPatterns } from "@/utils/plugin-context-matcher";

/**
 * Keyword patterns for Biconomy plugin context activation
 */
export const biconomyKeywordPatterns: PluginKeywordPatterns = {
  keywords: [
    // Bridge operations
    "bridge", "cross-chain", "relay",
    // Swap operations
    "swap", "exchange", "trade",
    // Slippage control
    "slippage",
    // Plugin-specific
    "biconomy", "mee", "fusion",
    // Tokens
    "usdc", "eth", "weth", "usdt", "dai", "wbtc", "link",
    // Chains
    "base", "ethereum", "arbitrum", "optimism", "polygon", "bsc",
    // Transaction types
    "transfer", "send",
    // Withdrawals
    "withdraw", "withdrawal", "cash out", "cashout", "pull funds", "pay out",
  ],
  regexPatterns: [
    /bridge.*to/i,
    /swap.*on/i,
    /cross.chain/i,
    /withdraw(?:\s+all|\s+everything|\s+funds)?/i,
    /(?:base|ethereum|arbitrum|optimism|polygon)\s+to\s+(?:base|ethereum|arbitrum|optimism|polygon)/i,
  ],
};

/**
 * Check if Biconomy plugin should be active based on recent conversation
 *
 * Use this in each Biconomy action's validate function:
 *
 * @example
 * ```ts
 * validate: async (_runtime: IAgentRuntime, message: Memory, state?: State) => {
 *   // Check plugin context first
 *   if (!shouldBiconomyPluginBeInContext(state, message)) {
 *     return false;
 *   }
 *
 *   // Then check service availability
 *   const biconomyService = _runtime.getService(BiconomyService.serviceType) as BiconomyService;
 *   return !!biconomyService;
 * }
 * ```
 */
export function shouldBiconomyPluginBeInContext(state?: State, message?: Memory): boolean {
  if (!state) return true; // If no state, always active (fallback)
  return matchesPluginContext(state, biconomyKeywordPatterns, message);
}
