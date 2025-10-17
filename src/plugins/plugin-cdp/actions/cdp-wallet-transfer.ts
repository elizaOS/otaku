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
import { parseUnits } from "viem";
import { getEntityWallet } from "../../../utils/entity";
import { CdpService } from "../services/cdp.service";
import { type CdpNetwork } from "../types";

const transferTemplate = `# Token Transfer Request

## Conversation Context
{{recentMessages}}

## Supported Networks
- base (default - use if not specified)
- ethereum
- arbitrum
- optimism
- polygon

## Instructions
Extract the transfer details EXACTLY as the user stated them. Do not modify or normalize token names.

**Rules:**
1. **To Address**: Must be a valid 0x address (42 characters)
2. **Token**: Extract token symbol EXACTLY as user typed it (e.g., if user says "USDC", output "USDC"; if user says "wlfi", output "wlfi")
3. **Network**: Omit the <network> tag if user doesn't mention a specific network
4. **Amount vs Percentage**:
   - Specific amount (e.g., "send 10 USDC") → use <amount>10</amount>
   - Percentage (e.g., "send half my tokens", "send all my USDC") → use <percentage> tag
   - For "all"/"max"/"everything" → <percentage>100</percentage>
   - For "half" → <percentage>50</percentage>
   - Use ONLY ONE: <amount> OR <percentage>, never both

Respond with the transfer parameters in this exact format:

Example 1 (specific amount):
<response>
  <to>0x1234567890123456789012345678901234567890</to>
  <token>USDC</token>
  <amount>10.5</amount>
</response>

Example 2 (percentage with network):
<response>
  <network>base</network>
  <to>0x1234567890123456789012345678901234567890</to>
  <token>wlfi</token>
  <percentage>50</percentage>
</response>

Example 3 (user input: "send 5 eth to 0xabc..."):
<response>
  <to>0xabc123...</to>
  <token>eth</token>
  <amount>5</amount>
</response>`;

interface TransferParams {
  network?: CdpNetwork;
  to: `0x${string}`;
  token: string;
  amount?: string; // Specific amount (mutually exclusive with percentage)
  percentage?: number; // Percentage of balance (mutually exclusive with amount)
}

const parseTransferParams = (text: string): TransferParams | null => {
  const parsed = parseKeyValueXml(text);
  
  if (!parsed?.to || !parsed?.token) {
    logger.warn(`Missing required transfer parameters: ${JSON.stringify({ parsed })}`);
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

  // Validate recipient address
  const to = parsed.to.trim();
  if (!to.startsWith("0x") || to.length !== 42) {
    logger.warn(`Invalid recipient address: ${to}`);
    return null;
  }

  const transferParams: TransferParams = {
    network: parsed.network ? (parsed.network as CdpNetwork) : undefined,
    to: to as `0x${string}`,
    token: parsed.token.toLowerCase(),
  };

  if (hasAmount) {
    transferParams.amount = parsed.amount;
  } else {
    transferParams.percentage = parseFloat(parsed.percentage);
    // Validate percentage is between 0 and 100
    if (transferParams.percentage <= 0 || transferParams.percentage > 100) {
      logger.warn(`Invalid percentage value: ${transferParams.percentage}`);
      return null;
    }
  }

  return transferParams;
};

// use strict resolver from utils

export const cdpWalletTransfer: Action = {
  name: "WALLET_TRANSFER",
  similes: [
    "SEND",
    "TRANSFER",
    "PAY",
    "SEND_TOKENS_CDP",
    "TRANSFER_TOKENS_CDP",
    "PAY_WITH_CDP",
  ],
  description: "Use this action when you need to transfer tokens.",
  validate: async (_runtime: IAgentRuntime, message: Memory) => {
    try {
      // Check if CDP service is available
      const cdpService = _runtime.getService(
        CdpService.serviceType,
      ) as CdpService;

      if (!cdpService) {
        logger.warn("CDP service not available for transfer");
        return false;
      }

      return true;
    } catch (error) {
      logger.error(
        "Error validating transfer action:",
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
    try {
      const cdpService = runtime.getService(CdpService.serviceType) as CdpService;
      
      if (!cdpService) {
        throw new Error("CDP Service not initialized");
      }

      // Ensure the user has a wallet saved
      const walletResult = await getEntityWallet(
        runtime,
        message,
        "WALLET_TRANSFER",
        callback,
      );
      if (walletResult.success === false) {
        return walletResult.result;
      }

      const accountName = walletResult.metadata?.accountName as string;
      if (!accountName) {
        throw new Error("Could not find account name for wallet");
      }

      // Compose state and get transfer parameters from LLM
      const composedState = await runtime.composeState(message, ["RECENT_MESSAGES"], true);
      const context = composePromptFromState({
        state: composedState,
        template: transferTemplate,
      });

      const xmlResponse = await runtime.useModel(ModelType.TEXT_LARGE, {
        prompt: context,
      });

      const transferParams = parseTransferParams(xmlResponse);
      
      if (!transferParams) {
        throw new Error("Failed to parse transfer parameters from request");
      }

      logger.info(`[WALLET_TRANSFER] Looking up token in wallet: ${transferParams.token}`);

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

        logger.info(`[WALLET_TRANSFER] Found ${transferParams.token} in wallet: ${tokenAddress} on ${resolvedNetwork} with ${decimals} decimals (balance: ${walletToken.balanceFormatted})`);
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
        
        logger.info(`[WALLET_TRANSFER] Calculated ${transferParams.percentage}% of ${walletToken.balanceFormatted} = ${percentageAmount.toString()} raw units`);
        
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

      logger.info(`[WALLET_TRANSFER] Executing transfer: ${displayAmount} (${token}) to ${transferParams.to} on ${resolvedNetwork}`);

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
      };
    } catch (error) {
      logger.error("[WALLET_TRANSFER] Error:", error instanceof Error ? error.message : String(error));
      
      let errorMessage = "❌ Transfer failed";
      if (error instanceof Error) {
        if (error.message.includes("insufficient")) {
          errorMessage = "❌ Insufficient balance for this transfer";
        } else if (error.message.includes("invalid address")) {
          errorMessage = "❌ Invalid recipient address";
        } else if (error.message.includes("not found in your wallet")) {
          errorMessage = `❌ ${error.message}`;
        } else {
          errorMessage = `❌ Transfer failed: ${error.message}`;
        }
      }
      
      callback?.({
        text: errorMessage,
        content: { error: errorMessage },
      });
      
      return {
        text: errorMessage,
        success: false,
        error: error as Error,
      };
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
          action: "WALLET_TRANSFER",
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
          action: "WALLET_TRANSFER",
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
          action: "WALLET_TRANSFER",
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
          action: "WALLET_TRANSFER",
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
          action: "WALLET_TRANSFER",
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
          action: "WALLET_TRANSFER",
        },
      },
    ],
  ],
};

export default cdpWalletTransfer;

