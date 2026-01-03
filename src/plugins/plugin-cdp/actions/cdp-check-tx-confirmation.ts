import {
  type Action,
  type IAgentRuntime,
  type Memory,
  type State,
  type HandlerCallback,
  type ActionResult,
  logger
} from "@elizaos/core";
import { createPublicClient, http } from "viem";
import type { PublicClient } from "viem";
import { getChainConfig, getViemChain, getRpcUrl } from "../../../constants/chains";
import { validateCdpPluginContext } from "../utils/actionHelpers";

export const cdpCheckTxConfirmation: Action = {
  name: "CHECK_TX_CONFIRMATION",
  similes: [
    "TX_CONFIRMATION",
    "TRANSACTION_CONFIRMATION",
    "CHECK_TRANSACTION",
    "TX_STATUS",
    "TRANSACTION_STATUS",
    "BLOCK_CONFIRMATION",
    "VERIFY_TRANSACTION",
  ],
  description:
    "Checks the block confirmation status of a transaction using viem. Returns transaction receipt details including block number, confirmation status (success/reverted), gas used, and number of confirmations. Use this to verify if a transaction has been confirmed on-chain and whether it succeeded or failed.",
  
  parameters: {
    hash: {
      type: "string",
      description: "Transaction hash (0x-prefixed hex string, 66 characters total)",
      required: true,
    },
    network: {
      type: "string",
      description: "Blockchain network: 'base', 'ethereum', 'polygon', 'arbitrum', 'optimism', 'scroll', 'base-sepolia', or 'ethereum-sepolia'",
      required: true,
    },
  },
  
  validate: async (_runtime: IAgentRuntime, message: Memory, state?: State) => {
    return validateCdpPluginContext("CHECK_TX_CONFIRMATION", state, message);
  },
  
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback,
  ): Promise<ActionResult> => {
    try {
      logger.info("[CHECK_TX_CONFIRMATION] Checking transaction confirmation");
      
      // Read parameters from state (extracted by multiStepDecisionTemplate)
      const composedState = await runtime.composeState(message, ["ACTION_STATE"], true);
      const params = composedState?.data?.actionParams || {};
      
      // Extract and validate parameters
      const txHash = params?.hash?.trim();
      const network = params?.network?.trim()?.toLowerCase();
      
      // Store input parameters for return
      const inputParams = {
        hash: txHash || undefined,
        network: network || undefined,
      };
      
      // Validate required parameters
      if (!txHash) {
        const errorMsg = "Missing required parameter 'hash'. Please provide a transaction hash.";
        logger.error(`[CHECK_TX_CONFIRMATION] ${errorMsg}`);
        const errorResult: ActionResult = {
          text: ` ${errorMsg}`,
          success: false,
          error: "missing_required_parameter",
          input: inputParams,
        } as ActionResult & { input: typeof inputParams };
        callback?.({ 
          text: errorResult.text,
          content: { error: "missing_required_parameter", details: errorMsg }
        });
        return errorResult;
      }
      
      if (!network) {
        const errorMsg = "Missing required parameter 'network'. Please specify the blockchain network (e.g., 'base', 'ethereum', 'polygon').";
        logger.error(`[CHECK_TX_CONFIRMATION] ${errorMsg}`);
        const errorResult: ActionResult = {
          text: ` ${errorMsg}`,
          success: false,
          error: "missing_required_parameter",
          input: inputParams,
        } as ActionResult & { input: typeof inputParams };
        callback?.({ 
          text: errorResult.text,
          content: { error: "missing_required_parameter", details: errorMsg }
        });
        return errorResult;
      }
      
      // Validate txhash format (should be 0x followed by 64 hex characters = 66 total)
      if (!/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
        const errorMsg = `Invalid transaction hash format: ${txHash}. Expected 0x-prefixed hex string with 64 characters (66 total).`;
        logger.error(`[CHECK_TX_CONFIRMATION] ${errorMsg}`);
        const errorResult: ActionResult = {
          text: ` ${errorMsg}`,
          success: false,
          error: "invalid_txhash_format",
          input: inputParams,
        } as ActionResult & { input: typeof inputParams };
        callback?.({ 
          text: errorResult.text,
          content: { error: "invalid_txhash_format", details: errorMsg }
        });
        return errorResult;
      }
      
      // Validate network is supported
      const supportedNetworks = [
        'base', 'ethereum', 'polygon', 'arbitrum', 'optimism', 'scroll',
        'base-sepolia', 'ethereum-sepolia'
      ];
      
      if (!supportedNetworks.includes(network)) {
        const errorMsg = `Unsupported network: ${network}. Supported networks: ${supportedNetworks.join(', ')}`;
        logger.error(`[CHECK_TX_CONFIRMATION] ${errorMsg}`);
        const errorResult: ActionResult = {
          text: ` ${errorMsg}`,
          success: false,
          error: "unsupported_network",
          input: inputParams,
        } as ActionResult & { input: typeof inputParams };
        callback?.({ 
          text: errorResult.text,
          content: { error: "unsupported_network", details: errorMsg }
        });
        return errorResult;
      }
      
      // Get chain configuration
      const chainConfig = getChainConfig(network);
      if (!chainConfig) {
        const errorMsg = `Could not get chain configuration for network: ${network}`;
        logger.error(`[CHECK_TX_CONFIRMATION] ${errorMsg}`);
        const errorResult: ActionResult = {
          text: ` ${errorMsg}`,
          success: false,
          error: "chain_config_failed",
          input: inputParams,
        } as ActionResult & { input: typeof inputParams };
        callback?.({ 
          text: errorResult.text,
          content: { error: "chain_config_failed", details: errorMsg }
        });
        return errorResult;
      }
      
      // Get RPC URL
      const alchemyKey = process.env.ALCHEMY_API_KEY;
      if (!alchemyKey) {
        const errorMsg = "ALCHEMY_API_KEY not configured. Cannot check transaction confirmation.";
        logger.error(`[CHECK_TX_CONFIRMATION] ${errorMsg}`);
        const errorResult: ActionResult = {
          text: ` ${errorMsg}`,
          success: false,
          error: "missing_api_key",
          input: inputParams,
        } as ActionResult & { input: typeof inputParams };
        callback?.({ 
          text: errorResult.text,
          content: { error: "missing_api_key", details: errorMsg }
        });
        return errorResult;
      }
      
      const rpcUrl = getRpcUrl(network, alchemyKey);
      if (!rpcUrl) {
        const errorMsg = `Could not get RPC URL for network: ${network}`;
        logger.error(`[CHECK_TX_CONFIRMATION] ${errorMsg}`);
        const errorResult: ActionResult = {
          text: ` ${errorMsg}`,
          success: false,
          error: "rpc_url_failed",
          input: inputParams,
        } as ActionResult & { input: typeof inputParams };
        callback?.({ 
          text: errorResult.text,
          content: { error: "rpc_url_failed", details: errorMsg }
        });
        return errorResult;
      }
      
      // Get viem chain object
      const chain = getViemChain(network);
      if (!chain) {
        const errorMsg = `Could not get viem chain for network: ${network}`;
        logger.error(`[CHECK_TX_CONFIRMATION] ${errorMsg}`);
        const errorResult: ActionResult = {
          text: ` ${errorMsg}`,
          success: false,
          error: "chain_failed",
          input: inputParams,
        } as ActionResult & { input: typeof inputParams };
        callback?.({ 
          text: errorResult.text,
          content: { error: "chain_failed", details: errorMsg }
        });
        return errorResult;
      }
      
      // Create public client
      logger.debug(`[CHECK_TX_CONFIRMATION] Creating public client for ${network} with RPC: ${rpcUrl}`);
      const publicClient = createPublicClient({
        chain,
        transport: http(rpcUrl),
      }) as PublicClient;
      
      // Check transaction receipt
      logger.info(`[CHECK_TX_CONFIRMATION] Fetching transaction receipt for ${txHash} on ${network}`);
      callback?.({ text: ` Checking transaction confirmation on ${network}...` });
      
      try {
        const receipt = await publicClient.getTransactionReceipt({
          hash: txHash as `0x${string}`,
        });
        
        // Get current block number to calculate confirmations
        const currentBlock = await publicClient.getBlockNumber();
        const confirmations = Number(currentBlock - receipt.blockNumber);
        
        // Get transaction details for gas price
        let gasPrice: bigint | null = null;
        try {
          const tx = await publicClient.getTransaction({
            hash: txHash as `0x${string}`,
          });
          gasPrice = tx.gasPrice || null;
        } catch (error) {
          logger.debug(`[CHECK_TX_CONFIRMATION] Could not fetch transaction for gas price: ${error}`);
        }
        
        // Format response
        const status = receipt.status === 'success' ? 'Success' : 'Reverted';
        const statusEmoji = receipt.status === 'success' ? '✅' : '❌';
        
        const networkName = network.charAt(0).toUpperCase() + network.slice(1).replace('-', ' ');
        const text = ` **Transaction Confirmation Status**\n\n` +
                     `${statusEmoji} **Status:** ${status}\n` +
                     `**Network:** ${networkName}\n` +
                     `**Transaction Hash:** \`${txHash}\`\n` +
                     `**Block Number:** ${receipt.blockNumber.toString()}\n` +
                     `**Confirmations:** ${confirmations}\n` +
                     `**Gas Used:** ${receipt.gasUsed.toString()}\n` +
                     `**Gas Price:** ${gasPrice ? gasPrice.toString() : 'N/A'}\n`;
        
        const data = {
          hash: txHash,
          network,
          status: receipt.status,
          blockNumber: receipt.blockNumber.toString(),
          confirmations,
          gasUsed: receipt.gasUsed.toString(),
          gasPrice: gasPrice ? gasPrice.toString() : null,
          receipt,
        };
        
        callback?.({ 
          text, 
          content: data
        });
        
        return { 
          text, 
          success: true, 
          data,
          values: {
            confirmed: true,
            status: receipt.status,
            blockNumber: receipt.blockNumber.toString(),
            confirmations,
            success: receipt.status === 'success',
          },
          input: inputParams,
        } as ActionResult & { input: typeof inputParams };
      } catch (error) {
        // Transaction might not be mined yet or doesn't exist
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.warn(`[CHECK_TX_CONFIRMATION] Transaction not found or not mined: ${errorMessage}`);
        
        // Try to get transaction (might be pending)
        try {
          const tx = await publicClient.getTransaction({
            hash: txHash as `0x${string}`,
          });
          
          const text = ` **Transaction Status: Pending**\n\n` +
                       `**Network:** ${network.charAt(0).toUpperCase() + network.slice(1).replace('-', ' ')}\n` +
                       `**Transaction Hash:** \`${txHash}\`\n` +
                       `**Status:** Transaction is pending and has not been mined yet.\n` +
                       `**Block Number:** Not yet assigned\n`;
          
          const data = {
            hash: txHash,
            network,
            status: 'pending',
            blockNumber: null,
            confirmations: 0,
            transaction: tx,
          };
          
          callback?.({ 
            text, 
            content: data
          });
          
          return { 
            text, 
            success: true, 
            data,
            values: {
              confirmed: false,
              status: 'pending',
              blockNumber: null,
              confirmations: 0,
              success: false,
            },
            input: inputParams,
          } as ActionResult & { input: typeof inputParams };
        } catch (txError) {
          // Transaction doesn't exist
          const errorMsg = `Transaction not found: ${txHash}. It may not exist or the network may be incorrect.`;
          logger.error(`[CHECK_TX_CONFIRMATION] ${errorMsg}`);
          const errorResult: ActionResult = {
            text: ` ${errorMsg}`,
            success: false,
            error: "transaction_not_found",
            input: inputParams,
          } as ActionResult & { input: typeof inputParams };
          callback?.({ 
            text: errorResult.text,
            content: { error: "transaction_not_found", details: errorMsg }
          });
          return errorResult;
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("[CHECK_TX_CONFIRMATION] Action failed:", errorMessage);
      
      const errorText = ` Failed to check transaction confirmation: ${errorMessage}`;
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
      { name: "{{user}}", content: { text: "check confirmation for transaction 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef on base" } },
      { name: "{{agent}}", content: { text: " Checking transaction confirmation on base...", action: "CHECK_TX_CONFIRMATION" } },
    ],
    [
      { name: "{{user}}", content: { text: "is transaction 0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890 confirmed?" } },
      { name: "{{agent}}", content: { text: " Checking transaction confirmation...", action: "CHECK_TX_CONFIRMATION" } },
    ],
    [
      { name: "{{user}}", content: { text: "check status of tx 0x9876543210fedcba9876543210fedcba9876543210fedcba9876543210fedcba on ethereum" } },
      { name: "{{agent}}", content: { text: " Checking transaction confirmation on ethereum...", action: "CHECK_TX_CONFIRMATION" } },
    ],
  ],
};

export default cdpCheckTxConfirmation;

