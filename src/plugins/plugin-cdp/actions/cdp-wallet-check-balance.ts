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
import { validateCdpService } from "../utils/actionHelpers";

interface CheckBalanceParams {
  token: string;
  chain?: string;
  minAmount?: string;
}

type CheckBalanceInput = {
  token?: string;
  chain?: string;
  minAmount?: string;
};

type CheckBalanceActionResult = ActionResult & { input: CheckBalanceInput };

const POLYGON_NATIVE_ALIASES = new Set(["pol", "matic"]);

interface NormalizedTokenQuery {
  canonicalSymbol: string;
  searchSymbols: string[];
  isPolygonNativeAlias: boolean;
  wasRequestedAsMatic: boolean;
}

const normalizeTokenQuery = (token: string): NormalizedTokenQuery => {
  const trimmed = token.trim();
  const lower = trimmed.toLowerCase();
  const isAlias = POLYGON_NATIVE_ALIASES.has(lower);

  return {
    canonicalSymbol: isAlias ? "POL" : trimmed.toUpperCase(),
    searchSymbols: isAlias ? Array.from(POLYGON_NATIVE_ALIASES) : [lower],
    isPolygonNativeAlias: isAlias,
    wasRequestedAsMatic: lower === "matic",
  };
};

export const cdpWalletCheckBalance: Action = {
  name: "CHECK_TOKEN_BALANCE",
  similes: [
    "CHECK_BALANCE",
    "VERIFY_BALANCE",
    "TOKEN_BALANCE",
    "WALLET_TOKEN_BALANCE",
    "HAS_ENOUGH",
    "CAN_AFFORD",
    "VERIFY_FUNDS",
  ],
  description:
    "Quickly check if user has sufficient balance of a specific token on a specific chain. Optimized for transaction validation - only fetches data for the specified token and chain instead of all assets. Use this before executing swaps, transfers, or other transactions to verify funds availability.",

  parameters: {
    token: {
      type: "string",
      description:
        "Token symbol (e.g., 'ETH', 'USDC', 'POL' formerly 'MATIC') or contract address (0x...)",
      required: true,
    },
    chain: {
      type: "string",
      description: "Blockchain network to check (e.g., 'base', 'ethereum', 'polygon', 'arbitrum', 'optimism'). If not provided, searches across all chains.",
      required: false,
    },
    minAmount: {
      type: "string",
      description: "Minimum amount needed in human-readable format (e.g., '1.5' for 1.5 tokens). If provided, validates if user has at least this amount.",
      required: false,
    },
  },
  
  validate: async (_runtime: IAgentRuntime, message: Memory, state?: State) => {
    return validateCdpService(_runtime, "USER_WALLET_CHECK_BALANCE", state, message);
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback,
  ): Promise<ActionResult> => {
    try {
      logger.info("[CHECK_TOKEN_BALANCE] Checking token balance");
      
      // Read parameters from state
      const composedState = await runtime.composeState(message, ["ACTION_STATE"], true);
      const params = (composedState?.data?.actionParams ?? {}) as Partial<CheckBalanceParams>;
      const rawInput: CheckBalanceInput = {
        token: params.token,
        chain: params.chain,
        minAmount: params.minAmount,
      };
      
      // Validate required parameters
      if (!params.token?.trim()) {
        const errorMsg = "Token parameter is required (e.g., 'ETH', 'USDC', or contract address)";
        logger.error(`[CHECK_TOKEN_BALANCE] ${errorMsg}`);
        const errorResult: CheckBalanceActionResult = {
          text: ` ${errorMsg}`,
          success: false,
          error: "missing_token",
          input: rawInput,
        };
        callback?.({ 
          text: errorResult.text,
          content: { error: "missing_token", details: errorMsg }
        });
        return errorResult;
      }

      const tokenInput = (params.token ?? "").trim();
      const chain = params.chain?.trim().toLowerCase();
      const minAmount = params.minAmount?.trim();

      const isTokenAddress = tokenInput.startsWith("0x") && tokenInput.length === 42;
      const normalizedToken = isTokenAddress ? null : normalizeTokenQuery(tokenInput);

      // Store input parameters (canonical symbol when possible)
      const inputParams: CheckBalanceInput = {
        token: isTokenAddress
          ? tokenInput
          : normalizedToken?.canonicalSymbol ?? tokenInput.toUpperCase(),
      };
      if (chain) {
        inputParams.chain = chain;
      }
      if (minAmount) {
        inputParams.minAmount = minAmount;
      }

      // Validate chain if provided
      const validChains = ['base', 'ethereum', 'polygon', 'arbitrum', 'optimism', 'scroll'];
      if (chain && !validChains.includes(chain)) {
        const errorMsg = `Invalid chain: ${chain}. Supported chains: ${validChains.join(', ')}`;
        logger.error(`[CHECK_TOKEN_BALANCE] ${errorMsg}`);
        const errorResult: CheckBalanceActionResult = {
          text: ` ${errorMsg}`,
          success: false,
          error: "invalid_chain",
          input: inputParams,
        };
        callback?.({ 
          text: errorResult.text,
          content: { error: "invalid_chain", details: errorMsg }
        });
        return errorResult;
      }

      // Get wallet info
      const wallet = await getEntityWallet(
        runtime,
        message,
        "CHECK_TOKEN_BALANCE",
        callback,
      );

      if (wallet.success === false) {
        logger.error("[CHECK_TOKEN_BALANCE] Failed to get entity wallet");
        const failureResult: CheckBalanceActionResult = {
          ...wallet.result,
          input: inputParams,
        };
        return failureResult;
      }

      const accountName = wallet.metadata?.accountName as string;

      if (!accountName) {
        const errorMsg = "Could not find account name for wallet";
        logger.error(`[CHECK_TOKEN_BALANCE] ${errorMsg}`);
        const errorResult: CheckBalanceActionResult = {
          text: ` ${errorMsg}`,
          success: false,
          error: "missing_account_name",
          input: inputParams,
        };
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
        logger.error(`[CHECK_TOKEN_BALANCE] ${errorMsg}`);
        const errorResult: CheckBalanceActionResult = {
          text: ` ${errorMsg}`,
          success: false,
          error: "service_unavailable",
          input: inputParams,
        };
        callback?.({ 
          text: errorResult.text,
          content: { error: "service_unavailable", details: errorMsg }
        });
        return errorResult;
      }

      // Use cached wallet info for speed (most cases will have recent data)
      const chainInfo = chain ? ` on ${chain}` : '';
      const logToken = normalizedToken?.canonicalSymbol ?? tokenInput.toUpperCase();
      logger.info(
        `[CHECK_TOKEN_BALANCE] Checking balance for ${logToken}${chainInfo} (account: ${accountName})`,
      );
      
      // Pass wallet address to avoid CDP account lookup (prevents "account not initialized" errors)
      const walletInfo = await cdpService.fetchWalletInfo(accountName, chain, wallet.walletAddress);

      // Find the token in wallet
      let matchedToken: typeof walletInfo.tokens[number] | undefined;

      if (isTokenAddress) {
        // Token is a contract address
        matchedToken = walletInfo.tokens.find(
          t => t.contractAddress?.toLowerCase() === tokenInput.toLowerCase(),
        );
      } else {
        // Token is a symbol - find across all chains or specific chain
        const searchSymbols = normalizedToken?.searchSymbols ?? [tokenInput.toLowerCase()];
        const matchingTokens = walletInfo.tokens.filter((t) => {
          if (chain && t.chain.toLowerCase() !== chain) {
            return false;
          }
          return searchSymbols.includes(t.symbol.toLowerCase());
        });

        if (matchingTokens.length > 0) {
          const sorted = matchingTokens.sort((a, b) => {
            if (normalizedToken?.isPolygonNativeAlias) {
              const aChain = a.chain.toLowerCase();
              const bChain = b.chain.toLowerCase();
              const aIsPolygonNative = a.contractAddress === null && aChain === "polygon";
              const bIsPolygonNative = b.contractAddress === null && bChain === "polygon";

              if (aIsPolygonNative !== bIsPolygonNative) {
                return aIsPolygonNative ? -1 : 1;
              }
            }

            return parseFloat(b.balance) - parseFloat(a.balance);
          });

          matchedToken = sorted[0];
        }
      }

      if (!matchedToken) {
        const tokenLabel = normalizedToken?.canonicalSymbol ?? tokenInput.toUpperCase();
        const errorMsg = `Token ${tokenLabel} not found in wallet${chainInfo}`;
        logger.warn(`[CHECK_TOKEN_BALANCE] ${errorMsg}`);
        
        const aliasSuffix = normalizedToken?.wasRequestedAsMatic
          ? " (formerly MATIC)"
          : "";
        const text = ` You don't have any ${tokenLabel}${aliasSuffix}${chainInfo}. Current balance: 0`;

        const result: CheckBalanceActionResult = {
          text,
          success: true,
          data: {
            token: normalizedToken?.canonicalSymbol ?? tokenInput.toUpperCase(),
            chain: chain || "any",
            balance: "0",
            balanceFormatted: "0",
            hasToken: false,
            hasSufficientBalance: false,
            minAmount: minAmount || null,
            usdValue: 0,
            usdPrice: 0,
          },
          input: inputParams,
        };
        return result;
      }

      // Check if balance is sufficient (if minAmount provided)
      let hasSufficientBalance = true;
      if (minAmount) {
        const minAmountNum = parseFloat(minAmount);
        const balanceNum = parseFloat(matchedToken.balance);
        hasSufficientBalance = balanceNum >= minAmountNum;
      }

      const matchedSymbol = matchedToken.symbol || (normalizedToken?.canonicalSymbol ?? tokenInput.toUpperCase());
      logger.info(
        `[CHECK_TOKEN_BALANCE] Found ${matchedSymbol.toUpperCase()}: ${matchedToken.balanceFormatted} ` +
        `on ${matchedToken.chain} (≈$${matchedToken.usdValue.toFixed(2)})` +
        (minAmount ? ` - ${hasSufficientBalance ? 'Sufficient' : 'Insufficient'}` : '')
      );

      // Format response
      const displaySymbol = matchedToken.symbol || (normalizedToken?.canonicalSymbol ?? tokenInput.toUpperCase());
      const interpretedMatic =
        normalizedToken?.wasRequestedAsMatic &&
        matchedToken.contractAddress === null &&
        matchedToken.chain.toLowerCase() === "polygon";

      let text = interpretedMatic
        ? " Interpreting MATIC as POL (Polygon native token).\n\n"
        : " ";

      text += `**${displaySymbol.toUpperCase()} Balance**\n\n`;
      text += `**Chain:** ${matchedToken.chain.charAt(0).toUpperCase() + matchedToken.chain.slice(1)}\n`;
      text += `**Balance:** ${matchedToken.balanceFormatted} ${matchedToken.symbol}\n`;
      text += `**USD Value:** $${matchedToken.usdValue.toFixed(2)}\n`;
      text += `**Price:** $${matchedToken.usdPrice.toFixed(matchedToken.usdPrice < 1 ? 6 : 2)}`;

      if (minAmount) {
        text += `\n\n**Required:** ${minAmount} ${matchedToken.symbol}\n`;
        text += `**Status:** ${hasSufficientBalance ? '✅ Sufficient balance' : '❌ Insufficient balance'}`;
      }

      const result: CheckBalanceActionResult = {
        text,
        success: true,
        data: {
          token: matchedToken.symbol,
          chain: matchedToken.chain,
          balance: matchedToken.balance,
          balanceFormatted: matchedToken.balanceFormatted,
          hasToken: true,
          hasSufficientBalance,
          minAmount: minAmount || null,
          usdValue: matchedToken.usdValue,
          usdPrice: matchedToken.usdPrice,
          decimals: matchedToken.decimals,
          contractAddress: matchedToken.contractAddress,
        },
        input: inputParams,
      };
      return result;

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`[CHECK_TOKEN_BALANCE] Error: ${errorMsg}`);
      const errorResult: ActionResult = {
        text: ` Failed to check token balance: ${errorMsg}`,
        success: false,
        error: errorMsg,
      };
      callback?.({ 
        text: errorResult.text,
        content: { error: "check_balance_failed", details: errorMsg }
      });
      return errorResult;
    }
  },

  examples: [
    [
      { name: "{{user}}", content: { text: "do I have enough USDC to swap?" } },
      { name: "{{agent}}", content: { text: " Checking your USDC balance...", action: "CHECK_TOKEN_BALANCE", token: "USDC" } },
    ],
    [
      { name: "{{user}}", content: { text: "check if I have 1 ETH on base" } },
      { name: "{{agent}}", content: { text: " Checking ETH balance on base...", action: "CHECK_TOKEN_BALANCE", token: "ETH", chain: "base", minAmount: "1" } },
    ],
    [
      { name: "{{user}}", content: { text: "verify I have 100 BNKR before swapping" } },
      { name: "{{agent}}", content: { text: " Verifying BNKR balance...", action: "CHECK_TOKEN_BALANCE", token: "BNKR", minAmount: "100" } },
    ],
    [
      { name: "{{user}}", content: { text: "can I afford to send 0.5 ETH?" } },
      { name: "{{agent}}", content: { text: " Checking if you have 0.5 ETH...", action: "CHECK_TOKEN_BALANCE", token: "ETH", minAmount: "0.5" } },
    ],
  ],
};

export default cdpWalletCheckBalance;

