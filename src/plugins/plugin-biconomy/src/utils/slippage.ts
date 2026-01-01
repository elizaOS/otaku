import { type ActionResult, type HandlerCallback, logger } from "@elizaos/core";

export const DEFAULT_SLIPPAGE = 1; // 1%
export const MIN_SLIPPAGE = 0.01; // 0.01% minimum
export const MAX_SLIPPAGE_WITHOUT_CONFIRMATION = 5; // 5%
export const ABSOLUTE_MAX_SLIPPAGE = 50; // 50% hard cap - cannot exceed even with confirmation

export interface SlippageValidationResult {
  valid: boolean;
  errorResult?: ActionResult;
}

/**
 * Creates an error result for slippage validation failures.
 */
function createSlippageError(
  errorMsg: string,
  errorCode: string,
  inputParams: Record<string, unknown>,
  actionName: string,
  callback?: HandlerCallback
): SlippageValidationResult {
  logger.warn(`[${actionName}] Slippage validation failed: ${errorCode}`);
  callback?.({ text: errorMsg });
  return {
    valid: false,
    errorResult: {
      text: errorMsg,
      success: false,
      error: errorCode,
      input: inputParams,
    } as ActionResult,
  };
}

/**
 * Validates slippage percentage value.
 *
 * Validation rules:
 * - Must be a valid number (not NaN)
 * - Must be positive (> 0)
 * - Must not exceed 100%
 * - Must not exceed 50% (absolute max) even with confirmation
 * - Must not exceed 5% without explicit confirmation
 *
 * @param slippage - Slippage as percentage (e.g., 1 = 1%)
 * @param confirmHighSlippage - Whether user confirmed high slippage
 * @param inputParams - Input parameters for error response
 * @param actionName - Action name for logging
 * @param callback - Optional callback for user messages
 * @returns Validation result with optional error
 *
 * @example
 * // Valid: 1% slippage (default)
 * validateSlippage(1, false, params, "SWAP")
 *
 * @example
 * // Valid: 10% with confirmation
 * validateSlippage(10, true, params, "SWAP")
 *
 * @example
 * // Invalid: 60% exceeds absolute max
 * validateSlippage(60, true, params, "SWAP") // Returns error
 */
export function validateSlippage(
  slippage: number,
  confirmHighSlippage: boolean,
  inputParams: Record<string, unknown>,
  actionName: string,
  callback?: HandlerCallback
): SlippageValidationResult {
  // Validate: must be a number
  if (typeof slippage !== "number" || Number.isNaN(slippage)) {
    return createSlippageError(
      "❌ Invalid slippage value. Please provide a valid number.",
      "invalid_slippage_type",
      inputParams,
      actionName,
      callback
    );
  }

  // Validate: must be positive
  if (slippage <= 0) {
    return createSlippageError(
      `❌ Slippage must be greater than 0%. Received: ${slippage}%`,
      "slippage_must_be_positive",
      inputParams,
      actionName,
      callback
    );
  }

  // Validate: cannot exceed 100%
  if (slippage > 100) {
    return createSlippageError(
      `❌ Slippage cannot exceed 100%. Received: ${slippage}%`,
      "slippage_exceeds_maximum",
      inputParams,
      actionName,
      callback
    );
  }

  // Validate: absolute maximum (50%) - cannot be bypassed even with confirmation
  if (slippage > ABSOLUTE_MAX_SLIPPAGE) {
    return createSlippageError(
      `❌ Slippage of ${slippage}% exceeds the absolute maximum of ${ABSOLUTE_MAX_SLIPPAGE}%. This limit exists to protect against catastrophic value loss from MEV attacks. Please use a slippage of ${ABSOLUTE_MAX_SLIPPAGE}% or less.`,
      "slippage_exceeds_absolute_max",
      inputParams,
      actionName,
      callback
    );
  }

  // Validate: high slippage (≥5%) requires confirmation
  if (slippage >= MAX_SLIPPAGE_WITHOUT_CONFIRMATION && !confirmHighSlippage) {
    return createSlippageError(
      `⚠️ Slippage of ${slippage}% is above the recommended maximum of ${MAX_SLIPPAGE_WITHOUT_CONFIRMATION}%. This could result in significant value loss. To proceed, please confirm you're okay with high slippage.`,
      "high_slippage_not_confirmed",
      inputParams,
      actionName,
      callback
    );
  }

  // Warn if proceeding with high slippage (confirmed)
  if (slippage >= MAX_SLIPPAGE_WITHOUT_CONFIRMATION && confirmHighSlippage) {
    logger.warn(`[${actionName}] Proceeding with high slippage: ${slippage}%`);
    callback?.({
      text: `⚠️ Proceeding with high slippage of ${slippage}% as confirmed.`,
    });
  }

  return { valid: true };
}

/**
 * Converts slippage from percentage (1 = 1%) to decimal (0.01)
 *
 * @param slippage - Slippage as percentage
 * @returns Slippage as decimal
 *
 * @example
 * slippageToDecimal(1)   // 0.01
 * slippageToDecimal(5)   // 0.05
 * slippageToDecimal(0.5) // 0.005
 */
export function slippageToDecimal(slippage: number): number {
  return slippage / 100;
}
