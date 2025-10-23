import {
  type Action,
  type IAgentRuntime,
  type Memory,
  type State,
  type HandlerCallback,
  type ActionResult,
  logger,
} from "@elizaos/core";
import { getEntityWallet } from "../../../utils/entity";
import { CdpService } from "../services/cdp.service";
import { getTokenMetadata, getTokenDecimals, resolveTokenSymbol } from "../utils/coingecko";
import { type CdpNetwork } from "../types";
import { ActionWithParams } from "../../../types";


interface SwapParams {
  network: CdpNetwork;
  fromToken: string; // Can be symbol or address, gets resolved later
  toToken: string; // Can be symbol or address, gets resolved later
  amount?: string; // Specific amount (mutually exclusive with percentage)
  percentage?: number; // Percentage of balance (mutually exclusive with amount)
  slippageBps?: number;
}

/**
 * Native token placeholder address for CDP swaps
 * CDP SDK uses this special address to represent native gas tokens (ETH, MATIC, etc.)
 * The SDK internally handles the native token → no need to convert to wrapped versions
 * 
 * Reference: https://docs.cdp.coinbase.com/server-wallets/v2/evm-features/swaps
 */
const NATIVE_TOKEN_ADDRESS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

/**
 * Wrapped token addresses for when users explicitly want wrapped tokens
 * (as opposed to native gas tokens)
 * 
 * Addresses verified from CoinGecko and official block explorers:
 * - WETH on Ethereum: Standard WETH9 contract
 * - WETH on Base/Optimism: 0x4200...0006 (OP Stack standard)
 * - WETH on Arbitrum: Native WETH on Arbitrum One
 * - WETH on Polygon: Bridged from Ethereum via PoS Bridge
 * - WMATIC on Polygon: Wrapped MATIC
 */
const WETH_ADDRESSES: Record<string, string> = {
  "base": "0x4200000000000000000000000000000000000006",
  "base-sepolia": "0x4200000000000000000000000000000000000006",
  "ethereum": "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  "arbitrum": "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
  "optimism": "0x4200000000000000000000000000000000000006",
  "polygon": "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619",
};

const WMATIC_ADDRESS = "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270";

/**
 * Resolve token to address using CoinGecko
 * Handles both symbols and addresses
 * 
 * IMPORTANT: CDP SDK supports native gas tokens using a special placeholder address.
 * - Native tokens (ETH, MATIC): Use 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE
 * - Wrapped tokens (WETH, WMATIC): Use actual contract addresses
 * 
 * Always validates addresses with CoinGecko to prevent fake/invalid addresses.
 * The LLM may generate addresses that look valid but don't exist.
 * This function ensures only real, verified tokens are used in swaps.
 * 
 * Reference: https://docs.cdp.coinbase.com/server-wallets/v2/evm-features/swaps
 */
const resolveTokenToAddress = async (
  token: string,
  network: string
): Promise<`0x${string}` | null> => {
  logger.debug(`Resolving token: ${token} on network: ${network}`);
  const trimmedToken = token.trim();
  
  // For native ETH - CDP uses special native token address
  if (trimmedToken.toLowerCase() === "eth") {
    logger.info(`Using native token address for ETH: ${NATIVE_TOKEN_ADDRESS}`);
    return NATIVE_TOKEN_ADDRESS as `0x${string}`;
  }
  
  // For explicit WETH - use actual WETH contract address
  if (trimmedToken.toLowerCase() === "weth") {
    const wethAddress = WETH_ADDRESSES[network];
    if (wethAddress) {
      logger.info(`Using WETH contract address for ${network}: ${wethAddress}`);
      return wethAddress as `0x${string}`;
    }
    logger.warn(`No WETH address configured for network ${network}`);
  }
  
  // For native MATIC on Polygon - use native token address
  if (trimmedToken.toLowerCase() === "matic" && network === "polygon") {
    logger.info(`Using native token address for MATIC: ${NATIVE_TOKEN_ADDRESS}`);
    return NATIVE_TOKEN_ADDRESS as `0x${string}`;
  }
  
  // For explicit WMATIC on Polygon - use actual WMATIC contract address
  if (trimmedToken.toLowerCase() === "wmatic" && network === "polygon") {
    logger.info(`Using WMATIC contract address for Polygon: ${WMATIC_ADDRESS}`);
    return WMATIC_ADDRESS as `0x${string}`;
  }
  
  // If it looks like an address, validate it with CoinGecko to prevent fake addresses
  if (trimmedToken.startsWith("0x") && trimmedToken.length === 42) {
    logger.debug(`Token ${token} looks like an address, validating with CoinGecko`);
    const metadata = await getTokenMetadata(trimmedToken, network);
    if (metadata?.address) {
      logger.info(`Validated address ${token} exists on CoinGecko: ${metadata.symbol} (${metadata.name})`);
      return metadata.address as `0x${string}`;
    }
    logger.warn(`Address ${token} not found on CoinGecko for network ${network} - may be fake/invalid`);
    return null;
  }
  
  // Try to resolve symbol to address via CoinGecko
  logger.debug(`Resolving token symbol from CoinGecko for ${trimmedToken}`);
  const address = await resolveTokenSymbol(trimmedToken, network);
  if (address) {
    logger.info(`Resolved ${token} to ${address} via CoinGecko`);
    return address as `0x${string}`;
  }
  
  logger.warn(`Could not resolve token ${token} on ${network}`);
  return null;
};

/**
 * Note: CDP swaps require Permit2 token approval before execution.
 * 
 * The CDP service handles this in two steps:
 * 1. Approve the token for Permit2 contract (0x000000000022D473030F116dDEE9F6B43aC78BA3)
 * 2. Execute the swap using account.swap()
 * 
 * Permit2 is a token approval contract that provides a secure way to manage
 * ERC20 token approvals for swaps across different protocols.
 * 
 * Reference: https://docs.cdp.coinbase.com/trade-api/quickstart#3-execute-a-swap
 */

export const cdpWalletSwap: ActionWithParams = {
  name: "USER_WALLET_SWAP",
  similes: [
    "SWAP",
    "TRADE",
    "EXCHANGE",
    "SWAP_TOKENS_CDP",
    "TRADE_TOKENS_CDP",
    "EXCHANGE_TOKENS_CDP",
  ],
  description: "Use this action when you need to swap tokens from user's wallet.",
  
  // Parameter schema for tool calling
  parameters: {
    fromToken: {
      type: "string",
      description: "Source token symbol or address to swap from (e.g., 'USDC', 'ETH', or '0x...')",
      required: true,
    },
    toToken: {
      type: "string",
      description: "Destination token symbol or address to swap to (e.g., 'ETH', 'USDC', or '0x...')",
      required: true,
    },
    amount: {
      type: "string",
      description: "Specific amount to swap (e.g., '100'). Use this OR percentage, not both.",
      required: false,
    },
    percentage: {
      type: "number",
      description: "Percentage of balance to swap (0-100). Use this OR amount, not both. For 'all'/'max' use 100, for 'half' use 50.",
      required: false,
    },
    network: {
      type: "string",
      description: "Network to execute swap on: 'base', 'ethereum', 'arbitrum', 'optimism', or 'polygon' (default: 'base')",
      required: false,
    },
  },
  
  validate: async (_runtime: IAgentRuntime, message: Memory) => {
    try {
      // Check if services are available
      const cdpService = _runtime.getService(
        CdpService.serviceType,
      ) as CdpService;

      if (!cdpService) {
        logger.warn("[USER_WALLET_SWAP] CDP service not available");
        return false;
      }

      return true;
    } catch (error) {
      logger.error(
        "[USER_WALLET_SWAP] Error validating action:",
        error instanceof Error ? error.message : String(error),
      );
      return false;
    }
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback,
  ): Promise<ActionResult> => {
    logger.info("[USER_WALLET_SWAP] Handler invoked");
    
    try {
      logger.debug("[USER_WALLET_SWAP] Retrieving CDP service");
      const cdpService = runtime.getService(CdpService.serviceType) as CdpService;
      
      if (!cdpService) {
        const errorMsg = "CDP Service not initialized";
        logger.error(`[USER_WALLET_SWAP] ${errorMsg}`);
        const errorResult: ActionResult = {
          text: `❌ ${errorMsg}`,
          success: false,
          error: "service_unavailable",
          input: {},
        } as ActionResult & { input: {} };
        callback?.({ 
          text: errorResult.text,
          content: { error: "service_unavailable", details: errorMsg }
        });
        return errorResult;
      }
      logger.debug("[USER_WALLET_SWAP] CDP service retrieved successfully");

      // Ensure the user has a wallet saved
      logger.debug("[USER_WALLET_SWAP] Verifying entity wallet");
      const walletResult = await getEntityWallet(
        runtime,
        message,
        "USER_WALLET_SWAP",
        callback,
      );
      if (walletResult.success === false) {
        logger.warn("[USER_WALLET_SWAP] Entity wallet verification failed");
        return {
          ...walletResult.result,
          input: {},
        } as ActionResult & { input: {} };
      }
      const accountName = walletResult.metadata?.accountName as string;
      if (!accountName) {
        const errorMsg = "Could not find account name for wallet";
        logger.error(`[USER_WALLET_SWAP] ${errorMsg}`);
        const errorResult: ActionResult = {
          text: `❌ ${errorMsg}`,
          success: false,
          error: "missing_account_name",
          input: {},
        } as ActionResult & { input: {} };
        callback?.({ 
          text: errorResult.text,
          content: { error: "missing_account_name", details: errorMsg }
        });
        return errorResult;
      }
      logger.debug("[USER_WALLET_SWAP] Entity wallet verified successfully");

      // Read parameters from state (extracted by multiStepDecisionTemplate)
      const composedState = await runtime.composeState(message, ["ACTION_STATE"], true);
      const params = composedState?.data?.actionParams || {};

      // Validate required parameters
      const fromTokenParam = params?.fromToken?.trim();
      const toTokenParam = params?.toToken?.trim();

      if (!fromTokenParam) {
        const errorMsg = "Missing required parameter 'fromToken'. Please specify which token to swap from (e.g., 'USDC', 'ETH').";
        logger.error(`[USER_WALLET_SWAP] ${errorMsg}`);
        const errorResult: ActionResult = {
          text: `❌ ${errorMsg}`,
          success: false,
          error: "missing_required_parameter",
          input: params,
        } as ActionResult & { input: typeof params };
        callback?.({ 
          text: errorResult.text,
          content: { error: "missing_required_parameter", details: errorMsg }
        });
        return errorResult;
      }

      if (!toTokenParam) {
        const errorMsg = "Missing required parameter 'toToken'. Please specify which token to swap to (e.g., 'ETH', 'USDC').";
        logger.error(`[USER_WALLET_SWAP] ${errorMsg}`);
        const errorResult: ActionResult = {
          text: `❌ ${errorMsg}`,
          success: false,
          error: "missing_required_parameter",
          input: params,
        } as ActionResult & { input: typeof params };
        callback?.({ 
          text: errorResult.text,
          content: { error: "missing_required_parameter", details: errorMsg }
        });
        return errorResult;
      }

      // Validate that we have either amount OR percentage
      const hasAmount = !!params?.amount;
      const hasPercentage = !!params?.percentage;

      if (!hasAmount && !hasPercentage) {
        const errorMsg = "Must specify either 'amount' or 'percentage'. Please specify how much to swap (e.g., '100' or 50%).";
        logger.error(`[USER_WALLET_SWAP] ${errorMsg}`);
        const errorResult: ActionResult = {
          text: `❌ ${errorMsg}`,
          success: false,
          error: "missing_required_parameter",
          input: params,
        } as ActionResult & { input: typeof params };
        callback?.({ 
          text: errorResult.text,
          content: { error: "missing_required_parameter", details: errorMsg }
        });
        return errorResult;
      }

      if (hasAmount && hasPercentage) {
        const errorMsg = "Cannot specify both 'amount' and 'percentage'. Please use only one.";
        logger.error(`[USER_WALLET_SWAP] ${errorMsg}`);
        const errorResult: ActionResult = {
          text: `❌ ${errorMsg}`,
          success: false,
          error: "invalid_parameter",
          input: params,
        } as ActionResult & { input: typeof params };
        callback?.({ 
          text: errorResult.text,
          content: { error: "invalid_parameter", details: errorMsg }
        });
        return errorResult;
      }

      // Parse swap parameters with defaults
      const swapParams: SwapParams = {
        network: (params?.network || "base") as CdpNetwork,
        fromToken: fromTokenParam,
        toToken: toTokenParam,
        slippageBps: 100, // Default 1% slippage
      };

      if (hasAmount) {
        swapParams.amount = params.amount;
      } else {
        swapParams.percentage = parseFloat(params.percentage);
        // Validate percentage is between 0 and 100
        if (swapParams.percentage <= 0 || swapParams.percentage > 100) {
          const errorMsg = `Invalid percentage value: ${swapParams.percentage}. Must be between 0 and 100.`;
          logger.error(`[USER_WALLET_SWAP] ${errorMsg}`);
          const errorResult: ActionResult = {
            text: `❌ ${errorMsg}`,
            success: false,
            error: "invalid_parameter",
            input: params,
          } as ActionResult & { input: typeof params };
          callback?.({ 
            text: errorResult.text,
            content: { error: "invalid_parameter", details: errorMsg }
          });
          return errorResult;
        }
      }

      // Store input parameters for return
      const inputParams = {
        fromToken: swapParams.fromToken,
        toToken: swapParams.toToken,
        amount: swapParams.amount,
        percentage: swapParams.percentage,
        network: swapParams.network,
      };

      logger.info(`[USER_WALLET_SWAP] Swap parameters: ${JSON.stringify(swapParams)}`);

      // Resolve token symbols to addresses using CoinGecko
      logger.debug("[USER_WALLET_SWAP] Resolving token addresses");
      const fromTokenResolved = await resolveTokenToAddress(swapParams.fromToken, swapParams.network);
      const toTokenResolved = await resolveTokenToAddress(swapParams.toToken, swapParams.network);
      
      if (!fromTokenResolved) {
        const errorMsg = `Could not resolve source token: ${swapParams.fromToken}`;
        logger.error(`[USER_WALLET_SWAP] ${errorMsg}`);
        const errorResult: ActionResult = {
          text: `❌ ${errorMsg}`,
          success: false,
          error: "token_resolution_failed",
          input: inputParams,
        } as ActionResult & { input: typeof inputParams };
        callback?.({ 
          text: errorResult.text,
          content: { error: "token_resolution_failed", details: errorMsg }
        });
        return errorResult;
      }
      if (!toTokenResolved) {
        const errorMsg = `Could not resolve destination token: ${swapParams.toToken}`;
        logger.error(`[USER_WALLET_SWAP] ${errorMsg}`);
        const errorResult: ActionResult = {
          text: `❌ ${errorMsg}`,
          success: false,
          error: "token_resolution_failed",
          input: inputParams,
        } as ActionResult & { input: typeof inputParams };
        callback?.({ 
          text: errorResult.text,
          content: { error: "token_resolution_failed", details: errorMsg }
        });
        return errorResult;
      }

      const fromToken = fromTokenResolved;
      const toToken = toTokenResolved;
      logger.debug(`[USER_WALLET_SWAP] Token addresses resolved: ${fromToken} -> ${toToken}`);

      // Get decimals for the source token from CoinGecko
      logger.debug(`[USER_WALLET_SWAP] Fetching decimals for source token: ${fromToken}`);
      const decimals = await getTokenDecimals(fromToken, swapParams.network);
      logger.debug(`[USER_WALLET_SWAP] Token decimals: ${decimals}`);

      // Determine the amount to swap (either specific amount or percentage of balance)
      let amountToSwap: string;
      
      if (swapParams.percentage !== undefined) {
        // Percentage-based swap - fetch wallet info to get token balance
        logger.info(`Percentage-based swap: ${swapParams.percentage}% of ${swapParams.fromToken}`);
        
        const walletInfo = await cdpService.getWalletInfoCached(accountName);
        
        // Find the token in wallet (matching both symbol and address)
        const walletToken = walletInfo.tokens.find((t) => {
          // Check if token matches by address
          if (t.contractAddress && fromToken.startsWith("0x")) {
            return t.contractAddress.toLowerCase() === fromToken.toLowerCase();
          }
          // Check if token matches by symbol
          return t.symbol.toLowerCase() === swapParams.fromToken.toLowerCase() && 
                 t.chain === swapParams.network;
        });

        if (!walletToken) {
          logger.error(`Token ${swapParams.fromToken} not found in wallet on ${swapParams.network}`);
          throw new Error(`You don't have any ${swapParams.fromToken.toUpperCase()} in your wallet on ${swapParams.network}.`);
        }

        const tokenBalance = parseFloat(walletToken.balance);
        if (tokenBalance <= 0) {
          logger.error(`Zero balance for token ${swapParams.fromToken}: ${tokenBalance}`);
          throw new Error(`You have zero balance for ${swapParams.fromToken.toUpperCase()}. Cannot swap.`);
        }

        // Calculate amount based on percentage
        const calculatedAmount = (tokenBalance * swapParams.percentage) / 100;
        amountToSwap = calculatedAmount.toString();
        
        logger.info(`Calculated amount from ${swapParams.percentage}%: ${amountToSwap} ${swapParams.fromToken} (from balance: ${tokenBalance})`);
      } else {
        // Specific amount provided
        amountToSwap = swapParams.amount!;
        logger.info(`Using specific amount: ${amountToSwap} ${swapParams.fromToken}`);
      }

      // Parse amount to wei using correct decimals
      const parseUnits = (value: string, decimals: number): bigint => {
        const [integer, fractional = ""] = value.split(".");
        const paddedFractional = fractional.padEnd(decimals, "0").slice(0, decimals);
        return BigInt(integer + paddedFractional);
      };

      const amountInWei = parseUnits(amountToSwap, decimals);
      logger.debug(`Amount in wei: ${amountInWei.toString()}`);

      logger.info(`[USER_WALLET_SWAP] Executing CDP swap: network=${swapParams.network}, fromToken=${fromToken}, toToken=${toToken}, amount=${amountToSwap}, slippageBps=${swapParams.slippageBps}`);

      // Execute the swap using CDP service
      logger.debug(`[USER_WALLET_SWAP] Calling CDP service swap method`);
      
      const result = await cdpService.swap({
        accountName,
        network: swapParams.network,
        fromToken,
        toToken,
        fromAmount: amountInWei,
        slippageBps: swapParams.slippageBps,
      });
      
      logger.info("[USER_WALLET_SWAP] CDP swap executed successfully");
      logger.debug(`[USER_WALLET_SWAP] Swap result: ${JSON.stringify(result)}`);

      const successText = `✅ Successfully swapped ${amountToSwap} tokens on ${swapParams.network}\n` +
                         `Transaction Hash: ${result.transactionHash}\n` +
                         `From: ${fromToken}\n` +
                         `To: ${toToken}`;

      logger.debug("[USER_WALLET_SWAP] Sending success callback");
      callback?.({
        text: successText,
        content: {
          success: true,
          transactionHash: result.transactionHash,
          network: swapParams.network,
          fromToken: String(fromToken),
          toToken: String(toToken),
          amount: String(amountToSwap),
        },
      });

      logger.debug("[USER_WALLET_SWAP] Returning success result");
      return {
        text: successText,
        success: true,
        data: {
          transactionHash: result.transactionHash,
          network: swapParams.network,
          fromToken: String(fromToken),
          toToken: String(toToken),
          amount: String(amountToSwap),
          slippageBps: swapParams.slippageBps ? Number(swapParams.slippageBps) : 100,
        },
        values: {
          swapSuccess: true,
          transactionHash: result.transactionHash,
        },
        input: inputParams,
      } as ActionResult & { input: typeof inputParams };
    } catch (error) {
      logger.error("[USER_WALLET_SWAP] Action failed:", error instanceof Error ? error.message : String(error));
      logger.error("[USER_WALLET_SWAP] Error stack:", error instanceof Error ? error.stack : "No stack trace available");
      
      let errorMessage = "Failed to execute swap.";
      if (error instanceof Error) {
        logger.debug(`[USER_WALLET_SWAP] Processing error message: ${error.message}`);
        if (error.message.includes("insufficient")) {
          errorMessage = "Insufficient balance for this swap.";
        } else if (error.message.includes("slippage")) {
          errorMessage = "Swap failed due to price movement. Try increasing slippage tolerance.";
        } else if (error.message.includes("not authenticated")) {
          errorMessage = "CDP service is not authenticated. Please check your API credentials.";
        } else {
          errorMessage = `Swap failed: ${error.message}`;
        }
      }
      
      // Try to capture input params even in failure
      const composedState = await runtime.composeState(message, ["ACTION_STATE"], true);
      const params = composedState?.data?.actionParams || {};
      const failureInputParams = {
        fromToken: params?.fromToken,
        toToken: params?.toToken,
        amount: params?.amount,
        percentage: params?.percentage,
        network: params?.network,
      };
      
      logger.debug(`[USER_WALLET_SWAP] Sending error callback: ${errorMessage}`);
      callback?.({
        text: `❌ ${errorMessage}`,
        content: { error: "action_failed", details: errorMessage },
      });
      
      logger.debug("[USER_WALLET_SWAP] Returning error result");
      return {
        text: `❌ ${errorMessage}`,
        success: false,
        error: errorMessage,
        input: failureInputParams,
      } as ActionResult & { input: typeof failureInputParams };
    }
  },
  examples: [
    [
      {
        name: "{{user}}",
        content: { text: "swap 3 USDC to BNKR" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "I'll swap 3 USDC to BNKR on Base for you.",
          action: "USER_WALLET_SWAP",
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: { text: "swap 100 USDC to ETH on base" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "I'll swap 100 USDC to ETH on Base network for you.",
          action: "USER_WALLET_SWAP",
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: { text: "swap half of my USDC to ETH" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "I'll swap 50% of your USDC to ETH on Base.",
          action: "USER_WALLET_SWAP",
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: { text: "swap 80% of my ETH to DAI" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "I'll swap 80% of your ETH to DAI.",
          action: "USER_WALLET_SWAP",
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: { text: "swap all my MATIC for USDC on polygon" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "I'll swap 100% of your MATIC to USDC on Polygon.",
          action: "USER_WALLET_SWAP",
        },
      },
    ],
  ],
};

export default cdpWalletSwap;
