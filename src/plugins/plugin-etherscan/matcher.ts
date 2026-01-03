import type { Memory, State } from "@elizaos/core";
import { matchesPluginContext, type PluginKeywordPatterns } from "@/utils/plugin-context-matcher";

/**
 * Keyword patterns for Etherscan plugin context activation
 */
export const etherscanKeywordPatterns: PluginKeywordPatterns = {
  keywords: [
    // Transaction queries
    "etherscan", "transaction", "tx", "hash", "confirmation", "confirm",
    // Contract verification
    "contract", "verify", "verified", "verification", "address",
    // Explorer
    "scan", "scanner", "explorer", "blockchain",
    // Status checks
    "status", "failed", "success", "pending", "confirmed",
    // Gas information
    "gas", "gas used", "gas price",
  ],
  regexPatterns: [
    /check.*tx/i,
    /verify.*contract/i,
    /transaction.*(?:status|confirmation|hash)/i,
    /0x[a-fA-F0-9]{40}/,  // Contract address
    /0x[a-fA-F0-9]{64}/,  // Transaction hash
  ],
};

/**
 * Check if Etherscan plugin should be active based on recent conversation
 *
 * Use this in each Etherscan action's validate function:
 *
 * @example
 * ```ts
 * validate: async (_runtime: IAgentRuntime, message: Memory, state?: State) => {
 *   // Check plugin context first
 *   if (!shouldEtherscanPluginBeInContext(state, message)) {
 *     return false;
 *   }
 *
 *   // Then check service availability
 *   const etherscanService = _runtime.getService(EtherscanService.serviceType) as EtherscanService;
 *   return !!etherscanService;
 * }
 * ```
 */
export function shouldEtherscanPluginBeInContext(state?: State, message?: Memory): boolean {
  if (!state) return true; // If no state, always active (fallback)
  return matchesPluginContext(state, etherscanKeywordPatterns, message);
}
