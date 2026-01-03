import type { Memory, State } from "@elizaos/core";
import { matchesPluginContext, type PluginKeywordPatterns } from "@/utils/plugin-context-matcher";

/**
 * Keyword patterns for Clanker plugin context activation
 */
export const clankerKeywordPatterns: PluginKeywordPatterns = {
  keywords: [
    // Token deployment
    "clanker", "deploy", "create", "token", "contract", "launch",
    // Token creation
    "new token", "create token", "token creation", "deploy token",
    // Contract operations
    "contract", "smart contract", "mint", "supply",
    // Blockchain
    "base", "blockchain", "onchain", "on-chain",
    // Token properties
    "symbol", "name", "decimals", "initial supply",
  ],
  regexPatterns: [
    /deploy.*token/i,
    /create.*(?:token|contract)/i,
    /launch.*(?:token|contract)/i,
    /new.*(?:token|contract|erc20)/i,
    /mint.*(?:token|contract)/i,
  ],
};

/**
 * Check if Clanker plugin should be active based on recent conversation
 *
 * Use this in each Clanker action's validate function:
 *
 * @example
 * ```ts
 * validate: async (_runtime: IAgentRuntime, message: Memory, state?: State) => {
 *   // Check plugin context first
 *   if (!shouldClankerPluginBeInContext(state, message)) {
 *     return false;
 *   }
 *
 *   // Then check service availability
 *   const clankerService = _runtime.getService(ClankerService.serviceType) as ClankerService;
 *   return !!clankerService;
 * }
 * ```
 */
export function shouldClankerPluginBeInContext(state?: State, message?: Memory): boolean {
  if (!state) return true; // If no state, always active (fallback)
  return matchesPluginContext(state, clankerKeywordPatterns, message);
}
