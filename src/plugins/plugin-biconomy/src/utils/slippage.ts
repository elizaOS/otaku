import { type ActionResult, type HandlerCallback, logger } from "@elizaos/core";

export const DEFAULT_SLIPPAGE = 1; // 1%
export const MAX_SLIPPAGE_WITHOUT_CONFIRMATION = 5; // 5%

export interface SlippageValidationResult {
  valid: boolean;
  errorResult?: ActionResult;
}

/**
 * Validates slippage and returns an error if > 5% without confirmation.
 * Also logs a warning if proceeding with high slippage.
 */
export function validateSlippage(
  slippage: number,
  confirmHighSlippage: boolean,
  inputParams: Record<string, unknown>,
  actionName: string,
  callback?: HandlerCallback
): SlippageValidationResult {
  if (slippage > MAX_SLIPPAGE_WITHOUT_CONFIRMATION && !confirmHighSlippage) {
    const errorMsg = `⚠️ Slippage of ${slippage}% is above the recommended maximum of ${MAX_SLIPPAGE_WITHOUT_CONFIRMATION}%. This could result in significant value loss. To proceed, please confirm you're okay with high slippage.`;
    logger.warn(`[${actionName}] High slippage rejected: ${slippage}%`);
    callback?.({ text: errorMsg });
    return {
      valid: false,
      errorResult: {
        text: errorMsg,
        success: false,
        error: "high_slippage_not_confirmed",
        input: inputParams,
      } as ActionResult,
    };
  }

  if (slippage > MAX_SLIPPAGE_WITHOUT_CONFIRMATION && confirmHighSlippage) {
    callback?.({ text: `⚠️ Proceeding with high slippage of ${slippage}% as confirmed.` });
  }

  return { valid: true };
}

/**
 * Converts slippage from percentage (1 = 1%) to decimal (0.01)
 */
export function slippageToDecimal(slippage: number): number {
  return slippage / 100;
}
