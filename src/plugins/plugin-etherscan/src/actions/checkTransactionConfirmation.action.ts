import {
  Action,
  ActionResult,
  HandlerCallback,
  IAgentRuntime,
  logger,
  Memory,
  State
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
  suppressInitialMessage: true,
  description:
    "Check the confirmation status of an EVM chain transaction including number of confirmations, success/failure status, gas used, and other transaction details. Automatically extracts transaction hash from the message.",
  
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

  validate: async (runtime: IAgentRuntime, _message: Memory, _state?: State) => {
    try {
      const etherscanService = runtime.getService(EtherscanService.serviceType) as EtherscanService | undefined;
      if (!etherscanService) {
        logger.warn("[CHECK_TRANSACTION_CONFIRMATION] EtherscanService not available");
        return false;
      }
      const apiKey = runtime.getSetting("ETHERSCAN_API_KEY");
      return typeof apiKey === "string" && apiKey.indexOf("YourApiKeyToken") !== 0;
    } catch (err) {
      logger.warn("[CHECK_TRANSACTION_CONFIRMATION] Validation failed:", (err as Error).message);
      return false;
    }
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State,
    _options?: { [key: string]: unknown },
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    try {
      // Read parameters from state (extracted by multiStepDecisionTemplate)
      const composedState = await runtime.composeState(message, ["ACTION_STATE"], true);
      const params = composedState?.data?.actionParams || composedState?.data?.checkTransactionConfirmation || {};

      // Extract transaction hash from parameters or message text
      let txHash: string | undefined = params?.transactionHash?.trim();
      let chain: string | undefined = params?.chain?.trim();

      // Fallback: Extract from message text if not in parameters
      const messageText = (message.content as { text?: string })?.text || "";
      
      if (!txHash) {
        // Look for Ethereum transaction hash (0x followed by 64 hex characters)
        const txHashMatch = messageText.match(/0x[a-fA-F0-9]{64}/);
        if (txHashMatch) {
          txHash = txHashMatch[0];
        }
      }
      
      if (!txHash) {
        const errorMsg = "Please provide a valid Ethereum transaction hash (0x followed by 64 hex characters).\n\nExample: `0x1234567890abcdef...`";
        logger.error(`[CHECK_TRANSACTION_CONFIRMATION] ${errorMsg}`);
        
        const errorResult: ActionResult = {
          text: errorMsg,
          success: false,
          error: "missing_transaction_hash",
          input: { transactionHash: undefined, chain: undefined },
        } as ActionResult & { input: { transactionHash: undefined; chain: undefined } };
        
        if (callback) {
          await callback({
            text: errorResult.text,
            content: { 
              error: "missing_transaction_hash", 
              details: errorMsg 
            },
          });
        }
        return errorResult;
      }

      // Extract chain if not provided
      if (!chain) {
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
        
        const lowerMessage = messageText.toLowerCase();
        for (const keyword of chainKeywords) {
          if (lowerMessage.includes(keyword)) {
            chain = keyword;
            break;
          }
        }
      }

      logger.info(`[CHECK_TRANSACTION_CONFIRMATION] Checking transaction ${txHash} on ${chain || 'ethereum'}`);

      // Store input parameters for return
      const inputParams = { transactionHash: txHash, chain: chain || "ethereum" };

      // Get Etherscan service
      const etherscanService = runtime.getService(
        EtherscanService.serviceType
      ) as EtherscanService;

      if (!etherscanService) {
        throw new Error("Etherscan service not found. Please ensure the Etherscan plugin is properly initialized.");
      }

      // Get transaction receipt with confirmations
      const receipt = await etherscanService.getTransactionReceipt(txHash, chain);

      // Format the response
      const statusText = receipt.success ? "✅ SUCCESS" : "❌ FAILED";
      const chainName = chain ? chain.charAt(0).toUpperCase() + chain.slice(1) : "Ethereum";
      
      const blockNumberDec = parseInt(receipt.blockNumber, 16);
      const gasUsedDec = parseInt(receipt.gasUsed, 16);
      const gasUsedGwei = (gasUsedDec / 1e9).toFixed(4);

      let responseText = `Transaction ${statusText}\n\n`;
      responseText += `**Chain:** ${chainName}\n`;
      responseText += `**Hash:** \`${receipt.transactionHash}\`\n`;
      responseText += `**Confirmations:** ${receipt.confirmations} blocks\n`;
      responseText += `**Block:** ${blockNumberDec}\n`;
      responseText += `**From:** \`${receipt.from}\`\n`;
      responseText += `**To:** \`${receipt.to || 'Contract Creation'}\`\n`;
      
      if (receipt.contractAddress) {
        responseText += `**Contract Created:** \`${receipt.contractAddress}\`\n`;
      }
      
      responseText += `**Gas Used:** ${gasUsedDec.toLocaleString()} (${gasUsedGwei} Gwei)\n`;
      
      // Add confirmation status interpretation
      if (receipt.confirmations >= 12) {
        responseText += `\n🔒 **Highly Confirmed** - Transaction is considered final`;
      } else if (receipt.confirmations >= 6) {
        responseText += `\n✓ **Well Confirmed** - Transaction is secure`;
      } else if (receipt.confirmations >= 1) {
        responseText += `\n⏳ **Recently Confirmed** - Wait for more confirmations`;
      }

      const responseData = {
        chain: chainName,
        transactionHash: receipt.transactionHash,
        status: statusText,
        confirmations: receipt.confirmations,
        blockNumber: blockNumberDec,
        blockHash: receipt.blockHash,
        from: receipt.from,
        to: receipt.to,
        contractAddress: receipt.contractAddress,
        gasUsed: gasUsedDec,
        effectiveGasPrice: receipt.effectiveGasPrice,
        isSuccess: receipt.success,
      };

      const result: ActionResult = {
        text: responseText,
        success: true,
        data: responseData,
        values: responseData,
        input: inputParams,
      } as ActionResult & { input: typeof inputParams };

      if (callback) {
        await callback({
          text: result.text,
          actions: ["CHECK_TRANSACTION_CONFIRMATION"],
          data: result.data,
          source: message.content.source,
        });
      }

      return result;

    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`[CHECK_TRANSACTION_CONFIRMATION] Action failed: ${msg}`);
      
      // Try to capture input params even in failure
      const composedState = await runtime.composeState(message, ["ACTION_STATE"], true);
      const params = composedState?.data?.actionParams || composedState?.data?.checkTransactionConfirmation || {};
      const failureInputParams = {
        transactionHash: params?.transactionHash,
        chain: params?.chain,
      };
      
      const errorResult: ActionResult = {
        text: `Failed to check transaction confirmation: ${msg}`,
        success: false,
        error: msg,
        input: failureInputParams,
      } as ActionResult & { input: typeof failureInputParams };
      
      if (callback) {
        await callback({
          text: errorResult.text,
          content: { 
            error: "action_failed", 
            details: msg 
          },
        });
      }
      return errorResult;
    }
  },
  examples: [
    [
      {
        name: "{{user}}",
        content: {
          text: "Check confirmation status for transaction 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
        },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Checking transaction confirmation status:",
          action: "CHECK_TRANSACTION_CONFIRMATION",
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: {
          text: "Has my transaction 0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890 been confirmed?",
        },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Verifying transaction confirmations:",
          action: "CHECK_TRANSACTION_CONFIRMATION",
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: {
          text: "Verify tx 0x9876543210fedcba9876543210fedcba9876543210fedcba9876543210fedcba on polygon",
        },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Checking Polygon transaction:",
          action: "CHECK_TRANSACTION_CONFIRMATION",
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: {
          text: "check 0xcdaaa18476d16d96fa34c9e64e115a8226b45297a20b0bfe225ec4b18c99dbcf",
        },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Looking up transaction details:",
          action: "CHECK_TRANSACTION_CONFIRMATION",
          actionParams: {
            transactionHash: "0xcdaaa18476d16d96fa34c9e64e115a8226b45297a20b0bfe225ec4b18c99dbcf",
            chain: "ethereum"
          }
        },
      },
    ],
  ],
} as Action;

