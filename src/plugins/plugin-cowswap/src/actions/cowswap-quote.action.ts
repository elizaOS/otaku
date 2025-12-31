import {
  type Action,
  type IAgentRuntime,
  type Memory,
  type State,
  type HandlerCallback,
  type ActionResult,
  logger,
} from "@elizaos/core"
import { CowSwapService } from "../services/cowswap.service"
import type { CowSwapQuoteParams } from "../types"

type QuoteInput = {
  sellToken: string
  buyToken: string
  amount: string
  kind?: string
  chainId?: number
}

type QuoteActionResult = ActionResult & { input: QuoteInput }

export const cowswapQuoteAction: Action = {
  name: "GET_COWSWAP_QUOTE",
  similes: [
    "QUOTE_COWSWAP",
    "GET_SWAP_QUOTE",
    "CHECK_COWSWAP_PRICE",
    "CREATE_QUOTE_ORDER",
  ],
  description:
    "Get a price quote for a token swap on CowSwap without executing. Returns quote ID, amounts, fees. Use before executing.",

  parameters: {
    sellToken: {
      type: "string",
      description: "Token to sell (symbol like 'USDC' or address '0x...')",
      required: true,
    },
    buyToken: {
      type: "string",
      description: "Token to buy (symbol like 'ETH' or address '0x...')",
      required: true,
    },
    amount: {
      type: "string",
      description: "Amount to swap (human-readable, e.g., '100')",
      required: true,
    },
    kind: {
      type: "string",
      description: "Order kind: 'SELL' or 'BUY'. Default: SELL",
      required: false,
    },
    chainId: {
      type: "number",
      description: "Chain ID (1=Ethereum, 8453=Base, etc). Default: 1",
      required: false,
    },
  },

  validate: async (runtime: IAgentRuntime, message: Memory) => {
    try {
      const service = runtime.getService(
        CowSwapService.serviceType
      ) as CowSwapService

      if (!service) {
        logger.warn("[GET_COWSWAP_QUOTE] CowSwap service not available")
        return false
      }

      return true
    } catch (error) {
      logger.error(
        "[GET_COWSWAP_QUOTE] Error validating:",
        error instanceof Error ? error.message : String(error)
      )
      return false
    }
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    options?: Record<string, unknown>,
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    try {
      logger.info("[GET_COWSWAP_QUOTE] Handler invoked")

      const service = runtime.getService(
        CowSwapService.serviceType
      ) as CowSwapService

      if (!service) {
        const errorMsg = "CowSwap service not initialized"
        logger.error(`[GET_COWSWAP_QUOTE] ${errorMsg}`)
        return {
          text: ` ${errorMsg}`,
          success: false,
          error: "service_unavailable",
        }
      }

      const composedState = await runtime.composeState(
        message,
        ["ACTION_STATE"],
        true
      )
      const params = (composedState?.data?.actionParams ?? {}) as Partial<CowSwapQuoteParams>

      const sellToken = params.sellToken?.trim()
      const buyToken = params.buyToken?.trim()
      const amount = params.amount?.trim()

      if (!sellToken || !buyToken || !amount) {
        const errorMsg = "Missing required parameters"
        const errorResult: QuoteActionResult = {
          text: ` ${errorMsg}`,
          success: false,
          error: "missing_parameter",
          input: { sellToken: sellToken || "", buyToken: buyToken || "", amount: amount || "" },
        }
        return errorResult
      }

      const inputParams: QuoteInput = {
        sellToken,
        buyToken,
        amount,
        kind: params.kind,
        chainId: params.chainId,
      }

      const result = await service.getQuote(
        {
          sellToken,
          buyToken,
          amount,
          kind: (params.kind as "SELL" | "BUY") || "SELL",
          chainId: params.chainId,
        },
        runtime
      )

      const text = ` Quote (ID: ${result.quoteId}): ${amount} ${result.sellToken.symbol} -> ${result.buyToken.symbol}. Valid for 20 minutes.`

      const successResult: QuoteActionResult = {
        text,
        success: true,
        data: result,
        input: inputParams,
      }
      return successResult
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      const errorResult: QuoteActionResult = {
        text: ` Error: ${errorMsg}`,
        success: false,
        error: "execution_failed",
        input: { sellToken: "", buyToken: "", amount: "" },
      }
      return errorResult
    }
  },

  examples: [
    [
      {
        name: "{{user1}}",
        content: { text: "Quote 100 USDC to ETH on Base" },
      },
      {
        name: "{{agent}}",
        content: {
          text: " Quote: 100 USDC -> ETH",
          action: "GET_COWSWAP_QUOTE",
        },
      },
    ],
  ],
}

export default cowswapQuoteAction
