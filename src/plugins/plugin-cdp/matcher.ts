import type { Memory, State } from "@elizaos/core";
import { matchesPluginContext, type PluginKeywordPatterns } from "@/utils/plugin-context-matcher";

/**
 * Keyword patterns for CDP plugin context activation
 */
export const cdpKeywordPatterns: PluginKeywordPatterns = {
  keywords: [
    // Wallet operations
    "wallet", "balance", "address",
    // Transfers
    "send", "transfer", "pay",
    // Swaps
    "swap", "trade", "exchange", "buy", "sell",
    // Tokens
    "token", "eth", "usdc", "dai", "weth", "usdt",
    // NFTs
    "nft", "erc721", "erc1155",
    // Transaction management
    "transaction", "tx", "explorer", "confirm", "confirmation",
    // ENS
    "ens", "resolve", ".eth",
  ],
  regexPatterns: [
    /send.*(?:eth|usdc|dai|token)/i,
    /swap.*(?:eth|usdc|dai|token)/i,
    /transfer.*(?:eth|usdc|dai|token|nft)/i,
    /balance.*(?:eth|usdc|dai|token)/i,
  ],
};

/**
 * Check if CDP plugin should be active based on recent conversation
 *
 * Use this in each CDP action's validate function:
 *
 * @example
 * ```ts
 * validate: async (_runtime: IAgentRuntime, message: Memory, state?: State) => {
 *   // Check plugin context first
 *   if (!shouldCdpPluginBeInContext(state, message)) {
 *     return false;
 *   }
 *
 *   // Then check service availability
 *   const cdpService = _runtime.getService(CdpService.serviceType) as CdpService;
 *   return !!cdpService;
 * }
 * ```
 */
export function shouldCdpPluginBeInContext(state?: State, message?: Memory): boolean {
  if (!state) return true; // If no state, always active (fallback)
  return matchesPluginContext(state, cdpKeywordPatterns, message);
}
