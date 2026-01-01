import { logger } from "@elizaos/core";
import { CdpService } from "../../../plugin-cdp/services/cdp.service";
import { BICONOMY_SUPPORTED_CHAINS, TOKEN_ADDRESSES } from "../types";

const BASE_CHAIN_NAME = "base";
const BASE_CHAIN_ID = BICONOMY_SUPPORTED_CHAINS[BASE_CHAIN_NAME];
const BASE_USDC_ADDRESS = BASE_CHAIN_ID ? TOKEN_ADDRESSES[BASE_CHAIN_ID]?.usdc?.toLowerCase() : undefined;
const MIN_BASE_USDC_USD = 1; // Require at least ~$1 to reliably cover orchestration fee

export interface PreferredFeeTokenResult {
  feeToken: { address: string; chainId: number };
  usedBaseUsdc: boolean;
}

/**
 * Attempts to use Base USDC as the fee token for MEE transactions.
 * Falls back to the caller-provided default if the user lacks Base USDC liquidity.
 */
export const tryGetBaseUsdcFeeToken = async (
  cdpService: CdpService,
  accountName: string
): Promise<PreferredFeeTokenResult | null> => {
  if (!cdpService?.getWalletInfoCached || !BASE_CHAIN_ID || !BASE_USDC_ADDRESS) {
    return null;
  }

  try {
    const walletInfo = await cdpService.getWalletInfoCached(accountName, BASE_CHAIN_NAME);
    const baseTokens = walletInfo?.tokens || [];

    const usdcPosition = baseTokens.find((token) => {
      const contractMatches = token.contractAddress?.toLowerCase() === BASE_USDC_ADDRESS;
      const symbolMatches = token.symbol?.toLowerCase() === "usdc";
      return contractMatches || symbolMatches;
    });

    if (!usdcPosition) {
      return null;
    }

    const hasUsdBuffer = typeof usdcPosition.usdValue === "number" && usdcPosition.usdValue >= MIN_BASE_USDC_USD;

    if (!hasUsdBuffer) {
      return null;
    }

    logger.info("[BICONOMY] Using Base USDC as preferred fee token");
    return {
      feeToken: {
        address: BASE_USDC_ADDRESS,
        chainId: BASE_CHAIN_ID,
      },
      usedBaseUsdc: true,
    };
  } catch (error) {
    logger.warn(`[BICONOMY] Failed to evaluate Base USDC fee token: ${(error as Error).message}`);
    return null;
  }
};
