import {
  type Action,
  type IAgentRuntime,
  type Memory,
  type State,
  type HandlerCallback,
  type ActionResult,
  logger
} from "@elizaos/core";
import { getEntityWallet } from "../../../utils/entity";
import { CdpService } from "../services/cdp.service";

export const cdpWalletInfo: Action = {
  name: "USER_WALLET_INFO",
  similes: [
    "USER_WALLET_DETAILS",
    "USER_ADDRESS",
    "COINBASE_WALLET_INFO",
    "CHECK_WALLET",
    "WALLET_BALANCE",
    "MY_WALLET",
    "WALLET_TOKENS",
    "WALLET_NFTS",
    "SHOW_TOKENS",
    "SHOW_NFTS",
    "VIEW_WALLET",
    "WALLET_ASSETS",
  ],
  description:
    "Retrieves the user's latest wallet data including balances, tokens, and NFTs. Use this action to get up-to-date wallet information or to confirm wallet status after a transaction. Optionally specify a chain to fetch data for a specific network.",

  // Optional chain parameter - if not provided, fetches all chains
  parameters: {
    chain: {
      type: "string",
      description: "Optional blockchain network to query (e.g., 'base', 'ethereum', 'polygon', 'arbitrum', 'optimism'). If not provided, fetches data from all supported chains.",
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
        logger.warn("[USER_WALLET_INFO] CDP service not available");
        return false;
      }

      return true;
    } catch (error) {
      logger.error(
        "[USER_WALLET_INFO] Error validating action:",
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
      logger.info("[USER_WALLET_INFO] Fetching user wallet information");
      
      // Read parameters from state (extracted by multiStepDecisionTemplate)
      const composedState = await runtime.composeState(message, ["ACTION_STATE"], true);
      const params = composedState?.data?.actionParams || {};
      
      // Extract chain parameter if provided
      const chain = params?.chain?.trim();
      
      // Store input parameters for return
      const inputParams = chain ? { chain } : {};

      // Validate chain parameter if provided
      const validChains = ['base', 'ethereum', 'polygon', 'arbitrum', 'optimism'];
      if (chain && !validChains.includes(chain.toLowerCase())) {
        const errorMsg = `Invalid chain: ${chain}. Supported chains: ${validChains.join(', ')}`;
        logger.error(`[USER_WALLET_INFO] ${errorMsg}`);
        const errorResult: ActionResult = {
          text: `❌ ${errorMsg}`,
          success: false,
          error: "invalid_chain",
          input: inputParams,
        } as ActionResult & { input: typeof inputParams };
        callback?.({ 
          text: errorResult.text,
          content: { error: "invalid_chain", details: errorMsg }
        });
        return errorResult;
      }

      const wallet = await getEntityWallet(
        runtime,
        message,
        "USER_WALLET_INFO",
        callback,
      );

      if (wallet.success === false) {
        logger.error("[USER_WALLET_INFO] Failed to get entity wallet");
        return {
          ...wallet.result,
          input: inputParams,
        } as ActionResult & { input: typeof inputParams };
      }

      const accountName = wallet.metadata?.accountName as string;

      if (!accountName) {
        const errorMsg = "Could not find account name for wallet";
        logger.error(`[USER_WALLET_INFO] ${errorMsg}`);
        const errorResult: ActionResult = {
          text: `❌ ${errorMsg}`,
          success: false,
          error: "missing_account_name",
          input: inputParams,
        } as ActionResult & { input: typeof inputParams };
        callback?.({ 
          text: errorResult.text,
          content: { error: "missing_account_name", details: errorMsg }
        });
        return errorResult;
      }
      
      // Get CDP service
      const cdpService = runtime.getService(CdpService.serviceType) as CdpService;
      
      if (!cdpService) {
        const errorMsg = "CDP service not available";
        logger.error(`[USER_WALLET_INFO] ${errorMsg}`);
        const errorResult: ActionResult = {
          text: `❌ ${errorMsg}`,
          success: false,
          error: "service_unavailable",
          input: inputParams,
        } as ActionResult & { input: typeof inputParams };
        callback?.({ 
          text: errorResult.text,
          content: { error: "service_unavailable", details: errorMsg }
        });
        return errorResult;
      }

      // Fetch comprehensive wallet info (always fresh data)
      const chainInfo = chain ? ` on ${chain}` : '';
      logger.info(`[USER_WALLET_INFO] Fetching fresh wallet info for account: ${accountName}${chainInfo}`);
      callback?.({ text: `🔍 Fetching your wallet information${chainInfo}...` });

      const walletInfo = await cdpService.fetchWalletInfo(accountName, chain);

      logger.info(`[USER_WALLET_INFO] Successfully fetched wallet info: ${walletInfo.tokens.length} tokens, ${walletInfo.nfts.length} NFTs, $${walletInfo.totalUsdValue.toFixed(2)} total value${chainInfo}`);

      // Format the response
      let text = `💼 **Wallet Information${chain ? ` (${chain.charAt(0).toUpperCase() + chain.slice(1)})` : ''}**\n\n`;
      text += `📍 **Address:** \`${walletInfo.address}\`\n`;
      text += `💰 **Total Value:** $${walletInfo.totalUsdValue.toFixed(2)}\n\n`;

      // Token summary
      if (walletInfo.tokens.length > 0) {
        text += `🪙 **Tokens (${walletInfo.tokens.length}):**\n`;
        
        // Group tokens by chain
        const tokensByChain = walletInfo.tokens.reduce((acc, token) => {
          if (!acc[token.chain]) acc[token.chain] = [];
          acc[token.chain].push(token);
          return acc;
        }, {} as Record<string, typeof walletInfo.tokens>);

        for (const [chain, tokens] of Object.entries(tokensByChain)) {
          text += `\n**${chain.charAt(0).toUpperCase() + chain.slice(1)}:**\n`;
          
          // Sort by USD value (highest first) and show top 5 per chain
          const sortedTokens = tokens
            .sort((a, b) => b.usdValue - a.usdValue)
            .slice(0, 5);

          for (const token of sortedTokens) {
            const valueStr = token.usdValue > 0 
              ? ` ($${token.usdValue.toFixed(2)})` 
              : '';
            text += `  • ${token.balanceFormatted} ${token.symbol}${valueStr}\n`;
          }

          if (tokens.length > 5) {
            text += `  • ... and ${tokens.length - 5} more\n`;
          }
        }
      } else {
        text += `🪙 **Tokens:** None found\n`;
      }

      // NFT summary
      text += `\n🖼️ **NFTs:** ${walletInfo.nfts.length} item${walletInfo.nfts.length !== 1 ? 's' : ''}`;
      
      if (walletInfo.nfts.length > 0) {
        // Group NFTs by chain
        const nftsByChain = walletInfo.nfts.reduce((acc, nft) => {
          if (!acc[nft.chain]) acc[nft.chain] = [];
          acc[nft.chain].push(nft);
          return acc;
        }, {} as Record<string, typeof walletInfo.nfts>);

        text += '\n';
        for (const [chain, nfts] of Object.entries(nftsByChain)) {
          text += `\n**${chain.charAt(0).toUpperCase() + chain.slice(1)}:** ${nfts.length} NFT${nfts.length !== 1 ? 's' : ''}\n`;
          
          // Show first 3 NFTs per chain
          const displayNfts = nfts.slice(0, 3);
          for (const nft of displayNfts) {
            text += `  • ${nft.name} (${nft.contractName})\n`;
          }

          if (nfts.length > 3) {
            text += `  • ... and ${nfts.length - 3} more\n`;
          }
        }
      }

      const data = {
        address: walletInfo.address,
        tokens: walletInfo.tokens,
        nfts: walletInfo.nfts,
        totalUsdValue: walletInfo.totalUsdValue,
        ...(chain && { chain }),
      };

      callback?.({ 
        text, 
        content: data
      });

      return { 
        text, 
        success: true, 
        data,
        values: data,
        input: inputParams,
      } as ActionResult & { input: typeof inputParams };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("[USER_WALLET_INFO] Action failed:", errorMessage);
      
      const errorText = `❌ Failed to fetch wallet info: ${errorMessage}`;
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
      { name: "{{user}}", content: { text: "show my wallet" } },
      { name: "{{agent}}", content: { text: "🔍 Fetching your wallet information...", action: "USER_WALLET_INFO" } },
    ],
    [
      { name: "{{user}}", content: { text: "check my wallet balance" } },
      { name: "{{agent}}", content: { text: "🔍 Fetching your wallet information...", action: "USER_WALLET_INFO" } },
    ],
    [
      { name: "{{user}}", content: { text: "what tokens do I have?" } },
      { name: "{{agent}}", content: { text: "🔍 Fetching your wallet information...", action: "USER_WALLET_INFO" } },
    ],
    [
      { name: "{{user}}", content: { text: "show my NFTs" } },
      { name: "{{agent}}", content: { text: "🔍 Fetching your wallet information...", action: "USER_WALLET_INFO" } },
    ],
    [
      { name: "{{user}}", content: { text: "what's in my wallet?" } },
      { name: "{{agent}}", content: { text: "🔍 Fetching your wallet information...", action: "USER_WALLET_INFO" } },
    ],
    [
      { name: "{{user}}", content: { text: "show my wallet on base" } },
      { name: "{{agent}}", content: { text: "🔍 Fetching your wallet information on base...", action: "USER_WALLET_INFO", chain: "base" } },
    ],
    [
      { name: "{{user}}", content: { text: "check my ethereum wallet" } },
      { name: "{{agent}}", content: { text: "🔍 Fetching your wallet information on ethereum...", action: "USER_WALLET_INFO", chain: "ethereum" } },
    ],
    [
      { name: "{{user}}", content: { text: "what tokens do I have on polygon?" } },
      { name: "{{agent}}", content: { text: "🔍 Fetching your wallet information on polygon...", action: "USER_WALLET_INFO", chain: "polygon" } },
    ],
  ],
};

export default cdpWalletInfo;


