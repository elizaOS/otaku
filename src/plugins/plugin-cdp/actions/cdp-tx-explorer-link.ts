import {
  type Action,
  type IAgentRuntime,
  type Memory,
  type State,
  type HandlerCallback,
  type ActionResult,
  logger
} from "@elizaos/core";
import { getTxExplorerUrl } from "../../../constants/chains";
import { validateCdpPluginContext } from "../utils/actionHelpers";

export const cdpTxExplorerLink: Action = {
  name: "GET_TX_EXPLORER_LINK",
  similes: [
    "TX_LINK",
    "TRANSACTION_LINK",
    "ETHERSCAN_LINK",
    "BASESCAN_LINK",
    "POLYGONSCAN_LINK",
    "ARBISCAN_LINK",
    "EXPLORER_LINK",
    "VIEW_TRANSACTION",
    "TX_HASH_LINK",
  ],
  description:
    "Returns a blockchain explorer link (Etherscan, Basescan, Polygonscan, Arbiscan, etc.) for a given transaction hash and network. Use this to generate clickable links to view transaction details on the appropriate blockchain explorer.",
  
  parameters: {
    txhash: {
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
    return validateCdpPluginContext("TX_EXPLORER_LINK", state, message);
  },
  
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback,
  ): Promise<ActionResult> => {
    try {
      logger.info("[GET_TX_EXPLORER_LINK] Generating transaction explorer link");
      
      // Read parameters from state (extracted by multiStepDecisionTemplate)
      const composedState = await runtime.composeState(message, ["ACTION_STATE"], true);
      const params = composedState?.data?.actionParams || {};
      
      // Extract and validate parameters
      const txhash = params?.txhash?.trim();
      const network = params?.network?.trim()?.toLowerCase();
      
      // Store input parameters for return
      const inputParams = {
        txhash: txhash || undefined,
        network: network || undefined,
      };
      
      // Validate required parameters
      if (!txhash) {
        const errorMsg = "Missing required parameter 'txhash'. Please provide a transaction hash.";
        logger.error(`[GET_TX_EXPLORER_LINK] ${errorMsg}`);
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
        logger.error(`[GET_TX_EXPLORER_LINK] ${errorMsg}`);
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
      if (!/^0x[a-fA-F0-9]{64}$/.test(txhash)) {
        const errorMsg = `Invalid transaction hash format: ${txhash}. Expected 0x-prefixed hex string with 64 characters (66 total).`;
        logger.error(`[GET_TX_EXPLORER_LINK] ${errorMsg}`);
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
        logger.error(`[GET_TX_EXPLORER_LINK] ${errorMsg}`);
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
      
      // Generate explorer link using the helper function
      const explorerLink = getTxExplorerUrl(network, txhash);
      
      if (!explorerLink) {
        const errorMsg = `Could not generate explorer link for network: ${network}`;
        logger.error(`[GET_TX_EXPLORER_LINK] ${errorMsg}`);
        const errorResult: ActionResult = {
          text: ` ${errorMsg}`,
          success: false,
          error: "link_generation_failed",
          input: inputParams,
        } as ActionResult & { input: typeof inputParams };
        callback?.({ 
          text: errorResult.text,
          content: { error: "link_generation_failed", details: errorMsg }
        });
        return errorResult;
      }
      
      logger.info(`[GET_TX_EXPLORER_LINK] Generated explorer link: ${explorerLink}`);
      
      // Format response text with markdown link
      const networkName = network.charAt(0).toUpperCase() + network.slice(1).replace('-', ' ');
      const text = ` **Transaction Explorer Link**\n\n` +
                   `Network: ${networkName}\n` +
                   `Transaction Hash: \`${txhash}\`\n` +
                   `Link: ${explorerLink}`;
      
      const data = {
        txhash,
        network,
        explorerLink,
        explorerUrl: explorerLink, // Alias for compatibility
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
          explorerLink,
          txhash,
          network,
        },
        input: inputParams,
      } as ActionResult & { input: typeof inputParams };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("[GET_TX_EXPLORER_LINK] Action failed:", errorMessage);
      
      const errorText = ` Failed to generate transaction explorer link: ${errorMessage}`;
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
      { name: "{{user}}", content: { text: "get link for transaction 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef on base" } },
      { name: "{{agent}}", content: { text: " Generating transaction explorer link...", action: "GET_TX_EXPLORER_LINK" } },
    ],
    [
      { name: "{{user}}", content: { text: "show me the etherscan link for tx 0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890" } },
      { name: "{{agent}}", content: { text: " Generating transaction explorer link...", action: "GET_TX_EXPLORER_LINK" } },
    ],
    [
      { name: "{{user}}", content: { text: "link to basescan for transaction hash 0x9876543210fedcba9876543210fedcba9876543210fedcba9876543210fedcba" } },
      { name: "{{agent}}", content: { text: " Generating transaction explorer link...", action: "GET_TX_EXPLORER_LINK" } },
    ],
  ],
};

export default cdpTxExplorerLink;

