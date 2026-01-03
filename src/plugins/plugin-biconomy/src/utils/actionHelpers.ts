/**
 * Action Helper Utilities
 *
 * Shared utilities for Biconomy plugin actions to reduce code duplication
 */

import { type IAgentRuntime, type Memory, type State, logger } from "@elizaos/core";
import { BiconomyService } from "../services/biconomy.service";
import { shouldBiconomyPluginBeInContext } from "../matcher";

/**
 * Validate that Biconomy service is available and plugin context is active
 *
 * @param runtime - Agent runtime
 * @param actionName - Name of action for logging
 * @param state - Optional state for plugin context check
 * @param message - Optional message for plugin context check
 * @returns True if service is available and plugin context is active
 */
export function validateBiconomyService(
  runtime: IAgentRuntime,
  actionName: string,
  state?: State,
  message?: Memory
): boolean {
  try {
    // Check plugin context first
    if (!shouldBiconomyPluginBeInContext(state, message)) {
      return false;
    }

    const service = runtime.getService(
      BiconomyService.serviceType
    ) as BiconomyService;

    if (!service) {
      logger.warn(`[${actionName}] Biconomy service not available`);
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
 * Get Biconomy service from runtime
 *
 * @param runtime - Agent runtime
 * @returns Biconomy service instance or null
 */
export function getBiconomyService(
  runtime: IAgentRuntime
): BiconomyService | null {
  return runtime.getService(
    BiconomyService.serviceType
  ) as BiconomyService | null;
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
