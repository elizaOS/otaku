/**
 * Action Helper Utilities
 *
 * Shared utilities for Polymarket discovery plugin actions to reduce code duplication
 */

import { type IAgentRuntime, type Memory, logger } from "@elizaos/core";
import { isAddress } from "viem";
import { PolymarketService } from "../services/polymarket.service";

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
 * Validate that Polymarket service is available
 *
 * @param runtime - Agent runtime
 * @param actionName - Name of action for logging
 * @returns True if service is available
 */
export function validatePolymarketService(
  runtime: IAgentRuntime,
  actionName: string
): boolean {
  try {
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
