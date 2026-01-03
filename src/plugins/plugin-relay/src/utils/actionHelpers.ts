/**
 * Action Helper Utilities
 *
 * Shared utilities for Relay plugin actions to reduce code duplication
 */

import { type IAgentRuntime, type Memory, type State, logger } from "@elizaos/core";
import { RelayService } from "../services/relay.service";
import { shouldRelayPluginBeInContext } from "../../matcher";

/**
 * Validate that Relay service is available and plugin context is active
 *
 * @param runtime - Agent runtime
 * @param actionName - Name of action for logging
 * @param state - Optional state for plugin context check
 * @param message - Optional message for plugin context check
 * @returns True if service is available and plugin context is active
 */
export function validateRelayService(
  runtime: IAgentRuntime,
  actionName: string,
  state?: State,
  message?: Memory
): boolean {
  try {
    // Check plugin context first
    if (!shouldRelayPluginBeInContext(state, message)) {
      return false;
    }

    const service = runtime.getService(
      RelayService.serviceType
    ) as RelayService;

    if (!service) {
      logger.warn(`[${actionName}] Relay service not available`);
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
 * Get Relay service from runtime
 *
 * @param runtime - Agent runtime
 * @returns Relay service instance or null
 */
export function getRelayService(
  runtime: IAgentRuntime
): RelayService | null {
  return runtime.getService(
    RelayService.serviceType
  ) as RelayService | null;
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
 * Serialize BigInt values to strings for safe JSON serialization
 *
 * @param obj - Object to serialize
 * @returns Object with BigInt values converted to strings
 */
export function serializeBigInt(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'bigint') return obj.toString();
  if (Array.isArray(obj)) return obj.map(serializeBigInt);
  if (typeof obj === 'object') {
    const serialized: any = {};
    for (const key in obj) {
      serialized[key] = serializeBigInt(obj[key]);
    }
    return serialized;
  }
  return obj;
}

/**
 * Get chain name from chain ID
 *
 * @param chainId - Chain ID
 * @returns Human-readable chain name
 */
export function getChainName(chainId: number): string {
  const chains: Record<number, string> = {
    1: "Ethereum",
    8453: "Base",
    42161: "Arbitrum",
    137: "Polygon",
    10: "Optimism",
    7777777: "Zora",
    81457: "Blast",
    534352: "Scroll",
    59144: "Linea",
  };
  return chains[chainId] || `Chain ${chainId}`;
}

/**
 * Format amount with proper decimals
 *
 * @param amount - Amount in wei/smallest unit
 * @param currency - Currency symbol
 * @returns Formatted amount string
 */
export function formatAmount(amount: string, currency: string): string {
  const decimals = currency.toLowerCase().includes("usdc") || currency.toLowerCase().includes("usdt") ? 6 : 18;
  const value = Number(amount) / Math.pow(10, decimals);
  return `${value.toFixed(6)} ${currency.toUpperCase()}`;
}
