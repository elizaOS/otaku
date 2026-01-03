/**
 * Action Helper Utilities
 *
 * Shared utilities for Etherscan plugin actions to reduce code duplication
 */

import { type IAgentRuntime, type Memory, type State, logger } from "@elizaos/core";
import { EtherscanService } from "../services/etherscan.service";
import { shouldEtherscanPluginBeInContext } from "../../matcher";

/**
 * Validate that Etherscan service is available and plugin context is active
 *
 * @param runtime - Agent runtime
 * @param actionName - Name of action for logging
 * @param state - Optional state for plugin context check
 * @param message - Optional message for plugin context check
 * @returns True if service is available and plugin context is active
 */
export function validateEtherscanService(
  runtime: IAgentRuntime,
  actionName: string,
  state?: State,
  message?: Memory
): boolean {
  try {
    // Check plugin context first
    if (!shouldEtherscanPluginBeInContext(state, message)) {
      return false;
    }

    const service = runtime.getService(
      EtherscanService.serviceType
    ) as EtherscanService;

    if (!service) {
      logger.warn(`[${actionName}] Etherscan service not available`);
      return false;
    }

    // Check API key validity
    const apiKey = runtime.getSetting("ETHERSCAN_API_KEY");
    if (typeof apiKey !== "string" || apiKey.indexOf("YourApiKeyToken") === 0) {
      logger.warn(`[${actionName}] Invalid or missing ETHERSCAN_API_KEY`);
      return false;
    }

    return true;
  } catch (error) {
    logger.error(
      `[${actionName}] Error validating action:`,
      error instanceof Error ? error.message : String(error)
    );
    return false;
  }
}

/**
 * Get Etherscan service from runtime
 *
 * @param runtime - Agent runtime
 * @returns Etherscan service instance or null
 */
export function getEtherscanService(
  runtime: IAgentRuntime
): EtherscanService | null {
  return runtime.getService(
    EtherscanService.serviceType
  ) as EtherscanService | null;
}

/**
 * Extract parameters from composed state
 *
 * @param runtime - Agent runtime
 * @param message - Memory message
 * @returns Action parameters object
 */
export async function extractActionParams<T>(
  runtime: IAgentRuntime,
  message: Memory
): Promise<Partial<T>> {
  const composedState = await runtime.composeState(
    message,
    ["ACTION_STATE"],
    true
  );
  return (composedState?.data?.actionParams ?? {}) as Partial<T>;
}

/**
 * Validate Ethereum transaction hash format
 *
 * @param hash - Hash to validate
 * @returns True if valid transaction hash (0x followed by 64 hex characters)
 */
export function isValidTransactionHash(hash: string): boolean {
  return /^0x[a-fA-F0-9]{64}$/.test(hash);
}

/**
 * Validate Ethereum address format
 *
 * @param address - Address to validate
 * @returns True if valid Ethereum address (0x followed by 40 hex characters)
 */
export function isValidEthereumAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

/**
 * Extract transaction hash from text
 *
 * @param text - Text to search
 * @returns Transaction hash or null if not found
 */
export function extractTransactionHash(text: string): string | null {
  const match = text.match(/0x[a-fA-F0-9]{64}/);
  return match ? match[0] : null;
}

/**
 * Extract Ethereum address from text
 *
 * @param text - Text to search
 * @returns Ethereum address or null if not found
 */
export function extractEthereumAddress(text: string): string | null {
  const match = text.match(/0x[a-fA-F0-9]{40}/);
  return match ? match[0] : null;
}

/**
 * Extract chain name from text
 *
 * @param text - Text to search
 * @returns Chain name or null if not found
 */
export function extractChainName(text: string): string | null {
  const chainKeywords = [
    "ethereum", "eth", "mainnet",
    "polygon", "matic",
    "arbitrum", "arb",
    "optimism", "op",
    "base",
    "bsc", "binance",
    "avalanche", "avax",
    "fantom", "ftm",
    "sepolia", "goerli", "holesky"
  ];

  const lowerText = text.toLowerCase();
  for (const keyword of chainKeywords) {
    if (lowerText.includes(keyword)) {
      return keyword;
    }
  }
  return null;
}

/**
 * Truncate transaction hash for display
 *
 * @param hash - Full transaction hash
 * @param prefixLength - Number of chars to show after 0x (default: 6)
 * @param suffixLength - Number of chars to show at end (default: 4)
 * @returns Truncated hash (e.g., "0x1234...5678")
 */
export function truncateHash(
  hash: string,
  prefixLength: number = 6,
  suffixLength: number = 4
): string {
  if (!hash || hash.length <= prefixLength + suffixLength + 2) {
    return hash;
  }
  const prefix = hash.slice(0, 2 + prefixLength); // "0x" + prefix
  const suffix = hash.slice(-suffixLength);
  return `${prefix}...${suffix}`;
}

/**
 * Format number with thousand separators
 *
 * @param value - Number or string to format
 * @param decimals - Number of decimal places (default: 0)
 * @returns Formatted number string (e.g., "1,234")
 */
export function formatNumber(
  value: number | string,
  decimals: number = 0
): string {
  const numValue = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(numValue)) return "0";

  return numValue.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Format gas amount in Gwei
 *
 * @param gasWei - Gas amount in wei (as number or hex string)
 * @param decimals - Number of decimal places (default: 4)
 * @returns Formatted gas amount in Gwei
 */
export function formatGasInGwei(
  gasWei: number | string,
  decimals: number = 4
): string {
  const gasValue = typeof gasWei === "string"
    ? parseInt(gasWei, 16)
    : gasWei;
  const gwei = gasValue / 1e9;
  return gwei.toFixed(decimals);
}

/**
 * Capitalize first letter of a string
 *
 * @param text - Text to capitalize
 * @returns Capitalized text
 */
export function capitalize(text: string): string {
  if (!text) return text;
  return text.charAt(0).toUpperCase() + text.slice(1);
}
