import { logger } from "@elizaos/core";
import { MorphoErrorCode, MorphoErrorResponse, MatchingImpact } from "../types";
import BigNumber from "bignumber.js";

export class MorphoError extends Error {
  code: MorphoErrorCode;
  details?: any;
  suggestions?: string[];
  matchingImpact?: MatchingImpact;
  fallbackOptions?: string[];

  constructor(
    code: MorphoErrorCode,
    message: string,
    details?: any,
    suggestions?: string[],
    matchingImpact?: MatchingImpact,
    fallbackOptions?: string[],
  ) {
    super(message);
    this.name = "MorphoError";
    this.code = code;
    this.details = details;
    this.suggestions = suggestions;
    this.matchingImpact = matchingImpact;
    this.fallbackOptions = fallbackOptions;
  }
}

export class ErrorHandler {
  static handle(error: any): MorphoError {
    logger.error("Handling error:", error);

    // Already a MorphoError
    if (error instanceof MorphoError) {
      return error;
    }

    // Parse different error types
    const errorMessage = error.message || error.toString();
    const errorCode = error.code || "UNKNOWN";

    // Insufficient collateral errors
    if (
      errorMessage.includes("insufficient collateral") ||
      errorMessage.includes("health factor") ||
      errorMessage.includes("undercollateralized")
    ) {
      return new MorphoError(
        MorphoErrorCode.INSUFFICIENT_COLLATERAL,
        "Insufficient collateral for this operation",
        { originalError: errorMessage },
        [
          "Supply more collateral before borrowing",
          "Reduce the borrow amount",
          "Check your current health factor",
        ],
      );
    }

    // Matching failed errors
    if (
      errorMessage.includes("matching failed") ||
      errorMessage.includes("p2p matching") ||
      errorMessage.includes("no match found")
    ) {
      return new MorphoError(
        MorphoErrorCode.MATCHING_FAILED,
        "Peer-to-peer matching failed",
        { originalError: errorMessage },
        [
          "Try with a different amount",
          "Increase gas limit for matching",
          "Transaction will proceed with pool rates",
        ],
        {
          expectedMatching: 0.7,
          actualMatching: 0,
          gasUsed: new BigNumber(0),
          rateImpact: 1.5,
        },
        ["Execute with pool rates only", "Wait for better matching conditions"],
      );
    }

    // Position not found errors
    if (
      errorMessage.includes("position not found") ||
      errorMessage.includes("no position") ||
      errorMessage.includes("user has no")
    ) {
      return new MorphoError(
        MorphoErrorCode.POSITION_NOT_FOUND,
        "No active position found",
        { originalError: errorMessage },
        [
          "Supply assets first before borrowing",
          "Check if you have the correct wallet connected",
          "Verify the asset symbol",
        ],
      );
    }

    // Rate calculation errors
    if (
      errorMessage.includes("rate calculation") ||
      errorMessage.includes("apy calculation") ||
      errorMessage.includes("interest calculation")
    ) {
      return new MorphoError(
        MorphoErrorCode.RATE_CALCULATION_ERROR,
        "Failed to calculate rates",
        { originalError: errorMessage },
        [
          "Try again in a few moments",
          "Check if the market is active",
          "Verify the asset is supported",
        ],
      );
    }

    // Liquidity errors
    if (
      errorMessage.includes("insufficient liquidity") ||
      errorMessage.includes("not enough liquidity") ||
      errorMessage.includes("liquidity exhausted")
    ) {
      return new MorphoError(
        MorphoErrorCode.LIQUIDITY_ERROR,
        "Insufficient liquidity in the market",
        { originalError: errorMessage },
        [
          "Try a smaller amount",
          "Check available liquidity first",
          "Wait for more liquidity to be added",
        ],
      );
    }

    // Gas estimation errors
    if (
      errorMessage.includes("gas estimation") ||
      errorMessage.includes("gas required exceeds") ||
      errorMessage.includes("out of gas")
    ) {
      return new MorphoError(
        MorphoErrorCode.GAS_ESTIMATION_ERROR,
        "Gas estimation failed",
        { originalError: errorMessage },
        [
          "Increase gas limit",
          "Reduce matching gas allocation",
          "Try during lower network congestion",
        ],
      );
    }

    // Transaction failed errors
    if (
      errorMessage.includes("transaction failed") ||
      errorMessage.includes("execution reverted") ||
      errorMessage.includes("tx failed")
    ) {
      return new MorphoError(
        MorphoErrorCode.TRANSACTION_FAILED,
        "Transaction execution failed",
        { originalError: errorMessage },
        [
          "Check transaction parameters",
          "Verify token approvals",
          "Ensure sufficient balance for gas",
        ],
      );
    }

    // Invalid parameters
    if (
      errorMessage.includes("invalid parameter") ||
      errorMessage.includes("invalid amount") ||
      errorMessage.includes("validation failed")
    ) {
      return new MorphoError(
        MorphoErrorCode.INVALID_PARAMETERS,
        "Invalid parameters provided",
        { originalError: errorMessage },
        [
          "Check amount format and decimals",
          "Verify asset symbol is correct",
          "Ensure amount is greater than zero",
        ],
      );
    }

    // Network errors
    if (
      errorMessage.includes("network error") ||
      errorMessage.includes("connection failed") ||
      errorMessage.includes("timeout")
    ) {
      return new MorphoError(
        MorphoErrorCode.NETWORK_ERROR,
        "Network connection error",
        { originalError: errorMessage },
        [
          "Check your internet connection",
          "Verify RPC endpoint is accessible",
          "Try again in a few moments",
        ],
      );
    }

    // Default unknown error
    return new MorphoError(
      MorphoErrorCode.UNKNOWN_ERROR,
      `Unknown error: ${errorMessage}`,
      { originalError: error },
      ["Contact support if the issue persists"],
    );
  }

  static createResponse(error: MorphoError): MorphoErrorResponse {
    return {
      code: error.code,
      message: error.message,
      details: error.details,
      suggestions: error.suggestions,
      matchingImpact: error.matchingImpact,
      fallbackOptions: error.fallbackOptions,
    };
  }

  static async withRetry<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
    delayMs: number = 1000,
  ): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        logger.warn(`Attempt ${attempt} failed:`, lastError.message);

        if (attempt < maxRetries) {
          await new Promise((resolve) =>
            setTimeout(resolve, delayMs * attempt),
          );
        }
      }
    }

    throw this.handle(lastError);
  }

  static isRecoverableError(error: MorphoError): boolean {
    const recoverableCodes = [
      MorphoErrorCode.MATCHING_FAILED,
      MorphoErrorCode.GAS_ESTIMATION_ERROR,
      MorphoErrorCode.NETWORK_ERROR,
    ];

    return recoverableCodes.includes(error.code);
  }

  static getSuggestion(error: MorphoError): string {
    if (error.suggestions && error.suggestions.length > 0) {
      return error.suggestions[0];
    }

    switch (error.code) {
      case MorphoErrorCode.INSUFFICIENT_COLLATERAL:
        return "Supply more collateral or reduce borrow amount";
      case MorphoErrorCode.MATCHING_FAILED:
        return "Transaction will proceed with pool rates";
      case MorphoErrorCode.LIQUIDITY_ERROR:
        return "Try a smaller amount or different asset";
      default:
        return "Please try again or contact support";
    }
  }
}
