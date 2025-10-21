import {
  type Action,
  type IAgentRuntime,
  type Memory,
  type State,
  type HandlerCallback,
  type ActionResult,
  logger,
  ModelType,
  composePromptFromState,
  parseKeyValueXml,
} from "@elizaos/core";
import { getEntityWallet } from "../../../utils/entity";
import { CdpService } from "../services/cdp.service";
import { getTokenMetadata, getTokenDecimals, resolveTokenSymbol } from "../utils/coingecko";
import { type CdpNetwork } from "../types";

const swapTemplate = `# CDP Token Swap Request

## Conversation Context
{{recentMessages}}

## Available Networks
- base (default - use if not specified)
- ethereum
- arbitrum
- optimism
- polygon

## Instructions
Extract the swap details EXACTLY as the user stated them. Do not modify, normalize, or convert token names.

**Rules:**
1. **Network**: Use "base" if user doesn't mention a network
2. **Tokens**: Extract token symbols or addresses EXACTLY as user typed them (e.g., if user says "MATIC", output "MATIC"; if user says "lgns", output "lgns")
3. **Amount vs Percentage**:
   - Specific amount (e.g., "swap 2 MATIC") → use <amount>2</amount>
   - Percentage (e.g., "swap half my MATIC", "swap all my tokens", "swap 80%") → use <percentage> tag
   - For "all"/"max"/"everything" → <percentage>100</percentage>
   - For "half" → <percentage>50</percentage>
   - Use ONLY ONE: <amount> OR <percentage>, never both
4. **Slippage**: Always use <slippageBps>100</slippageBps> (1% slippage)

Respond with the swap parameters in this exact format:

Example 1 (specific amount):
<response>
  <network>base</network>
  <fromToken>USDC</fromToken>
  <toToken>ETH</toToken>
  <amount>100</amount>
  <slippageBps>100</slippageBps>
</response>

Example 2 (percentage):
<response>
  <network>polygon</network>
  <fromToken>MATIC</fromToken>
  <toToken>lgns</toToken>
  <percentage>50</percentage>
  <slippageBps>100</slippageBps>
</response>

Example 3 (user input: "swap 2 matic to lgns"):
<response>
  <network>base</network>
  <fromToken>matic</fromToken>
  <toToken>lgns</toToken>
  <amount>2</amount>
  <slippageBps>100</slippageBps>
</response>`;

interface SwapParams {
  network: CdpNetwork;
  fromToken: string; // Can be symbol or address, gets resolved later
  toToken: string; // Can be symbol or address, gets resolved later
  amount?: string; // Specific amount (mutually exclusive with percentage)
  percentage?: number; // Percentage of balance (mutually exclusive with amount)
  slippageBps?: number;
}

const parseSwapParams = (text: string): SwapParams | null => {
  console.log("Parsing swap parameters from XML response");
  const parsed = parseKeyValueXml(text);
  console.log(`Parsed XML data: ${JSON.stringify(parsed)}`);
  
  // Network defaults to "base" if not provided
  if (!parsed?.fromToken || !parsed?.toToken) {
    logger.warn(`Missing required swap parameters: ${JSON.stringify({ parsed })}`);
    return null;
  }

  // Must have either amount OR percentage, but not both
  const hasAmount = !!parsed.amount;
  const hasPercentage = !!parsed.percentage;

  if (!hasAmount && !hasPercentage) {
    logger.warn(`Must specify either amount or percentage: ${JSON.stringify({ parsed })}`);
    return null;
  }

  if (hasAmount && hasPercentage) {
    logger.warn(`Cannot specify both amount and percentage: ${JSON.stringify({ parsed })}`);
    return null;
  }

  const swapParams: SwapParams = {
    network: (parsed.network || "base") as SwapParams["network"],
    fromToken: parsed.fromToken.trim(),
    toToken: parsed.toToken.trim(),
    slippageBps: parsed.slippageBps ? parseInt(parsed.slippageBps) : 100,
  };

  if (hasAmount) {
    swapParams.amount = parsed.amount;
  } else {
    swapParams.percentage = parseFloat(parsed.percentage);
    // Validate percentage is between 0 and 100
    if (swapParams.percentage <= 0 || swapParams.percentage > 100) {
      logger.warn(`Invalid percentage value: ${swapParams.percentage}`);
      return null;
    }
  }
  
  logger.debug(`Formatted swap parameters: ${JSON.stringify(swapParams)}`);
  return swapParams;
};

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

export const cdpWalletSwap: Action = {
  name: "USER_WALLET_SWAP",
  similes: [
    "SWAP",
    "TRADE",
    "EXCHANGE",
    "SWAP_TOKENS_CDP",
    "TRADE_TOKENS_CDP",
    "EXCHANGE_TOKENS_CDP",
  ],
  description: "Use this action when you need to swap tokens.",
  validate: async (_runtime: IAgentRuntime, message: Memory) => {
    try {
      // Check if services are available
      const cdpService = _runtime.getService(
        CdpService.serviceType,
      ) as CdpService;

      if (!cdpService) {
        logger.warn("Required services not available for token deployment");
        return false;
      }

      return true;
    } catch (error) {
      logger.error(
        "Error validating token deployment action:",
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
    logger.info("USER_WALLET_SWAP handler invoked");
    logger.debug(`Message content: ${JSON.stringify(message.content)}`);
    
    try {
      logger.debug("Retrieving CDP service");
      const cdpService = runtime.getService(CdpService.serviceType) as CdpService;
      
      if (!cdpService) {
        logger.error("CDP Service not initialized");
        throw new Error("CDP Service not initialized");
      }
      logger.debug("CDP service retrieved successfully");

      // Ensure the user has a wallet saved
      logger.debug("Verifying entity wallet for:", message.entityId);
      const walletResult = await getEntityWallet(
        runtime,
        message,
        "USER_WALLET_SWAP",
        callback,
      );
      if (walletResult.success === false) {
        logger.warn("Entity wallet verification failed");
        return walletResult.result;
      }
      const accountName = walletResult.metadata?.accountName as string;
      if (!accountName) {
        throw new Error("Could not find account name for wallet");
      }
      logger.debug("Entity wallet verified successfully");

      // Compose state and get swap parameters from LLM
      logger.debug("Composing state for LLM prompt");
      const composedState = await runtime.composeState(message, ["RECENT_MESSAGES"], true);
      const context = composePromptFromState({
        state: composedState,
        template: swapTemplate,
      });
      logger.debug("Composed prompt context");

      logger.debug("Calling LLM to extract swap parameters");
      const xmlResponse = await runtime.useModel(ModelType.TEXT_LARGE, {
        prompt: context,
      });
      logger.debug("LLM response received:", xmlResponse);

      const swapParams = parseSwapParams(xmlResponse);
      
      if (!swapParams) {
        logger.error("Failed to parse swap parameters from LLM response");
        throw new Error("Failed to parse swap parameters from request");
      }
      logger.info(`Swap parameters parsed successfully: ${JSON.stringify(swapParams)}`);

      // Resolve token symbols to addresses using CoinGecko
      logger.debug("Resolving token addresses");
      const fromTokenResolved = await resolveTokenToAddress(swapParams.fromToken, swapParams.network);
      const toTokenResolved = await resolveTokenToAddress(swapParams.toToken, swapParams.network);
      
      if (!fromTokenResolved) {
        logger.error(`Could not resolve source token: ${swapParams.fromToken}`);
        throw new Error(`Could not resolve source token: ${swapParams.fromToken}`);
      }
      if (!toTokenResolved) {
        logger.error(`Could not resolve destination token: ${swapParams.toToken}`);
        throw new Error(`Could not resolve destination token: ${swapParams.toToken}`);
      }

      const fromToken = fromTokenResolved;
      const toToken = toTokenResolved;
      logger.debug(`Token addresses resolved: ${JSON.stringify({ fromToken, toToken })}`);

      // Get decimals for the source token from CoinGecko
      logger.debug(`Fetching decimals for source token: ${fromToken}`);
      const decimals = await getTokenDecimals(fromToken, swapParams.network);
      logger.debug(`Token decimals: ${decimals}`);

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

      logger.info(`Executing CDP swap: network=${swapParams.network}, fromToken=${fromToken}, toToken=${toToken}, amount=${amountToSwap}, slippageBps=${swapParams.slippageBps}`);

      // Execute the swap using CDP service
      logger.debug(`Calling CDP service swap method`);
      
      const result = await cdpService.swap({
        accountName,
        network: swapParams.network,
        fromToken,
        toToken,
        fromAmount: amountInWei,
        slippageBps: swapParams.slippageBps,
      });
      
      logger.info("CDP swap executed successfully");
      logger.debug(`Swap result: ${JSON.stringify(result)}`);

      const successText = `✅ Successfully swapped ${amountToSwap} tokens on ${swapParams.network}\n` +
                         `Transaction Hash: ${result.transactionHash}\n` +
                         `From: ${fromToken}\n` +
                         `To: ${toToken}`;

      logger.debug("Sending success callback");
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

      logger.debug("Returning success result");
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
      };
    } catch (error) {
      logger.error("USER_WALLET_SWAP error:", error instanceof Error ? error.message : String(error));
      logger.error("Error stack:", error instanceof Error ? error.stack : "No stack trace available");
      
      let errorMessage = "Failed to execute swap.";
      if (error instanceof Error) {
        logger.debug(`Processing error message: ${error.message}`);
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
      
      logger.debug(`Sending error callback: ${errorMessage}`);
      callback?.({
        text: errorMessage,
        content: { error: "user_wallet_swap_failed" },
      });
      
      logger.debug("Returning error result");
      return {
        text: errorMessage,
        success: false,
      };
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
