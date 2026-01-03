/**
 * Action Helper Utilities
 *
 * Shared utilities for CDP plugin actions to reduce code duplication
 */

import { type IAgentRuntime, type Memory, type State, logger } from "@elizaos/core";
import { CdpService } from "../services/cdp.service";
import { shouldCdpPluginBeInContext } from "../matcher";

/**
 * Validate that CDP service is available and plugin context is active
 *
 * @param runtime - Agent runtime
 * @param actionName - Name of action for logging
 * @param state - Optional state for plugin context check
 * @param message - Optional message for plugin context check
 * @returns True if service is available and plugin context is active
 */
export function validateCdpService(
  runtime: IAgentRuntime,
  actionName: string,
  state?: State,
  message?: Memory
): boolean {
  try {
    // Check plugin context first
    if (!shouldCdpPluginBeInContext(state, message)) {
      return false;
    }

    const service = runtime.getService(
      CdpService.serviceType
    ) as CdpService;

    if (!service) {
      logger.warn(`[${actionName}] CDP service not available`);
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
 * Validate plugin context only (for actions that don't require CDP service)
 *
 * @param actionName - Name of action for logging
 * @param state - Optional state for plugin context check
 * @param message - Optional message for plugin context check
 * @returns True if plugin context is active
 */
export function validateCdpPluginContext(
  actionName: string,
  state?: State,
  message?: Memory
): boolean {
  try {
    // Check plugin context first
    if (!shouldCdpPluginBeInContext(state, message)) {
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
 * Get CDP service from runtime
 *
 * @param runtime - Agent runtime
 * @returns CDP service instance or null
 */
export function getCdpService(
  runtime: IAgentRuntime
): CdpService | null {
  return runtime.getService(
    CdpService.serviceType
  ) as CdpService | null;
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
