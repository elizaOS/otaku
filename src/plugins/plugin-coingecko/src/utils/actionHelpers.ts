/**
 * Action Helper Utilities
 *
 * Shared utilities for CoinGecko plugin actions to reduce code duplication
 */

import { type IAgentRuntime, type Memory, type State, logger } from "@elizaos/core";
import { CoinGeckoService } from "../services/coingecko.service";
import { shouldCoingeckoPluginBeInContext } from "../../matcher";

/**
 * Validate that CoinGecko service is available and plugin context is active
 *
 * @param runtime - Agent runtime
 * @param actionName - Name of action for logging
 * @param state - Optional state for plugin context check
 * @param message - Optional message for plugin context check
 * @returns True if service is available and plugin context is active
 */
export function validateCoingeckoService(
  runtime: IAgentRuntime,
  actionName: string,
  state?: State,
  message?: Memory
): boolean {
  try {
    // Check plugin context first
    if (!shouldCoingeckoPluginBeInContext(state, message)) {
      return false;
    }

    const service = runtime.getService(
      CoinGeckoService.serviceType
    ) as CoinGeckoService;

    if (!service) {
      logger.warn(`[${actionName}] CoinGecko service not available`);
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
 * Get CoinGecko service from runtime
 *
 * @param runtime - Agent runtime
 * @returns CoinGecko service instance or null
 */
export function getCoingeckoService(
  runtime: IAgentRuntime
): CoinGeckoService | null {
  return runtime.getService(
    CoinGeckoService.serviceType
  ) as CoinGeckoService | null;
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
 * Format market cap values
 *
 * @param value - Number to format
 * @returns Formatted string (e.g., "1.23B", "456.78M", "12.34K")
 */
export function formatMarketCap(value: number): string {
  if (value >= 1000000000) return `${(value / 1000000000).toFixed(2)}B`;
  if (value >= 1000000) return `${(value / 1000000).toFixed(2)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(2)}K`;
  return value.toFixed(2);
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
 * Convert natural date to dd-mm-yyyy format
 *
 * @param dateStr - Natural language date (e.g., "today", "yesterday", "7 days ago", "2024-01-15")
 * @returns Date in dd-mm-yyyy format
 * @throws Error if date cannot be parsed
 */
export function parseDateToApiFormat(dateStr: string): string {
  // Try parsing various date formats and convert to dd-mm-yyyy
  const normalized = dateStr.trim().toLowerCase();

  // Check if already in dd-mm-yyyy format
  if (/^\d{2}-\d{2}-\d{4}$/.test(dateStr)) {
    return dateStr;
  }

  let date: Date;

  // Parse common formats
  if (normalized === 'today') {
    date = new Date();
  } else if (normalized === 'yesterday') {
    date = new Date();
    date.setDate(date.getDate() - 1);
  } else if (/^(\d+)\s*days?\s*ago$/.test(normalized)) {
    const daysMatch = normalized.match(/^(\d+)\s*days?\s*ago$/);
    const days = daysMatch ? parseInt(daysMatch[1]) : 0;
    date = new Date();
    date.setDate(date.getDate() - days);
  } else if (/^(\d+)\s*weeks?\s*ago$/.test(normalized)) {
    const weeksMatch = normalized.match(/^(\d+)\s*weeks?\s*ago$/);
    const weeks = weeksMatch ? parseInt(weeksMatch[1]) : 0;
    date = new Date();
    date.setDate(date.getDate() - (weeks * 7));
  } else if (/^(\d+)\s*months?\s*ago$/.test(normalized)) {
    const monthsMatch = normalized.match(/^(\d+)\s*months?\s*ago$/);
    const months = monthsMatch ? parseInt(monthsMatch[1]) : 0;
    date = new Date();
    date.setMonth(date.getMonth() - months);
  } else if (/^(\d+)\s*years?\s*ago$/.test(normalized)) {
    const yearsMatch = normalized.match(/^(\d+)\s*years?\s*ago$/);
    const years = yearsMatch ? parseInt(yearsMatch[1]) : 0;
    date = new Date();
    date.setFullYear(date.getFullYear() - years);
  } else {
    // Try parsing as a date string (yyyy-mm-dd, mm/dd/yyyy, etc.)
    date = new Date(dateStr);
    if (isNaN(date.getTime())) {
      throw new Error(`Unable to parse date: ${dateStr}`);
    }
  }

  // Convert to dd-mm-yyyy format
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();

  return `${day}-${month}-${year}`;
}
