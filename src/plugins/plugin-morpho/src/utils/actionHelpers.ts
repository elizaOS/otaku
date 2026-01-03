/**
 * Action Helper Utilities
 *
 * Shared utilities for Morpho plugin actions to reduce code duplication
 */

import { type IAgentRuntime, type Memory, type State, logger } from "@elizaos/core";
import { MorphoService } from "../services";
import { CdpService } from "../../../plugin-cdp/services/cdp.service";
import { shouldMorphoPluginBeInContext } from "../../matcher";

/**
 * Validate that Morpho service and CDP service are available and plugin context is active
 *
 * @param runtime - Agent runtime
 * @param actionName - Name of action for logging
 * @param state - Optional state for plugin context check
 * @param message - Optional message for plugin context check
 * @returns True if services are available and plugin context is active
 */
export function validateMorphoService(
  runtime: IAgentRuntime,
  actionName: string,
  state?: State,
  message?: Memory
): boolean {
  try {
    // Check plugin context first
    if (!shouldMorphoPluginBeInContext(state, message)) {
      return false;
    }

    const morphoService = runtime.getService(
      MorphoService.serviceType
    ) as MorphoService;

    if (!morphoService) {
      logger.warn(`[${actionName}] Morpho service not available`);
      return false;
    }

    const cdpService = runtime.getService(
      CdpService.serviceType
    ) as CdpService;

    if (!cdpService) {
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
 * Get Morpho service from runtime
 *
 * @param runtime - Agent runtime
 * @returns Morpho service instance or null
 */
export function getMorphoService(
  runtime: IAgentRuntime
): MorphoService | null {
  return runtime.getService(
    MorphoService.serviceType
  ) as MorphoService | null;
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
