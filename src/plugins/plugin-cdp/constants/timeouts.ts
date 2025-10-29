import type { PublicClient } from "viem";
import { logger } from "@elizaos/core";

/**
 * Transaction timeout constants for CDP plugin
 * All timeouts in milliseconds
 */

/** Standard timeout for transaction confirmation (20 seconds) */
export const TX_CONFIRMATION_TIMEOUT = 20_000;

/** Extended timeout for bridge operations (2 minutes / 120 seconds) */
export const BRIDGE_CONFIRMATION_TIMEOUT = 120_000;

/** Bridge status polling interval (2 seconds) */
export const BRIDGE_POLL_INTERVAL = 2000;

/** Maximum bridge polling attempts (60 × 2s = 2 minutes) */
export const BRIDGE_MAX_POLL_ATTEMPTS = BRIDGE_CONFIRMATION_TIMEOUT / BRIDGE_POLL_INTERVAL;

/**
 * Wait for transaction confirmation and verify it succeeded
 * @param publicClient Viem public client
 * @param hash Transaction hash
 * @param operationType Type of operation for error messages (e.g., "swap", "transfer", "NFT transfer")
 * @param timeout Timeout in milliseconds (defaults to TX_CONFIRMATION_TIMEOUT)
 * @throws Error if transaction reverts or times out
 */
export async function waitForTxConfirmation(
  publicClient: PublicClient,
  hash: `0x${string}`,
  operationType: string = "transaction",
  timeout: number = TX_CONFIRMATION_TIMEOUT
): Promise<void> {
  logger.info(`[Transaction Confirmation] Waiting for ${operationType} confirmation...`);
  
  const receipt = await publicClient.waitForTransactionReceipt({ 
    hash,
    timeout,
  });
  
  if (receipt.status !== 'success') {
    throw new Error(
      `${operationType.charAt(0).toUpperCase() + operationType.slice(1)} transaction reverted on-chain. ` +
      `The ${operationType} failed - likely due to insufficient balance, slippage, or price impact.`
    );
  }
  
  logger.info(`[Transaction Confirmation] ${operationType} confirmed successfully in block ${receipt.blockNumber}`);
}

