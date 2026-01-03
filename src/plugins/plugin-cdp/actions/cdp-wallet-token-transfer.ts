import {
  type Action,
  type IAgentRuntime,
  type Memory,
  type State,
  type HandlerCallback,
  type ActionResult,
  logger,
} from "@elizaos/core";
import { parseUnits, formatUnits } from "viem";
import { getEntityWallet } from "../../../utils/entity";
import { CdpService } from "../services/cdp.service";
import { validateCdpService } from "../utils/actionHelpers";
import { type CdpNetwork } from "../types";

// WETH contract address on Polygon (bridged from Ethereum via PoS Bridge)
const WETH_POLYGON_ADDRESS = "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619";

const SUPPORTED_NETWORKS: readonly CdpNetwork[] = [
  "base",
  "ethereum",
  "arbitrum",
  "optimism",
  "polygon",
];

interface TransferParams {
  network: CdpNetwork;
  to: `0x${string}`;
  token: string;
  amount?: string; // Specific amount (mutually exclusive with percentage)
  percentage?: number; // Percentage of balance (mutually exclusive with amount)
}

const tokenSymbolMatches = (symbol: string | null | undefined, requested: string): boolean => {
  if (!symbol) {
    return false;
  }

  const walletSymbol = symbol.toLowerCase();
  const requestedSymbol = requested.toLowerCase();

  if (requestedSymbol === "matic" || requestedSymbol === "pol") {
    return walletSymbol === "matic" || walletSymbol === "pol";
  }

  return walletSymbol === requestedSymbol;
};

export const cdpWalletTokenTransfer: Action = {
  name: "USER_WALLET_TOKEN_TRANSFER",
  similes: [
    "SEND_TOKEN",
    "TRANSFER_TOKEN",
    "PAY",
    "SEND_TOKENS_CDP",
    "TRANSFER_TOKENS_CDP",
    "PAY_WITH_CDP",
  ],
  description: "Use this action when you need to transfer tokens (ERC20 or native tokens like ETH) from user's wallet. For NFTs, use USER_WALLET_NFT_TRANSFER instead. Native gas tokens: ETH on Base/Ethereum/Arbitrum/Optimism, POL on Polygon. POL is never the native gas token on Base/Ethereum (POL ERC20 exists on Ethereum but is not a native gas token). Treat 'ETH' on Polygon as 'WETH'. IMPORTANT: Before executing, you MUST present a clear summary (recipient, amount, token, network, USD value) and get explicit user confirmation ('yes', 'confirm', 'go ahead'). Never execute transfers without confirmed intent - they are irreversible.",
  
  // Parameter schema for tool calling
  parameters: {
    to: {
      type: "string",
      description: "Recipient wallet address (must be a valid 0x address, 42 characters)",
      required: true,
    },
    token: {
      type: "string",
      description: "Token symbol or address to transfer (e.g., 'USDC', 'ETH', 'wlfi', or '0x...'). On Polygon, the native gas token is POL ($POL, formerly MATIC). If 'ETH' is specified for Polygon, interpret it as 'WETH'.",
      required: true,
    },
    amount: {
      type: "string",
      description: "Specific token amount to transfer (e.g., '10.5' means 10.5 ETH tokens, NOT USD value). If user specifies USD value like '$5 worth of ETH', you must first get the current price and calculate the equivalent token amount. Use this OR percentage, not both.",
      required: false,
    },
    percentage: {
      type: "number",
      description: "Percentage of balance to transfer (0-100). Use this OR amount, not both. For 'all'/'max' use 100, for 'half' use 50.",
      required: false,
    },
    network: {
      type: "string",
      description: "Network to execute transfer on: 'base', 'ethereum', 'arbitrum', 'optimism', or 'polygon'",
      required: true,
    },
  },
  
  validate: async (_runtime: IAgentRuntime, message: Memory, state?: State) => {
    return validateCdpService(_runtime, "USER_WALLET_TOKEN_TRANSFER", state, message);
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback,
  ): Promise<ActionResult> => {
    logger.info("[USER_WALLET_TOKEN_TRANSFER] Handler invoked");
    
    try {
      logger.debug("[USER_WALLET_TOKEN_TRANSFER] Retrieving CDP service");
      const cdpService = runtime.getService(CdpService.serviceType) as CdpService;
      
      if (!cdpService) {
        const errorMsg = "CDP Service not initialized";
        logger.error(`[USER_WALLET_TOKEN_TRANSFER] ${errorMsg}`);
        const errorResult: ActionResult = {
          text: ` ${errorMsg}`,
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

      // Ensure the user has a wallet saved
      logger.debug("[USER_WALLET_TOKEN_TRANSFER] Verifying entity wallet");
      const walletResult = await getEntityWallet(
        runtime,
        message,
        "USER_WALLET_TOKEN_TRANSFER",
        callback,
      );
      if (walletResult.success === false) {
        logger.warn("[USER_WALLET_TOKEN_TRANSFER] Entity wallet verification failed");
        return {
          ...walletResult.result,
          input: {},
        } as ActionResult & { input: {} };
      }

      const accountName = walletResult.metadata?.accountName as string;
      if (!accountName) {
        const errorMsg = "Could not find account name for wallet";
        logger.error(`[USER_WALLET_TOKEN_TRANSFER] ${errorMsg}`);
        const errorResult: ActionResult = {
          text: ` ${errorMsg}`,
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
      logger.debug("[USER_WALLET_TOKEN_TRANSFER] Entity wallet verified successfully");

      // Read parameters from state (extracted by multiStepDecisionTemplate)
      const composedState = await runtime.composeState(message, ["ACTION_STATE"], true);
      const params = composedState?.data?.actionParams || {};

      // Validate required parameters
      const toParam = params?.to?.trim();
      const tokenParam = params?.token?.trim();

      if (!toParam) {
        const errorMsg = "Missing required parameter 'to'. Please specify the recipient wallet address (0x...).";
        logger.error(`[USER_WALLET_TOKEN_TRANSFER] ${errorMsg}`);
        const errorResult: ActionResult = {
          text: ` ${errorMsg}`,
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

      // Validate recipient address format
      if (!toParam.startsWith("0x") || toParam.length !== 42) {
        const errorMsg = `Invalid recipient address: ${toParam}. Address must start with '0x' and be 42 characters long.`;
        logger.error(`[USER_WALLET_TOKEN_TRANSFER] ${errorMsg}`);
        const errorResult: ActionResult = {
          text: ` ${errorMsg}`,
          success: false,
          error: "invalid_address",
          input: params,
        } as ActionResult & { input: typeof params };
        callback?.({ 
          text: errorResult.text,
          content: { error: "invalid_address", details: errorMsg }
        });
        return errorResult;
      }

      if (!tokenParam) {
        const errorMsg = "Missing required parameter 'token'. Please specify which token to transfer (e.g., 'USDC', 'ETH').";
        logger.error(`[USER_WALLET_TOKEN_TRANSFER] ${errorMsg}`);
        const errorResult: ActionResult = {
          text: ` ${errorMsg}`,
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
        const errorMsg = "Must specify either 'amount' or 'percentage'. Please specify how much to transfer (e.g., '10' or 50%).";
        logger.error(`[USER_WALLET_TOKEN_TRANSFER] ${errorMsg}`);
        const errorResult: ActionResult = {
          text: ` ${errorMsg}`,
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
        logger.error(`[USER_WALLET_TOKEN_TRANSFER] ${errorMsg}`);
        const errorResult: ActionResult = {
          text: ` ${errorMsg}`,
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

      const networkRaw =
        typeof params?.network === "string"
          ? params.network.trim().toLowerCase()
          : "";

      if (!networkRaw) {
        const errorMsg =
          "Missing required parameter 'network'. Please specify the network (base, ethereum, arbitrum, optimism, or polygon).";
        logger.error(`[USER_WALLET_TOKEN_TRANSFER] ${errorMsg}`);
        const errorResult: ActionResult = {
          text: ` ${errorMsg}`,
          success: false,
          error: "missing_required_parameter",
          input: params,
        } as ActionResult & { input: typeof params };
        callback?.({
          text: errorResult.text,
          content: {
            error: "missing_required_parameter",
            details: errorMsg,
          },
        });
        return errorResult;
      }

      if (!SUPPORTED_NETWORKS.includes(networkRaw as CdpNetwork)) {
        const errorMsg = `Unsupported network '${params.network}'. Supported networks: ${SUPPORTED_NETWORKS.join(", ")}.`;
        logger.error(`[USER_WALLET_TOKEN_TRANSFER] ${errorMsg}`);
        const errorResult: ActionResult = {
          text: ` ${errorMsg}`,
          success: false,
          error: "invalid_parameter",
          input: params,
        } as ActionResult & { input: typeof params };
        callback?.({
          text: errorResult.text,
          content: { error: "invalid_parameter", details: errorMsg },
        });
        return errorResult;
      }

      const networkParam = networkRaw as CdpNetwork;
      const originalTokenInput = tokenParam;

      // Parse transfer parameters
      const transferParams: TransferParams = {
        network: networkParam,
        to: toParam as `0x${string}`,
        token: originalTokenInput.toLowerCase(),
      };

      if (hasAmount) {
        transferParams.amount = params.amount;
      } else {
        const parsedPercentage = Number(params.percentage);
        if (Number.isNaN(parsedPercentage)) {
          const errorMsg = `Invalid percentage value: ${params.percentage}. Must be between 0 and 100.`;
          logger.error(`[USER_WALLET_TOKEN_TRANSFER] ${errorMsg}`);
          const errorResult: ActionResult = {
            text: ` ${errorMsg}`,
            success: false,
            error: "invalid_parameter",
            input: params,
          } as ActionResult & { input: typeof params };
          callback?.({
            text: errorResult.text,
            content: { error: "invalid_parameter", details: errorMsg },
          });
          return errorResult;
        }

        if (parsedPercentage <= 0 || parsedPercentage > 100) {
          const errorMsg = `Invalid percentage value: ${parsedPercentage}. Must be between 0 and 100.`;
          logger.error(`[USER_WALLET_TOKEN_TRANSFER] ${errorMsg}`);
          const errorResult: ActionResult = {
            text: ` ${errorMsg}`,
            success: false,
            error: "invalid_parameter",
            input: params,
          } as ActionResult & { input: typeof params };
          callback?.({
            text: errorResult.text,
            content: { error: "invalid_parameter", details: errorMsg },
          });
          return errorResult;
        }

        transferParams.percentage = parsedPercentage;
      }

      // Store input parameters for return
      const inputParams = {
        to: transferParams.to,
        token: params.token,
        amount: transferParams.amount,
        percentage: transferParams.percentage,
        network: transferParams.network,
      };

      logger.info(
        `[USER_WALLET_TOKEN_TRANSFER] Transfer parameters: ${JSON.stringify(transferParams)}`,
      );

      logger.info(
        `[USER_WALLET_TOKEN_TRANSFER] Looking up token in wallet: ${transferParams.token} on ${transferParams.network}`,
      );

      // SECURITY: For percentage-based transfers, force a fresh balance fetch to prevent
      // TOCTOU (Time-of-Check to Time-of-Use) race conditions where cached balance data
      // could lead to transferring more than available.
      // For fixed-amount transfers, cached data is acceptable since the on-chain transfer
      // will fail if balance is insufficient.
      const isPercentageTransfer = transferParams.percentage !== undefined;
      
      // Get user's wallet info to find the token
      // Pass wallet address to avoid CDP account lookup (prevents "account not initialized" errors)
      const walletInfo = isPercentageTransfer
        ? await cdpService.fetchWalletInfo(accountName, transferParams.network, walletResult.walletAddress) // Fresh fetch for percentage transfers
        : await cdpService.getWalletInfoCached(accountName, undefined, walletResult.walletAddress); // Cached is OK for fixed amounts
        
      if (isPercentageTransfer) {
        logger.info(
          `[USER_WALLET_TOKEN_TRANSFER] Used fresh balance fetch for ${transferParams.percentage}% transfer`,
        );
      }

      const resolvedNetwork = transferParams.network;
      let tokenAddress: string;
      let decimals = 18;
      let walletToken: (typeof walletInfo.tokens)[number] | undefined;

      if (transferParams.token.startsWith("0x") && transferParams.token.length === 42) {
        const foundToken = walletInfo.tokens.find(
          (t) =>
            t.chain === resolvedNetwork &&
            t.contractAddress?.toLowerCase() === transferParams.token,
        );

        if (!foundToken) {
          throw new Error(
            `Token ${originalTokenInput} not found in your wallet on ${resolvedNetwork}.`,
          );
        }

        walletToken = foundToken;
        tokenAddress = foundToken.contractAddress!;
        decimals = foundToken.decimals;
      } else if (transferParams.token === "eth") {
        if (resolvedNetwork === "polygon") {
          tokenAddress = WETH_POLYGON_ADDRESS;
          const foundToken = walletInfo.tokens.find(
            (t) =>
              t.chain === resolvedNetwork &&
              t.contractAddress?.toLowerCase() === tokenAddress.toLowerCase(),
          );

          if (!foundToken) {
            throw new Error(
              `Token ${originalTokenInput.toUpperCase()} not found in your wallet on ${resolvedNetwork}.`,
            );
          }

          walletToken = foundToken;
        } else {
          tokenAddress = "eth";
          const foundToken = walletInfo.tokens.find(
            (t) => t.chain === resolvedNetwork && !t.contractAddress,
          );

          if (!foundToken) {
            throw new Error(
              `Token ${originalTokenInput.toUpperCase()} not found in your wallet on ${resolvedNetwork}.`,
            );
          }

          walletToken = foundToken;
        }

        decimals = walletToken.decimals ?? 18;
      } else {
        const foundToken = walletInfo.tokens.find(
          (t) =>
            t.chain === resolvedNetwork &&
            tokenSymbolMatches(t.symbol, transferParams.token),
        );

        if (!foundToken) {
          if (
            (transferParams.token === "pol" || transferParams.token === "matic") &&
            resolvedNetwork !== "polygon"
          ) {
            throw new Error(
              `Token ${originalTokenInput.toUpperCase()} is only available on Polygon. Please set the network to 'polygon'.`,
            );
          }

          throw new Error(
            `Token ${originalTokenInput.toUpperCase()} not found in your wallet on ${resolvedNetwork}.`,
          );
        }

        walletToken = foundToken;
        tokenAddress = foundToken.contractAddress ?? "eth";
        decimals = foundToken.decimals;
      }

      const resolvedWalletToken = walletToken;
      if (!resolvedWalletToken) {
        throw new Error(
          `Token ${originalTokenInput.toUpperCase()} could not be resolved on ${resolvedNetwork}.`,
        );
      }

      logger.info(
        `[USER_WALLET_TOKEN_TRANSFER] Found ${transferParams.token} in wallet on ${resolvedNetwork}: ${tokenAddress} with ${decimals} decimals (balance: ${resolvedWalletToken.balanceFormatted})`,
      );
      
      // Determine token type for CDP API
      let token: `0x${string}` | "eth";
      const lowerToken = tokenAddress.toLowerCase();
      
      if (lowerToken === "eth") {
        token = lowerToken;
      } else if (lowerToken.startsWith("0x") && lowerToken.length === 42) {
        token = lowerToken as `0x${string}`;
      } else {
        throw new Error(`Invalid token format: ${tokenAddress}`);
      }
      
      // Calculate amount based on percentage or use provided amount
      let amountToTransfer: string;
      let valueUsd = 0;
      let amount: bigint; // Raw amount in token units
      
      if (transferParams.percentage !== undefined) {
        // SECURITY: High-precision percentage calculation to prevent precision loss
        // 
        // Use 6 decimal places for percentage (supports 0.000001% precision)
        // This allows accurate calculations for percentages like 33.333333%
        //
        // Formula: amount = balance * (percentage * PRECISION_FACTOR) / (100 * PRECISION_FACTOR)
        // Using PRECISION_FACTOR = 1,000,000 for 6 decimal places
        const PERCENTAGE_PRECISION = 1000000n; // 6 decimal places
        const HUNDRED_SCALED = 100n * PERCENTAGE_PRECISION; // 100 * 1,000,000 = 100,000,000
        
        // Parse balance to raw units (BigInt)
        const balanceRaw = parseUnits(resolvedWalletToken.balanceFormatted, decimals);
        
        // Scale percentage to avoid floating-point precision loss
        // e.g., 33.333333% becomes 33333333n (33.333333 * 1,000,000)
        const percentageScaled = BigInt(Math.round(transferParams.percentage * Number(PERCENTAGE_PRECISION)));
        
        // Calculate amount: balance * scaled_percentage / (100 * precision)
        // This keeps all arithmetic in BigInt to avoid precision loss
        const percentageAmount = (balanceRaw * percentageScaled) / HUNDRED_SCALED;

        logger.info(
          `[USER_WALLET_TOKEN_TRANSFER] High-precision calculation: ${transferParams.percentage}% of ${resolvedWalletToken.balanceFormatted} ` +
          `= ${percentageAmount.toString()} raw units (scaled percentage: ${percentageScaled.toString()})`,
        );

        if (percentageAmount === 0n) {
          throw new Error(`Insufficient balance: ${transferParams.percentage}% of your ${transferParams.token.toUpperCase()} is 0`);
        }
        
        // Use formatUnits from viem to convert BigInt to string without precision loss
        amountToTransfer = formatUnits(percentageAmount, decimals);
        amount = percentageAmount;
        
        // Calculate USD value from already-available wallet token data (no extra fetch)
        if (resolvedWalletToken.usdValue && parseFloat(resolvedWalletToken.balanceFormatted) > 0) {
          const tokenBalance = parseFloat(resolvedWalletToken.balanceFormatted);
          const amountNum = parseFloat(amountToTransfer);
          valueUsd = (amountNum / tokenBalance) * resolvedWalletToken.usdValue;
        }
      } else {
        amountToTransfer = transferParams.amount!;
        // Parse amount to proper units
        amount = parseUnits(amountToTransfer, decimals);
        
        // Calculate USD value from already-available wallet token data (no extra fetch)
        if (resolvedWalletToken.usdValue && parseFloat(resolvedWalletToken.balanceFormatted) > 0) {
          const tokenBalance = parseFloat(resolvedWalletToken.balanceFormatted);
          const amountNum = parseFloat(amountToTransfer);
          valueUsd = (amountNum / tokenBalance) * resolvedWalletToken.usdValue;
        }
      }

      const displayToken = transferParams.token.startsWith("0x")
        ? originalTokenInput
        : transferParams.token.toUpperCase();

      const displayAmount = transferParams.percentage !== undefined
        ? `${transferParams.percentage}% (${amountToTransfer} ${displayToken})`
        : `${amountToTransfer} ${displayToken}`;

      logger.info(`[USER_WALLET_TOKEN_TRANSFER] Executing transfer: ${displayAmount} (${token}) to ${transferParams.to} on ${resolvedNetwork}`);

      callback?.({ text: ` Sending ${displayAmount} to ${transferParams.to}...` });

      // Execute transfer via service method
      const result = await cdpService.transfer({
        accountName,
        network: resolvedNetwork,
        to: transferParams.to,
        token,
        amount,
      });

      const successText = ` Transfer successful!\n\n` +
                         ` Sent: ${displayAmount}\n` +
                         ` To: ${transferParams.to}\n` +
                         ` Network: ${resolvedNetwork}\n` +
                         ` TX: ${result.transactionHash}`;

      callback?.({
        text: successText,
        content: {
          success: true,
          transactionHash: result.transactionHash,
        },
      });

      return {
        text: successText,
        success: true,
        data: {
          transactionHash: result.transactionHash,
          network: resolvedNetwork,
          to: transferParams.to,
          token: transferParams.token,
          amount: amountToTransfer,
          percentage: transferParams.percentage,
        },
        values: {
          valueUsd: valueUsd > 0 ? valueUsd : undefined,
        },
        input: inputParams,
      } as ActionResult & { input: typeof inputParams };
    } catch (error) {
      logger.error("[USER_WALLET_TOKEN_TRANSFER] Action failed:", error instanceof Error ? error.message : String(error));
      
      let errorMessage = "Transfer failed";
      let errorCode = "action_failed";
      
      if (error instanceof Error) {
        if (error.message.includes("insufficient")) {
          errorMessage = "Insufficient balance for this transfer";
          errorCode = "insufficient_balance";
        } else if (error.message.includes("invalid address")) {
          errorMessage = "Invalid recipient address";
          errorCode = "invalid_address";
        } else if (error.message.includes("not found in your wallet")) {
          errorMessage = error.message;
          errorCode = "token_not_found";
        } else {
          errorMessage = `Transfer failed: ${error.message}`;
        }
      }
      
      const errorText = ` ${errorMessage}`;
      
      // Try to capture input params even in failure
      const composedState = await runtime.composeState(message, ["ACTION_STATE"], true);
      const params = composedState?.data?.actionParams || {};
      const failureInputParams = {
        to: params?.to,
        token: params?.token,
        amount: params?.amount,
        percentage: params?.percentage,
        network: params?.network,
      };
      
      callback?.({
        text: errorText,
        content: { error: errorCode, details: errorMessage },
      });
      
      return {
        text: errorText,
        success: false,
        error: errorCode,
        input: failureInputParams,
      } as ActionResult & { input: typeof failureInputParams };
    }
  },
  examples: [
    [
      {
        name: "{{user}}",
        content: { text: "send 10 USDC to 0x1234567890123456789012345678901234567890 on base" },
      },
      {
        name: "{{agent}}",
        content: {
          text: " Sending 10 USDC to 0x1234567890123456789012345678901234567890...",
          action: "USER_WALLET_TOKEN_TRANSFER",
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: { text: "send 2 wlfi to 0xabcd1234abcd1234abcd1234abcd1234abcd1234 on base" },
      },
      {
        name: "{{agent}}",
        content: {
          text: " Sending 2 WLFI to 0xabcd1234abcd1234abcd1234abcd1234abcd1234...",
          action: "USER_WALLET_TOKEN_TRANSFER",
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: { text: "transfer 0.5 ETH to 0xabcd...1234 on ethereum" },
      },
      {
        name: "{{agent}}",
        content: {
          text: " Sending 0.5 ETH to the specified address...",
          action: "USER_WALLET_TOKEN_TRANSFER",
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: { text: "send half of my USDC to 0x1234567890123456789012345678901234567890 on base" },
      },
      {
        name: "{{agent}}",
        content: {
          text: " Sending 50% of your USDC...",
          action: "USER_WALLET_TOKEN_TRANSFER",
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: { text: "send all my ETH to 0xabcd1234abcd1234abcd1234abcd1234abcd1234 on base" },
      },
      {
        name: "{{agent}}",
        content: {
          text: " Sending 100% of your ETH...",
          action: "USER_WALLET_TOKEN_TRANSFER",
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: { text: "transfer 80% of my WLFI to 0x9876...5432 on base" },
      },
      {
        name: "{{agent}}",
        content: {
          text: " Sending 80% of your WLFI...",
          action: "USER_WALLET_TOKEN_TRANSFER",
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: { text: "send 25 USDC to 0xfedcba9876543210fedcba9876543210fedcba98 on base" },
      },
      {
        name: "{{agent}}",
        content: {
          text: " Checking your USDC balance on base...",
          action: "CHECK_TOKEN_BALANCE",
          token: "USDC",
          chain: "base",
          minAmount: "25",
        },
      },
      {
        name: "{{agent}}",
        content: {
          text: " Sending 25 USDC to 0xfedcba9876543210fedcba9876543210fedcba98...",
          action: "USER_WALLET_TOKEN_TRANSFER",
        },
      },
    ],
  ],
};

export default cdpWalletTokenTransfer;


