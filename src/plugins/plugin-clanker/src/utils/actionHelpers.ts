/**
 * Action Helper Utilities
 *
 * Shared utilities for Clanker plugin actions to reduce code duplication
 */

import { type IAgentRuntime, type Memory, type State, logger } from "@elizaos/core";
import { ClankerService } from "../services/clanker.service";
import { shouldClankerPluginBeInContext } from "../../matcher";

/**
 * Validate that Clanker service is available and plugin context is active
 *
 * @param runtime - Agent runtime
 * @param actionName - Name of action for logging
 * @param state - Optional state for plugin context check
 * @param message - Optional message for plugin context check
 * @returns True if service is available and plugin context is active
 */
export function validateClankerService(
  runtime: IAgentRuntime,
  actionName: string,
  state?: State,
  message?: Memory
): boolean {
  try {
    // Check plugin context first
    if (!shouldClankerPluginBeInContext(state, message)) {
      return false;
    }

    const service = runtime.getService(
      ClankerService.serviceType
    ) as ClankerService;

    if (!service) {
      logger.warn(`[${actionName}] Clanker service not available`);
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
 * Get Clanker service from runtime
 *
 * @param runtime - Agent runtime
 * @returns Clanker service instance or null
 */
export function getClankerService(
  runtime: IAgentRuntime
): ClankerService | null {
  return runtime.getService(
    ClankerService.serviceType
  ) as ClankerService | null;
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
