/**
 * FETCH_WITH_PAYMENT Action
 * 
 * Makes HTTP requests to x402-enabled paid APIs with automatic payment handling.
 * 
 * This action integrates Coinbase's x402 payment protocol to enable agents to:
 * - Make requests to APIs that require onchain payment (HTTP 402)
 * - Automatically detect payment requirements from API responses
 * - Sign and submit USDC payment transactions on Base network
 * - Retry requests with proof of payment
 * - Return both API response data and payment transaction details
 * 
 * Payment Flow:
 * 1. Agent makes initial HTTP request to x402-enabled API
 * 2. API returns 402 Payment Required with payment details
 * 3. Action verifies payment is within maxPayment limit
 * 4. Creates and signs USDC payment transaction using CDP wallet
 * 5. Submits payment onchain and gets transaction hash
 * 6. Retries original request with payment proof header
 * 7. Returns API response + payment receipt to user
 * 
 * @see https://docs.cdp.coinbase.com/x402/quickstart-for-buyers
 * 
 * @example
 * // User: "fetch https://api.example.com/paid-data with payment"
 * // Agent executes: FETCH_WITH_PAYMENT { url: "https://...", maxPayment: 1.0 }
 * 
 * @requires CDP Service - Must be configured with API credentials
 * @requires CDP Wallet - User must have wallet with USDC balance on Base
 * @requires x402-fetch - Payment wrapper library (installed via package.json)
 */

import {
  type Action,
  type ActionExample,
  type IAgentRuntime,
  type Memory,
  type State,
  type HandlerCallback,
  type ActionResult,
  logger
} from "@elizaos/core";
import { getEntityWallet } from "../../../utils/entity";
import { CdpService } from "../services/cdp.service";
import { validateCdpService } from "../utils/actionHelpers";
import { wrapFetchWithPayment, decodeXPaymentResponse } from "x402-fetch";
import type { CdpNetwork } from "../types";

/**
 * Helper function to create standardized error results and invoke callback
 */
function createErrorResult(
  errorMsg: string,
  errorCode: string,
  inputParams: Record<string, unknown>,
  callback?: HandlerCallback
): ActionResult & { input: Record<string, unknown> } {
  logger.error(`[FETCH_WITH_PAYMENT] ${errorMsg}`);
  const errorResult: ActionResult & { input: Record<string, unknown> } = {
    text: ` ${errorMsg}`,
    success: false,
    error: errorCode,
    input: inputParams,
  };
  callback?.({ 
    text: errorResult.text,
    content: { error: errorCode, details: errorMsg }
  });
  return errorResult;
}

/**
 * Helper function to determine status indicator and prefix based on response status
 */
function getStatusIndicators(
  status: number,
  wasPaidRequest: boolean
): { emoji: string; prefix: string } {
  const isSuccessStatus = status >= 200 && status < 300;
  const isClientError = status >= 400 && status < 500;
  const isServerError = status >= 500;
  
  let emoji = '';
  let prefix = wasPaidRequest ? 'Paid Request' : 'Request';
  
  if (wasPaidRequest) {
    if (!isSuccessStatus) {
      emoji = '';
    }
  } else {
    if (isClientError) {
      emoji = '';
    } else if (isServerError) {
      emoji = '•';
    } else if (!isSuccessStatus) {
      emoji = '';
    }
  }
  
  return { emoji, prefix };
}

/**
 * Helper function to format and truncate response data
 */
function formatResponseData(responseData: unknown, maxLength: number = 500): string {
  if (typeof responseData === 'string') {
    return responseData.length > maxLength 
      ? `${responseData.substring(0, maxLength)}... (truncated)`
      : responseData;
  }
  
  const responseStr = JSON.stringify(responseData, null, 2);
  return responseStr.length > maxLength 
    ? `${responseStr.substring(0, maxLength)}... (truncated)`
    : responseStr;
}

export const cdpWalletFetchWithPayment: Action = {
  name: "FETCH_WITH_PAYMENT",
  similes: [
    "PAID_REQUEST",
    "X402_REQUEST",
    "PAY_AND_FETCH",
    "FETCH_PAID_API",
    "PAID_API_CALL",
    "X402_FETCH",
  ],
  description:
    "Makes HTTP requests with automatic x402 payment handling. If the endpoint returns 402 Payment Required, automatically completes the payment flow with USDC on Base. If the endpoint doesn't require payment, works like a regular HTTP request. Use this when you suspect an API might require payment or when explicitly requested to use paid endpoints. Supports GET and POST methods with optional headers and body.",

  parameters: {
    url: {
      type: "string",
      description: "The URL of the API endpoint to request (x402-enabled endpoints will trigger automatic payment)",
      required: true,
    },
    method: {
      type: "string",
      description: "HTTP method for the request. Must be either 'GET' or 'POST'. Defaults to 'GET'.",
      required: false,
    },
    headers: {
      type: "object",
      description: "Optional HTTP headers to include in the request (as key-value pairs)",
      required: false,
    },
    body: {
      type: "string",
      description: "Optional request body for POST requests (JSON string)",
      required: false,
    },
    maxPayment: {
      type: "number",
      description: "Maximum payment amount in USDC to authorize for this request. Defaults to 1.0 USDC.",
      required: false,
    },
  },
  
  validate: async (_runtime: IAgentRuntime, message: Memory, state?: State) => {
    return validateCdpService(_runtime, "USER_WALLET_FETCH_WITH_PAYMENT", state, message);
  },
  
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback,
  ): Promise<ActionResult> => {
    try {
      logger.info("[FETCH_WITH_PAYMENT] Initiating paid API request");
      
      // Read parameters from state (extracted by multiStepDecisionTemplate)
      const composedState = await runtime.composeState(message, ["ACTION_STATE"], true);
      const params = composedState?.data?.actionParams || {};
      
      // Extract and validate parameters
      const url = params?.url?.trim();
      const method = (params?.method?.trim()?.toUpperCase() || 'GET') as 'GET' | 'POST';
      const headers = params?.headers || {};
      const body = params?.body;
      const maxPayment = params?.maxPayment || 1.0;

      // Store input parameters for return
      const inputParams = {
        url,
        method,
        ...(Object.keys(headers).length > 0 && { headers }),
        ...(body && { body }),
        maxPayment,
      };

      // Validate URL
      if (!url) {
        return createErrorResult("URL is required", "missing_url", inputParams, callback);
      }

      // Validate URL format
      try {
        new URL(url);
      } catch {
        return createErrorResult(`Invalid URL format: ${url}`, "invalid_url", inputParams, callback);
      }

      // Validate method
      if (method !== 'GET' && method !== 'POST') {
        return createErrorResult(
          `Invalid HTTP method: ${method}. Only GET and POST are supported.`,
          "invalid_method",
          inputParams,
          callback
        );
      }

      // Validate maxPayment
      if (maxPayment <= 0) {
        return createErrorResult(
          `Invalid maxPayment: ${maxPayment}. Must be greater than 0.`,
          "invalid_max_payment",
          inputParams,
          callback
        );
      }

      const wallet = await getEntityWallet(
        runtime,
        message,
        "FETCH_WITH_PAYMENT",
        callback,
      );

      if (wallet.success === false) {
        logger.error("[FETCH_WITH_PAYMENT] Failed to get entity wallet");
        return {
          ...wallet.result,
          input: inputParams,
        } as ActionResult & { input: typeof inputParams };
      }

      const accountName = wallet.metadata?.accountName as string;

      if (!accountName) {
        return createErrorResult(
          "Could not find account name for wallet",
          "missing_account_name",
          inputParams,
          callback
        );
      }
      
      // Get CDP service
      const cdpService = runtime.getService(CdpService.serviceType) as CdpService;
      
      if (!cdpService) {
        return createErrorResult(
          "CDP service not available",
          "service_unavailable",
          inputParams,
          callback
        );
      }

      // Get the viem wallet client (defaults to base network)
      logger.info(`[FETCH_WITH_PAYMENT] Getting viem wallet client for: ${accountName}`);
      const { walletClient } = await cdpService.getViemClientsForAccount({ 
        accountName,
        network: "base" as CdpNetwork, // x402 uses base for USDC payments
      });

      // Ensure account is defined
      if (!walletClient.account) {
        return createErrorResult(
          "Wallet client account is not defined",
          "missing_account",
          inputParams,
          callback
        );
      }

      logger.info(`[FETCH_WITH_PAYMENT] Making ${method} request to ${url} with max payment ${maxPayment} USDC`);
      callback?.({ text: ` Making request to ${url}... (will handle payment if required)` });

      // Convert maxPayment from USDC to base units (USDC has 6 decimals)
      const maxPaymentInBaseUnits = BigInt(Math.floor(maxPayment * 1_000_000));

      // Wrap fetch with payment capability
      // Cast to any to bypass type incompatibility - walletClient is a valid SignerWallet
      const fetchWithPayment = wrapFetchWithPayment(fetch, walletClient as never, maxPaymentInBaseUnits);

      // Prepare fetch options
      const fetchOptions: RequestInit = {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
      };

      // Add body for POST requests
      if (method === 'POST' && body) {
        fetchOptions.body = body;
      }

      // Make the request
      const response = await fetchWithPayment(url, fetchOptions);

      // Parse response
      let responseData: unknown;
      const contentType = response.headers.get('content-type');
      
      if (contentType?.includes('application/json')) {
        responseData = await response.json();
      } else {
        responseData = await response.text();
      }

      // Decode payment response if present
      const paymentResponseHeader = response.headers.get("x-payment-response");
      let paymentInfo: { success: boolean; transaction: string; network: string; payer: string } | null = null;
      
      if (paymentResponseHeader) {
        try {
          paymentInfo = decodeXPaymentResponse(paymentResponseHeader);
          logger.info(`[FETCH_WITH_PAYMENT] Payment completed:`, JSON.stringify(paymentInfo));
        } catch (err) {
          logger.warn(`[FETCH_WITH_PAYMENT] Failed to decode payment response:`, err instanceof Error ? err.message : String(err));
        }
      }

      // Determine if this was actually a paid request
      const wasPaidRequest = !!paymentInfo;
      
      // Determine success based on status code
      const isSuccessStatus = response.status >= 200 && response.status < 300;
      const isClientError = response.status >= 400 && response.status < 500;
      const isServerError = response.status >= 500;
      
      // Build appropriate status message
      const { emoji: statusEmoji, prefix: statusPrefix } = getStatusIndicators(response.status, wasPaidRequest);
      
      let text = `${statusEmoji} **${statusPrefix} ${isSuccessStatus ? 'Completed' : 'Failed'}**\n\n`;
      text += ` **URL:** ${url}\n`;
      text += ` **Method:** ${method}\n`;
      text += ` **Status:** ${response.status} ${response.statusText}\n`;
      
      if (paymentInfo) {
        text += `\n$ **Payment Made:**\n`;
        text += `  • Transaction: \`${paymentInfo.transaction}\`\n`;
        text += `  • Network: ${paymentInfo.network}\n`;
        text += `  • Payer: \`${paymentInfo.payer}\`\n`;
      } else {
        text += `\n **Note:** No payment was required (endpoint did not return 402 Payment Required)\n`;
      }

      // Only show response body for successful requests or if it's informative
      if (isSuccessStatus || isClientError) {
        text += `\n **Response:**\n`;
        text += formatResponseData(responseData);
      } else if (isServerError) {
        text += `\n **Server Error:** The API returned a server error (5xx). Please try again later.\n`;
      }

      const data: Record<string, unknown> = {
        url,
        method,
        status: response.status,
        statusText: response.statusText,
        paymentRequired: wasPaidRequest,
        headers: Object.fromEntries(response.headers.entries()),
        data: responseData,
      };

      if (paymentInfo) {
        data.payment = paymentInfo;
      }

      callback?.({ 
        text, 
        content: data
      });

      return { 
        text, 
        success: isSuccessStatus, 
        data,
        values: data,
        input: inputParams,
      } as ActionResult & { input: typeof inputParams };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("[FETCH_WITH_PAYMENT] Action failed:", errorMessage);
      
      const errorText = ` Request failed: ${errorMessage}`;
      const errorResult: ActionResult = {
        text: errorText,
        success: false,
        error: errorMessage,
        input: {},
      } as ActionResult & { input: {} };
      
      callback?.({ 
        text: errorText,
        content: { error: "action_failed", details: errorMessage }
      });
      
      return errorResult;
    }
  },
  examples: [
    [
      { name: "{{user}}", content: { text: "fetch https://x402.example.com/premium-data with payment" } },
      { name: "{{agent}}", content: { text: " Making request to https://x402.example.com/premium-data...", action: "FETCH_WITH_PAYMENT", url: "https://x402.example.com/premium-data" } },
      { name: "{{agent}}", content: { text: " **Paid Request Completed**\n\n **URL:** https://x402.example.com/premium-data\n **Method:** GET\n **Status:** 200 OK\n\n$ **Payment Made:**\n  • Transaction: `0x1a2b3c4d5e6f7890abcdef1234567890abcdef1234567890abcdef1234567890`\n  • Network: base\n  • Payer: `0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb`" } },
    ],
    [
      { name: "{{user}}", content: { text: "POST to https://x402.example.com/submit with payment using body {\"key\": \"value\"}" } },
      { name: "{{agent}}", content: { text: " Making request to https://x402.example.com/submit...", action: "FETCH_WITH_PAYMENT", url: "https://x402.example.com/submit", method: "POST", body: "{\"key\": \"value\"}" } },
      { name: "{{agent}}", content: { text: " **Paid Request Completed**\n\n **URL:** https://x402.example.com/submit\n **Method:** POST\n **Status:** 200 OK\n\n$ **Payment Made:**\n  • Transaction: `0x9f8e7d6c5b4a3210fedcba0987654321fedcba0987654321fedcba0987654321`" } },
    ],
    [
      { name: "{{user}}", content: { text: "try to fetch https://regular-api.com/free-endpoint with payment support" } },
      { name: "{{agent}}", content: { text: " Making request to https://regular-api.com/free-endpoint...", action: "FETCH_WITH_PAYMENT", url: "https://regular-api.com/free-endpoint" } },
      { name: "{{agent}}", content: { text: " **Request Completed**\n\n **URL:** https://regular-api.com/free-endpoint\n **Method:** GET\n **Status:** 200 OK\n\n **Note:** No payment was required (endpoint did not return 402 Payment Required)" } },
    ],
  ],
};

export default cdpWalletFetchWithPayment;

