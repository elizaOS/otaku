/**
 * GET_POLYMARKET_BALANCE Action
 *
 * Get user's USDC balance and total portfolio value on Polymarket
 */

import {
  type Action,
  type IAgentRuntime,
  type Memory,
  type State,
  type HandlerCallback,
  type ActionResult,
  logger,
} from "@elizaos/core";
import { PolymarketService } from "../services/polymarket.service";
import { shouldPolymarketPluginBeInContext } from "../../matcher";
import {
  validatePolymarketService,
  getPolymarketService,
  extractActionParams,
  isValidEthereumAddress,
} from "../utils/actionHelpers";

interface GetUserBalanceParams {
  walletAddress?: string;
}

type GetUserBalanceInput = {
  walletAddress?: string;
};

type GetUserBalanceActionResult = ActionResult & { input: GetUserBalanceInput };

export const getUserBalanceAction: Action = {
  name: "GET_POLYMARKET_BALANCE",
  similes: [
    "POLYMARKET_BALANCE",
    "MY_BALANCE",
    "PORTFOLIO_VALUE",
    "POLYMARKET_FUNDS",
    "CHECK_BALANCE",
    "AVAILABLE_FUNDS",
    "WALLET_BALANCE",
  ],
  description:
    "Get user's USDC balance and total portfolio value on Polymarket. Shows available balance, positions value, and profit/loss.",

  parameters: {
    walletAddress: {
      type: "string",
      description: "Wallet address (EOA or proxy) to check balance for",
      required: false,
    },
  },

  validate: async (runtime: IAgentRuntime, message: Memory, state?: State) => {
    return validatePolymarketService(runtime, "GET_POLYMARKET_BALANCE", state, message);
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    try {
      logger.info("[GET_POLYMARKET_BALANCE] Getting user balance");

      // Read parameters from state
      const params = await extractActionParams<GetUserBalanceParams>(runtime, message);

      // Extract wallet address
      const walletAddress = params.walletAddress?.trim();

      if (!walletAddress) {
        const errorMsg = "Wallet address is required";
        logger.error(`[GET_POLYMARKET_BALANCE] ${errorMsg}`);
        const errorResult: GetUserBalanceActionResult = {
          text: ` ${errorMsg}. Please provide a wallet address to check balance.`,
          success: false,
          error: "missing_wallet_address",
          input: { walletAddress },
        };
        callback?.({
          text: errorResult.text,
          content: { error: "missing_wallet_address", details: errorMsg },
        });
        return errorResult;
      }

      // Validate address format (basic Ethereum address check)
      if (!isValidEthereumAddress(walletAddress)) {
        const errorMsg = `Invalid wallet address format: ${walletAddress}`;
        logger.error(`[GET_POLYMARKET_BALANCE] ${errorMsg}`);
        const errorResult: GetUserBalanceActionResult = {
          text: ` ${errorMsg}`,
          success: false,
          error: "invalid_wallet_address",
          input: { walletAddress },
        };
        callback?.({
          text: errorResult.text,
          content: { error: "invalid_wallet_address", details: errorMsg },
        });
        return errorResult;
      }

      const inputParams: GetUserBalanceInput = { walletAddress };

      // Get service
      const service = getPolymarketService(runtime);

      if (!service) {
        const errorMsg = "Polymarket service not available";
        logger.error(`[GET_POLYMARKET_BALANCE] ${errorMsg}`);
        const errorResult: GetUserBalanceActionResult = {
          text: ` ${errorMsg}`,
          success: false,
          error: "service_unavailable",
          input: inputParams,
        };
        callback?.({
          text: errorResult.text,
          content: { error: "service_unavailable", details: errorMsg },
        });
        return errorResult;
      }

      // Fetch user balance
      logger.info(`[GET_POLYMARKET_BALANCE] Fetching balance for ${walletAddress}`);
      const balance = await service.getUserBalance(walletAddress);

      // Parse values
      const totalValue = parseFloat(balance.total_value);
      const availableBalance = parseFloat(balance.available_balance);
      const positionsValue = parseFloat(balance.positions_value);
      const realizedPnl = parseFloat(balance.realized_pnl);
      const unrealizedPnl = parseFloat(balance.unrealized_pnl);

      // Format response
      let text = ` **Polymarket Balance for ${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}**\n\n`;

      text += `**Portfolio Summary:**\n`;
      text += `   Total Value: $${totalValue.toFixed(2)}\n`;
      text += `   Available USDC: $${availableBalance.toFixed(2)}\n`;
      text += `   In Positions: $${positionsValue.toFixed(2)}\n\n`;

      text += `**Profit & Loss:**\n`;
      const realizedSign = realizedPnl >= 0 ? "+" : "";
      const unrealizedSign = unrealizedPnl >= 0 ? "+" : "";
      const totalPnl = realizedPnl + unrealizedPnl;
      const totalSign = totalPnl >= 0 ? "+" : "";

      text += `   Realized: ${realizedSign}$${realizedPnl.toFixed(2)}\n`;
      text += `   Unrealized: ${unrealizedSign}$${unrealizedPnl.toFixed(2)}\n`;
      text += `   Total: ${totalSign}$${totalPnl.toFixed(2)}\n`;

      const result: GetUserBalanceActionResult = {
        text,
        success: true,
        data: {
          total_value: totalValue.toFixed(2),
          available_balance: availableBalance.toFixed(2),
          positions_value: positionsValue.toFixed(2),
          realized_pnl: realizedPnl.toFixed(2),
          unrealized_pnl: unrealizedPnl.toFixed(2),
          total_pnl: totalPnl.toFixed(2),
        },
        input: inputParams,
      };

      logger.info(
        `[GET_POLYMARKET_BALANCE] Successfully fetched balance - Total: $${totalValue.toFixed(2)}`
      );
      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`[GET_POLYMARKET_BALANCE] Error: ${errorMsg}`);
      const errorResult: ActionResult = {
        text: ` Failed to get balance: ${errorMsg}`,
        success: false,
        error: errorMsg,
      };
      callback?.({
        text: errorResult.text,
        content: { error: "fetch_failed", details: errorMsg },
      });
      return errorResult;
    }
  },

  examples: [
    [
      {
        name: "{{user}}",
        content: {
          text: "what's my polymarket balance for 0x1234567890123456789012345678901234567890",
        },
      },
      {
        name: "{{agent}}",
        content: {
          text: " Checking your Polymarket balance...",
          action: "GET_POLYMARKET_BALANCE",
          walletAddress: "0x1234567890123456789012345678901234567890",
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: { text: "how much USDC do I have available on polymarket?" },
      },
      {
        name: "{{agent}}",
        content: {
          text: " Getting your available balance...",
          action: "GET_POLYMARKET_BALANCE",
          walletAddress: "0x1234567890123456789012345678901234567890",
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: { text: "show me my polymarket portfolio value" },
      },
      {
        name: "{{agent}}",
        content: {
          text: " Fetching your portfolio value...",
          action: "GET_POLYMARKET_BALANCE",
          walletAddress: "0x1234567890123456789012345678901234567890",
        },
      },
    ],
  ],
};

export default getUserBalanceAction;
