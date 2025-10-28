import {
  type Action,
  type IAgentRuntime,
  type Memory,
  type State,
  type HandlerCallback,
  type ActionResult,
  logger,
} from "@elizaos/core";
import { parseUnits } from "viem";
import { getEntityWallet } from "../../../utils/entity";
import { CdpService } from "../services/cdp.service";
import { type CdpNetwork } from "../types";

import { ActionWithParams } from "../../../types";


interface TransferParams {
  network?: CdpNetwork;
  to: `0x${string}`;
  token: string;
  amount?: string; // Specific amount (mutually exclusive with percentage)
  percentage?: number; // Percentage of balance (mutually exclusive with amount)
}

export const cdpWalletTokenTransfer: ActionWithParams = {
  name: "USER_WALLET_TOKEN_TRANSFER",
  similes: [
    "SEND_TOKEN",
    "TRANSFER_TOKEN",
    "PAY",
    "SEND_TOKENS_CDP",
    "TRANSFER_TOKENS_CDP",
    "PAY_WITH_CDP",
  ],
  description: "Use this action when you need to transfer tokens (ERC20 or native tokens like ETH) from user's wallet. For NFTs, use USER_WALLET_NFT_TRANSFER instead.",
  
  // Parameter schema for tool calling
  parameters: {
    to: {
      type: "string",
      description: "Recipient wallet address (must be a valid 0x address, 42 characters)",
      required: true,
    },
    token: {
      type: "string",
      description: "Token symbol or address to transfer (e.g., 'USDC', 'ETH', 'wlfi', or '0x...')",
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
      description: "Network to execute transfer on: 'base', 'ethereum', 'arbitrum', 'optimism', or 'polygon' (optional, will auto-detect from wallet if not specified)",
      required: false,
    },
  },
  
  validate: async (_runtime: IAgentRuntime, message: Memory) => {
    try {
      // Check if CDP service is available
      const cdpService = _runtime.getService(
        CdpService.serviceType,
      ) as CdpService;

      if (!cdpService) {
        logger.warn("[USER_WALLET_TOKEN_TRANSFER] CDP service not available");
        return false;
      }

      return true;
    } catch (error) {
      logger.error(
        "[USER_WALLET_TOKEN_TRANSFER] Error validating action:",
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
    logger.info("[USER_WALLET_TOKEN_TRANSFER] Handler invoked");
    
    try {
      logger.debug("[USER_WALLET_TOKEN_TRANSFER] Retrieving CDP service");
      const cdpService = runtime.getService(CdpService.serviceType) as CdpService;
      
      if (!cdpService) {
        const errorMsg = "CDP Service not initialized";
        logger.error(`[USER_WALLET_TOKEN_TRANSFER] ${errorMsg}`);
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

      // Validate recipient address format
      if (!toParam.startsWith("0x") || toParam.length !== 42) {
        const errorMsg = `Invalid recipient address: ${toParam}. Address must start with '0x' and be 42 characters long.`;
        logger.error(`[USER_WALLET_TOKEN_TRANSFER] ${errorMsg}`);
        const errorResult: ActionResult = {
          text: `❌ ${errorMsg}`,
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
        const errorMsg = "Must specify either 'amount' or 'percentage'. Please specify how much to transfer (e.g., '10' or 50%).";
        logger.error(`[USER_WALLET_TOKEN_TRANSFER] ${errorMsg}`);
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
        logger.error(`[USER_WALLET_TOKEN_TRANSFER] ${errorMsg}`);
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

      // Parse transfer parameters
      const transferParams: TransferParams = {
        network: params?.network ? (params.network as CdpNetwork) : undefined,
        to: toParam as `0x${string}`,
        token: tokenParam.toLowerCase(),
      };

      if (hasAmount) {
        transferParams.amount = params.amount;
      } else {
        transferParams.percentage = parseFloat(params.percentage);
        // Validate percentage is between 0 and 100
        if (transferParams.percentage <= 0 || transferParams.percentage > 100) {
          const errorMsg = `Invalid percentage value: ${transferParams.percentage}. Must be between 0 and 100.`;
          logger.error(`[USER_WALLET_TOKEN_TRANSFER] ${errorMsg}`);
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
        to: transferParams.to,
        token: transferParams.token,
        amount: transferParams.amount,
        percentage: transferParams.percentage,
        network: transferParams.network,
      };

      logger.info(`[USER_WALLET_TOKEN_TRANSFER] Transfer parameters: ${JSON.stringify(transferParams)}`);

      logger.info(`[USER_WALLET_TOKEN_TRANSFER] Looking up token in wallet: ${transferParams.token}`);

      // Get user's wallet info to find the token (use cached data if available)
      const walletInfo = await cdpService.getWalletInfoCached(accountName);
      
      let tokenAddress: string;
      let decimals: number = 18;
      let resolvedNetwork: CdpNetwork;
      let walletToken: typeof walletInfo.tokens[0] | undefined;

      // Check if it's already an address
      if (transferParams.token.startsWith("0x") && transferParams.token.length === 42) {
        tokenAddress = transferParams.token;
        // Try to find decimals and network from wallet tokens
        walletToken = walletInfo.tokens.find(
          t => t.contractAddress?.toLowerCase() === transferParams.token.toLowerCase() &&
               (!transferParams.network || t.chain === transferParams.network)
        );
        if (walletToken) {
          decimals = walletToken.decimals;
          resolvedNetwork = walletToken.chain as CdpNetwork;
        } else if (transferParams.network) {
          resolvedNetwork = transferParams.network;
        } else {
          throw new Error(`Token ${transferParams.token} not found in your wallet. Please specify the network.`);
        }
      } else if (transferParams.token === "eth") {
        // Native tokens - default to base if no network specified
        tokenAddress = "eth";
        decimals = 18;
        resolvedNetwork = transferParams.network || "base";
        // Find the actual wallet token for percentage calculation
        walletToken = walletInfo.tokens.find(
          t => !t.contractAddress && t.chain === resolvedNetwork
        );
      } else if (transferParams.token === "matic") {
        // Native tokens
        tokenAddress = "eth";
        decimals = 18;
        resolvedNetwork = transferParams.network || "polygon";
        // Find the actual wallet token for percentage calculation
        walletToken = walletInfo.tokens.find(
          t => !t.contractAddress && t.chain === resolvedNetwork
        );
      } else {
        // Look for token in user's wallet by symbol
        walletToken = transferParams.network
          ? // If network specified, find token on that specific network
            walletInfo.tokens.find(
              t => t.symbol.toLowerCase() === transferParams.token.toLowerCase() && 
                   t.chain === transferParams.network
            )
          : // If no network specified, find token on any network (prefer highest balance)
            walletInfo.tokens
              .filter(t => t.symbol.toLowerCase() === transferParams.token.toLowerCase())
              .sort((a, b) => parseFloat(b.balance) - parseFloat(a.balance))[0];

        if (!walletToken) {
          const networkMsg = transferParams.network ? ` on ${transferParams.network}` : '';
          throw new Error(`Token ${transferParams.token.toUpperCase()} not found in your wallet${networkMsg}. You don't have this token to send.`);
        }

        resolvedNetwork = walletToken.chain as CdpNetwork;

        // Native token (no contract address)
        if (!walletToken.contractAddress) {
          tokenAddress = "eth";
        } else {
          tokenAddress = walletToken.contractAddress;
        }
        decimals = walletToken.decimals;

        logger.info(`[USER_WALLET_TOKEN_TRANSFER] Found ${transferParams.token} in wallet: ${tokenAddress} on ${resolvedNetwork} with ${decimals} decimals (balance: ${walletToken.balanceFormatted})`);
      }
      
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
      if (transferParams.percentage !== undefined) {
        // Calculate amount from percentage
        if (!walletToken) {
          throw new Error(`Cannot calculate percentage: token ${transferParams.token} not found in wallet`);
        }
        
        const balanceRaw = parseUnits(walletToken.balanceFormatted, decimals);
        const percentageAmount = (balanceRaw * BigInt(Math.floor(transferParams.percentage * 100))) / BigInt(10000);
        
        logger.info(`[USER_WALLET_TOKEN_TRANSFER] Calculated ${transferParams.percentage}% of ${walletToken.balanceFormatted} = ${percentageAmount.toString()} raw units`);
        
        if (percentageAmount === 0n) {
          throw new Error(`Insufficient balance: ${transferParams.percentage}% of your ${transferParams.token.toUpperCase()} is 0`);
        }
        
        // Convert back to formatted string for display
        const formattedAmount = Number(percentageAmount) / Math.pow(10, decimals);
        amountToTransfer = formattedAmount.toString();
      } else {
        amountToTransfer = transferParams.amount!;
      }
      
      // Parse amount to proper units
      const amount = parseUnits(amountToTransfer, decimals);

      const displayAmount = transferParams.percentage !== undefined
        ? `${transferParams.percentage}% (${amountToTransfer} ${transferParams.token.toUpperCase()})`
        : `${amountToTransfer} ${transferParams.token.toUpperCase()}`;

      logger.info(`[USER_WALLET_TOKEN_TRANSFER] Executing transfer: ${displayAmount} (${token}) to ${transferParams.to} on ${resolvedNetwork}`);

      callback?.({ text: `🔄 Sending ${displayAmount} to ${transferParams.to}...` });

      // Execute transfer via service method
      const result = await cdpService.transfer({
        accountName,
        network: resolvedNetwork,
        to: transferParams.to,
        token,
        amount,
      });

      const successText = `✅ Transfer successful!\n\n` +
                         `💸 Sent: ${displayAmount}\n` +
                         `📍 To: ${transferParams.to}\n` +
                         `🔗 Network: ${resolvedNetwork}\n` +
                         `📋 TX: ${result.transactionHash}`;

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
      
      const errorText = `❌ ${errorMessage}`;
      
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
          text: "🔄 Sending 10 USDC to 0x1234567890123456789012345678901234567890...",
          action: "USER_WALLET_TOKEN_TRANSFER",
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: { text: "send 2 wlfi to 0xabcd1234abcd1234abcd1234abcd1234abcd1234" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "🔄 Sending 2 WLFI to 0xabcd1234abcd1234abcd1234abcd1234abcd1234...",
          action: "USER_WALLET_TOKEN_TRANSFER",
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: { text: "transfer 0.5 ETH to 0xabcd...1234" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "🔄 Sending 0.5 ETH to the specified address...",
          action: "USER_WALLET_TOKEN_TRANSFER",
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: { text: "send half of my USDC to 0x1234567890123456789012345678901234567890" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "🔄 Sending 50% of your USDC...",
          action: "USER_WALLET_TOKEN_TRANSFER",
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: { text: "send all my ETH to 0xabcd1234abcd1234abcd1234abcd1234abcd1234" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "🔄 Sending 100% of your ETH...",
          action: "USER_WALLET_TOKEN_TRANSFER",
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: { text: "transfer 80% of my WLFI to 0x9876...5432" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "🔄 Sending 80% of your WLFI...",
          action: "USER_WALLET_TOKEN_TRANSFER",
        },
      },
    ],
  ],
};

export default cdpWalletTokenTransfer;


