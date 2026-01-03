/**
 * Action Helper Utilities
 *
 * Shared utilities for Polymarket discovery plugin actions to reduce code duplication
 */

import { type IAgentRuntime, type Memory, type State, logger } from "@elizaos/core";
import { isAddress } from "viem";
import { PolymarketService } from "../services/polymarket.service";
import { shouldPolymarketPluginBeInContext } from "../../matcher";

/**
 * Validate Ethereum address format using viem
 *
 * @param address - Address to validate
 * @returns True if valid Ethereum address (checksummed or lowercase)
 */
export function isValidEthereumAddress(address: string): boolean {
  return isAddress(address);
}

/**
 * Validate that Polymarket service is available and plugin context is active
 *
 * @param runtime - Agent runtime
 * @param actionName - Name of action for logging
 * @param state - Optional state for plugin context check
 * @returns True if service is available and plugin context is active
 */
export function validatePolymarketService(
  runtime: IAgentRuntime,
  actionName: string,
  state?: State,
  message?: Memory
): boolean {
  try {
    // Check plugin context first
    if (!shouldPolymarketPluginBeInContext(state, message)) {
      return false;
    }

    const service = runtime.getService(
      PolymarketService.serviceType
    ) as PolymarketService;

    if (!service) {
      logger.warn(`[${actionName}] Polymarket service not available`);
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
 * Get Polymarket service from runtime
 *
 * @param runtime - Agent runtime
 * @returns Polymarket service instance or null
 */
export function getPolymarketService(
  runtime: IAgentRuntime
): PolymarketService | null {
  return runtime.getService(
    PolymarketService.serviceType
  ) as PolymarketService | null;
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
 * Truncate Ethereum address for display
 *
 * @param address - Full Ethereum address
 * @param prefixLength - Number of chars to show after 0x (default: 6)
 * @param suffixLength - Number of chars to show at end (default: 4)
 * @returns Truncated address (e.g., "0x1234...5678")
 */
export function truncateAddress(
  address: string,
  prefixLength: number = 6,
  suffixLength: number = 4
): string {
  if (!address || address.length <= prefixLength + suffixLength + 2) {
    return address;
  }
  const prefix = address.slice(0, 2 + prefixLength); // "0x" + prefix
  const suffix = address.slice(-suffixLength);
  return `${prefix}...${suffix}`;
}

/**
 * Format number as USD currency
 *
 * @param value - Number or string to format
 * @param decimals - Number of decimal places (default: 2)
 * @returns Formatted currency string (e.g., "$1,234.56")
 */
export function formatCurrency(
  value: number | string,
  decimals: number = 2
): string {
  const numValue = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(numValue)) return "$0.00";

  return numValue.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
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
 * Format number as percentage
 *
 * @param value - Number to format (e.g., 0.5 or 50)
 * @param decimals - Number of decimal places (default: 2)
 * @param isDecimal - Whether value is decimal (0-1) or already percentage (0-100) (default: true)
 * @returns Formatted percentage string (e.g., "50.00%")
 */
export function formatPercentage(
  value: number,
  decimals: number = 2,
  isDecimal: boolean = true
): string {
  if (isNaN(value)) return "0.00%";

  const percentValue = isDecimal ? value * 100 : value;
  return `${percentValue.toFixed(decimals)}%`;
}

/**
 * Format price change with value and percentage
 *
 * @param firstPrice - Starting price
 * @param lastPrice - Ending price
 * @returns Object with change value and percentage
 */
export function formatPriceChange(
  firstPrice: number,
  lastPrice: number
): { value: number; percentage: number; formatted: string } {
  const change = lastPrice - firstPrice;
  // Handle edge case where firstPrice is 0 to avoid Infinity
  const changePercent = firstPrice === 0 ? 0 : (change / firstPrice) * 100;
  const sign = change >= 0 ? "+" : "";
  const formatted = `${sign}${change.toFixed(4)} (${sign}${changePercent.toFixed(2)}%)`;

  return { value: change, percentage: changePercent, formatted };
}
