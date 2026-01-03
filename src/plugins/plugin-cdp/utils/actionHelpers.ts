/**
 * Action Helper Utilities
 *
 * Shared utilities for CDP plugin actions to reduce code duplication
 */

import { type IAgentRuntime, type Memory, type State, logger } from "@elizaos/core";
import { CdpService } from "../services/cdp.service";

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
  _state?: State,
  _message?: Memory
): boolean {
  try {
    // CDP plugin always active - no context matching required
    // This ensures wallet operations are always available to the agent

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
 * CDP plugin always active - no context matching required
 *
 * @param actionName - Name of action for logging
 * @param state - Optional state for plugin context check
 * @param message - Optional message for plugin context check
 * @returns Always true - CDP plugin is always available
 */
export function validateCdpPluginContext(
  _actionName: string,
  _state?: State,
  _message?: Memory
): boolean {
  // CDP plugin always active - no context matching required
  return true;
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
