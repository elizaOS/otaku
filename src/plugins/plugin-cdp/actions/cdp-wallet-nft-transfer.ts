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
import { validateCdpService } from "../utils/actionHelpers";
import { type CdpNetwork } from "../types";

interface NftTransferParams {
  network: CdpNetwork;
  to: `0x${string}`;
  contractAddress: string;
  tokenId: string;
}

export const cdpWalletNftTransfer: Action = {
  name: "USER_WALLET_NFT_TRANSFER",
  similes: [
    "SEND_NFT",
    "TRANSFER_NFT",
    "SEND_NFT_CDP",
    "TRANSFER_NFT_CDP",
  ],
  description: "Use this action when you need to transfer NFTs (ERC721 or ERC1155) from user's wallet. For tokens, use USER_WALLET_TOKEN_TRANSFER instead. IMPORTANT: Before executing, you MUST present a clear summary (NFT details, recipient address, network) and get explicit user confirmation ('yes', 'confirm', 'go ahead'). Never execute transfers without confirmed intent - they are irreversible.",
  
  // Parameter schema for tool calling
  parameters: {
    to: {
      type: "string",
      description: "Recipient wallet address (must be a valid 0x address, 42 characters)",
      required: true,
    },
    contractAddress: {
      type: "string",
      description: "NFT contract address (must be a valid 0x address, 42 characters)",
      required: true,
    },
    tokenId: {
      type: "string",
      description: "NFT token ID (e.g., '1', '42', '12345')",
      required: true,
    },
    network: {
      type: "string",
      description: "Network where the NFT exists: 'base', 'ethereum', 'arbitrum', 'optimism', or 'polygon'",
      required: true,
    },
  },
  
  validate: async (_runtime: IAgentRuntime, message: Memory, state?: State) => {
    return validateCdpService(_runtime, "USER_WALLET_NFT_TRANSFER", state, message);
  },
  
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback,
  ): Promise<ActionResult> => {
    logger.info("[USER_WALLET_NFT_TRANSFER] Handler invoked");
    
    try {
      logger.debug("[USER_WALLET_NFT_TRANSFER] Retrieving CDP service");
      const cdpService = runtime.getService(CdpService.serviceType) as CdpService;
      
      if (!cdpService) {
        const errorMsg = "CDP Service not initialized";
        logger.error(`[USER_WALLET_NFT_TRANSFER] ${errorMsg}`);
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
      logger.debug("[USER_WALLET_NFT_TRANSFER] Verifying entity wallet");
      const walletResult = await getEntityWallet(
        runtime,
        message,
        "USER_WALLET_NFT_TRANSFER",
        callback,
      );
      if (walletResult.success === false) {
        logger.warn("[USER_WALLET_NFT_TRANSFER] Entity wallet verification failed");
        return {
          ...walletResult.result,
          input: {},
        } as ActionResult & { input: {} };
      }

      const accountName = walletResult.metadata?.accountName as string;
      if (!accountName) {
        const errorMsg = "Could not find account name for wallet";
        logger.error(`[USER_WALLET_NFT_TRANSFER] ${errorMsg}`);
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
      logger.debug("[USER_WALLET_NFT_TRANSFER] Entity wallet verified successfully");

      // Read parameters from state (extracted by multiStepDecisionTemplate)
      const composedState = await runtime.composeState(message, ["ACTION_STATE"], true);
      const params = composedState?.data?.actionParams || {};

      // Store input parameters early for debugging (even if validation fails)
      const inputParams = {
        to: params?.to,
        contractAddress: params?.contractAddress,
        tokenId: params?.tokenId,
        network: params?.network,
      };

      // Validate required parameters
      const toParam = params?.to?.trim();
      const contractAddressParam = params?.contractAddress?.trim();
      const tokenIdParam = params?.tokenId?.trim();
      const networkParam = params?.network?.trim();

      if (!toParam) {
        const errorMsg = "Missing required parameter 'to'. Please specify the recipient wallet address (0x...).";
        logger.error(`[USER_WALLET_NFT_TRANSFER] ${errorMsg}`);
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

      // Validate recipient address format
      if (!toParam.startsWith("0x") || toParam.length !== 42) {
        const errorMsg = `Invalid recipient address: ${toParam}. Address must start with '0x' and be 42 characters long.`;
        logger.error(`[USER_WALLET_NFT_TRANSFER] ${errorMsg}`);
        const errorResult: ActionResult = {
          text: ` ${errorMsg}`,
          success: false,
          error: "invalid_address",
          input: inputParams,
        } as ActionResult & { input: typeof inputParams };
        callback?.({ 
          text: errorResult.text,
          content: { error: "invalid_address", details: errorMsg }
        });
        return errorResult;
      }

      if (!contractAddressParam) {
        const errorMsg = "Missing required parameter 'contractAddress'. Please specify the NFT contract address (0x...).";
        logger.error(`[USER_WALLET_NFT_TRANSFER] ${errorMsg}`);
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

      // Validate contract address format
      if (!contractAddressParam.startsWith("0x") || contractAddressParam.length !== 42) {
        const errorMsg = `Invalid contract address: ${contractAddressParam}. Address must start with '0x' and be 42 characters long.`;
        logger.error(`[USER_WALLET_NFT_TRANSFER] ${errorMsg}`);
        const errorResult: ActionResult = {
          text: ` ${errorMsg}`,
          success: false,
          error: "invalid_address",
          input: inputParams,
        } as ActionResult & { input: typeof inputParams };
        callback?.({ 
          text: errorResult.text,
          content: { error: "invalid_address", details: errorMsg }
        });
        return errorResult;
      }

      if (!tokenIdParam) {
        const errorMsg = "Missing required parameter 'tokenId'. Please specify the NFT token ID.";
        logger.error(`[USER_WALLET_NFT_TRANSFER] ${errorMsg}`);
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

      if (!networkParam) {
        const errorMsg = "Missing required parameter 'network'. Please specify which network the NFT is on (e.g., 'base', 'ethereum').";
        logger.error(`[USER_WALLET_NFT_TRANSFER] ${errorMsg}`);
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

      // Parse transfer parameters
      const transferParams: NftTransferParams = {
        network: networkParam as CdpNetwork,
        to: toParam as `0x${string}`,
        contractAddress: contractAddressParam,
        tokenId: tokenIdParam,
      };

      logger.info(`[USER_WALLET_NFT_TRANSFER] NFT transfer parameters: ${JSON.stringify(transferParams)}`);

      // SECURITY: Force fresh NFT data fetch to prevent TOCTOU race conditions
      // where an NFT could be transferred out between the check and the transfer.
      // This minimizes the window for double-sale attacks.
      logger.info(`[USER_WALLET_NFT_TRANSFER] Verifying NFT ownership with fresh data fetch`);
      // Pass wallet address to avoid CDP account lookup (prevents "account not initialized" errors)
      const walletInfo = await cdpService.fetchWalletInfo(accountName, transferParams.network, walletResult.walletAddress);
      
      const nftInWallet = walletInfo.nfts.find(
        nft => nft.contractAddress.toLowerCase() === transferParams.contractAddress.toLowerCase() &&
               nft.tokenId === transferParams.tokenId &&
               nft.chain === transferParams.network
      );

      if (!nftInWallet) {
        const errorMsg = `NFT not found in your wallet. Contract: ${transferParams.contractAddress}, Token ID: ${transferParams.tokenId} on ${transferParams.network}`;
        logger.error(`[USER_WALLET_NFT_TRANSFER] ${errorMsg}`);
        const errorResult: ActionResult = {
          text: ` ${errorMsg}`,
          success: false,
          error: "nft_not_found",
          input: inputParams,
        } as ActionResult & { input: typeof inputParams };
        callback?.({ 
          text: errorResult.text,
          content: { error: "nft_not_found", details: errorMsg }
        });
        return errorResult;
      }

      const nftName = nftInWallet.name || `Token #${transferParams.tokenId}`;
      logger.info(`[USER_WALLET_NFT_TRANSFER] Found NFT in wallet: ${nftName}`);

      callback?.({ text: ` Transferring NFT "${nftName}" to ${transferParams.to}...` });

      // Execute NFT transfer via service method
      logger.info(`[USER_WALLET_NFT_TRANSFER] Executing NFT transfer on ${transferParams.network}`);
      const result = await cdpService.transferNft({
        accountName,
        network: transferParams.network,
        to: transferParams.to,
        contractAddress: transferParams.contractAddress as `0x${string}`,
        tokenId: transferParams.tokenId,
      });

      const successText = ` NFT Transfer successful!\n\n` +
                         ` NFT: ${nftName}\n` +
                         ` Contract: ${transferParams.contractAddress}\n` +
                         ` Token ID: ${transferParams.tokenId}\n` +
                         ` To: ${transferParams.to}\n` +
                         ` Network: ${transferParams.network}\n` +
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
          network: transferParams.network,
          to: transferParams.to,
          contractAddress: transferParams.contractAddress,
          tokenId: transferParams.tokenId,
          nftName,
        },
        input: inputParams,
      } as ActionResult & { input: typeof inputParams };
    } catch (error) {
      logger.error("[USER_WALLET_NFT_TRANSFER] Action failed:", error instanceof Error ? error.message : String(error));
      
      let errorMessage = "NFT transfer failed";
      let errorCode = "action_failed";
      
      if (error instanceof Error) {
        if (error.message.includes("not owner") || error.message.includes("not found")) {
          errorMessage = "You don't own this NFT or it doesn't exist";
          errorCode = "nft_not_owned";
        } else if (error.message.includes("invalid address")) {
          errorMessage = "Invalid recipient or contract address";
          errorCode = "invalid_address";
        } else {
          errorMessage = `NFT transfer failed: ${error.message}`;
        }
      }
      
      const errorText = ` ${errorMessage}`;
      
      // Try to capture input params for debugging (in case error happened very early)
      let failureInputParams;
      try {
        const composedState = await runtime.composeState(message, ["ACTION_STATE"], true);
        const params = composedState?.data?.actionParams || {};
        failureInputParams = {
          to: params?.to,
          contractAddress: params?.contractAddress,
          tokenId: params?.tokenId,
          network: params?.network,
        };
      } catch (stateError) {
        // If we can't get state, use empty object
        failureInputParams = {
          to: undefined,
          contractAddress: undefined,
          tokenId: undefined,
          network: undefined,
        };
      }
      
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
        content: { text: "send my NFT from contract 0x1234567890123456789012345678901234567890 token id 42 to 0xabcd1234abcd1234abcd1234abcd1234abcd1234 on base" },
      },
      {
        name: "{{agent}}",
        content: {
          text: " Transferring NFT #42 to the specified address...",
          action: "USER_WALLET_NFT_TRANSFER",
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: { text: "transfer NFT 0x9876...5432 token 123 to 0xef01...ef01 on ethereum" },
      },
      {
        name: "{{agent}}",
        content: {
          text: " Transferring your NFT...",
          action: "USER_WALLET_NFT_TRANSFER",
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: { text: "send nft contract 0xabcdef1234567890abcdef1234567890abcdef12 id 5 to vitalik.eth on base" },
      },
      {
        name: "{{agent}}",
        content: {
          text: " Transferring NFT #5...",
          action: "USER_WALLET_NFT_TRANSFER",
        },
      },
    ],
  ],
};

export default cdpWalletNftTransfer;

