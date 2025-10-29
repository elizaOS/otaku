import {
  Action,
  IAgentRuntime,
  Memory,
  State,
  HandlerCallback,
  ActionExample,
} from "@elizaos/core";
import { EtherscanService } from "../services/etherscan.service";

export const checkTransactionConfirmationAction: Action = {
  name: "CHECK_TRANSACTION_CONFIRMATION",
  similes: [
    "CHECK_TX_CONFIRMATION",
    "VERIFY_TRANSACTION",
    "CHECK_TX_STATUS",
    "TRANSACTION_STATUS",
    "CONFIRM_TRANSACTION",
    "TX_CONFIRMATION",
    "CHECK_TRANSACTION",
  ],
  description:
    "Check the confirmation status of an Ethereum transaction including number of confirmations, success/failure status, gas used, and other transaction details. Automatically extracts transaction hash from the message.",
  
  // Parameter schema for tool calling
  parameters: {
    transactionHash: {
      type: "string",
      description: "Ethereum transaction hash starting with 0x followed by 64 hexadecimal characters (e.g., 0x1234567890abcdef...). This will be automatically extracted from the user's message.",
      required: true,
    },
    chain: {
      type: "string",
      description: "Blockchain network to check (ethereum, polygon, arbitrum, optimism, base, bsc, avalanche, fantom). Defaults to ethereum if not specified.",
      required: false,
    },
  },

  validate: async (runtime: IAgentRuntime, _message: Memory) => {
    const apiKey = runtime.getSetting("ETHERSCAN_API_KEY");
    return typeof apiKey === "string" && apiKey.indexOf("YourApiKeyToken") !== 0;
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback
  ): Promise<void> => {
    try {
      // Extract transaction hash from message
      const messageText = (message.content as { text?: string })?.text || "";
      
      // Look for Ethereum transaction hash (0x followed by 64 hex characters)
      const txHashMatch = messageText.match(/0x[a-fA-F0-9]{64}/);
      
      if (!txHashMatch) {
        if (callback) {
          callback({
            text: "Please provide a valid Ethereum transaction hash (0x followed by 64 hex characters).\n\nExample: `0x1234567890abcdef...`",
            content: {
              success: false,
              error: "No valid transaction hash found in message",
            },
          });
        }
        return;
      }

      const txHash = txHashMatch[0];

      // Extract optional chain parameter from message
      // Look for common chain names in the message
      const chainKeywords = [
        "ethereum", "eth", "mainnet",
        "polygon", "matic",
        "arbitrum", "arb",
        "optimism", "op",
        "base",
        "bsc", "binance",
        "avalanche", "avax",
        "fantom", "ftm"
      ];
      
      let chain: string | undefined;
      const lowerMessage = messageText.toLowerCase();
      for (const keyword of chainKeywords) {
        if (lowerMessage.includes(keyword)) {
          chain = keyword;
          break;
        }
      }

      // Get Etherscan service
      const etherscanService = runtime.getService(
        EtherscanService.serviceType
      ) as EtherscanService;

      if (!etherscanService) {
        throw new Error("Etherscan service not found");
      }

      // Get transaction receipt with confirmations
      const receipt = await etherscanService.getTransactionReceipt(txHash, chain);

      // Format the response
      const statusText = receipt.success ? "SUCCESS" : "FAILED";
      
      const blockNumberDec = parseInt(receipt.blockNumber, 16);
      const gasUsedDec = parseInt(receipt.gasUsed, 16);
      const gasUsedGwei = (gasUsedDec / 1e9).toFixed(4);

      let responseText = `**Transaction ${statusText}**\n\n`;
      if (chain) {
        responseText += `**Chain:** ${chain.charAt(0).toUpperCase() + chain.slice(1)}\n`;
      }
      responseText += `**Transaction Hash:** \`${receipt.transactionHash}\`\n`;
      responseText += `**Status:** ${statusText}\n`;
      responseText += `**Confirmations:** ${receipt.confirmations} blocks\n`;
      responseText += `**Block Number:** ${blockNumberDec} (\`${receipt.blockNumber}\`)\n`;
      responseText += `**From:** \`${receipt.from}\`\n`;
      responseText += `**To:** \`${receipt.to}\`\n`;
      
      if (receipt.contractAddress) {
        responseText += `**Contract Created:** \`${receipt.contractAddress}\`\n`;
      }
      
      responseText += `**Gas Used:** ${gasUsedDec.toLocaleString()} (${gasUsedGwei} Gwei)\n`;
      
      // Add confirmation status interpretation
      if (receipt.confirmations >= 12) {
        responseText += `\n**Highly Confirmed** - Transaction is considered final (${receipt.confirmations} confirmations)`;
      } else if (receipt.confirmations >= 6) {
        responseText += `\n**Well Confirmed** - Transaction is secure (${receipt.confirmations} confirmations)`;
      } else if (receipt.confirmations >= 1) {
        responseText += `\n**Recently Confirmed** - Wait for more confirmations (${receipt.confirmations} so far)`;
      }

      if (callback) {
        callback({
          text: responseText,
          content: {
            success: true,
            data: {
              chain: chain || "ethereum",
              transactionHash: receipt.transactionHash,
              status: statusText,
              confirmations: receipt.confirmations,
              blockNumber: blockNumberDec,
              from: receipt.from,
              to: receipt.to,
              contractAddress: receipt.contractAddress,
              gasUsed: gasUsedDec,
              effectiveGasPrice: receipt.effectiveGasPrice,
              isSuccess: receipt.success,
            },
          },
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      if (callback) {
        callback({
          text: `Failed to check transaction confirmation: ${errorMessage}`,
          content: {
            success: false,
            error: errorMessage,
          },
        });
      }
    }
  },
  examples: [
    [
      {
        name: "user",
        user: "{{user1}}",
        content: {
          text: "Check confirmation status for transaction 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
        },
      } as ActionExample,
      {
        name: "agent",
        user: "{{agent}}",
        content: {
          text: "I'll check the confirmation status of that transaction for you.",
          action: "CHECK_TRANSACTION_CONFIRMATION",
        },
      } as ActionExample,
    ],
    [
      {
        name: "user",
        user: "{{user1}}",
        content: {
          text: "Has my transaction 0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890 been confirmed?",
        },
      } as ActionExample,
      {
        name: "agent",
        user: "{{agent}}",
        content: {
          text: "Let me check the confirmation status of your transaction.",
          action: "CHECK_TRANSACTION_CONFIRMATION",
        },
      } as ActionExample,
    ],
    [
      {
        name: "user",
        user: "{{user1}}",
        content: {
          text: "Verify tx 0x9876543210fedcba9876543210fedcba9876543210fedcba9876543210fedcba",
        },
      } as ActionExample,
      {
        name: "agent",
        user: "{{agent}}",
        content: {
          text: "I'll verify the transaction status for you.",
          action: "CHECK_TRANSACTION_CONFIRMATION",
        },
      } as ActionExample,
    ],
  ] as ActionExample[][],
};

