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
import type { CowSwapOrderStatusParams } from "../types"

type OrderStatusInput = {
  orderUid: string
  chainId?: number
}

type OrderStatusActionResult = ActionResult & { input: OrderStatusInput }

export const cowswapOrderStatusAction: Action = {
  name: "CHECK_COWSWAP_ORDER_STATUS",
  similes: [
    "COWSWAP_ORDER_STATUS",
    "CHECK_ORDER",
    "TRACK_COWSWAP_ORDER",
    "GET_ORDER_STATUS",
    "ORDER_STATUS",
  ],
  description:
    "Check the status of a CowSwap order. Use this when the user wants to track their swap or limit order execution. Returns order status, execution details, and transaction hash if settled.",

  parameters: {
    orderUid: {
      type: "string",
      description: "The unique order identifier (UID) from order creation",
      required: true,
    },
    chainId: {
      type: "number",
      description:
        "The chain ID where the order was placed (1=Ethereum, 100=Gnosis, 42161=Arbitrum, 8453=Base, 137=Polygon)",
      required: false,
    },
  },

  validate: async (runtime: IAgentRuntime, message: Memory) => {
    try {
      const service = runtime.getService(
        CowSwapService.serviceType
      ) as CowSwapService

      if (!service) {
        logger.warn("[CHECK_COWSWAP_ORDER_STATUS] CowSwap service not available")
        return false
      }

      return true
    } catch (error) {
      logger.error(
        "[CHECK_COWSWAP_ORDER_STATUS] Error validating:",
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
      logger.info("[CHECK_COWSWAP_ORDER_STATUS] Handler invoked")

      // Get service
      const service = runtime.getService(
        CowSwapService.serviceType
      ) as CowSwapService

      if (!service) {
        const errorMsg = "CowSwap service not initialized"
        logger.error(`[CHECK_COWSWAP_ORDER_STATUS] ${errorMsg}`)
        callback?.({
          text: ` ${errorMsg}`,
          content: { error: "service_unavailable", details: errorMsg },
        })
        return {
          text: ` ${errorMsg}`,
          success: false,
          error: "service_unavailable",
        }
      }

      // Read parameters from composed state
      const composedState = await runtime.composeState(
        message,
        ["ACTION_STATE"],
        true
      )
      const params = (composedState?.data?.actionParams ?? {}) as Partial<CowSwapOrderStatusParams>

      // Validate required parameters
      const orderUid = params.orderUid?.trim()
      if (!orderUid) {
        const errorMsg = "orderUid is required. Please provide the order UID from when you created the order."
        logger.error(`[CHECK_COWSWAP_ORDER_STATUS] ${errorMsg}`)
        callback?.({
          text: ` ${errorMsg}`,
          content: { error: "missing_parameter", details: errorMsg },
        })
        const errorResult: OrderStatusActionResult = {
          text: ` ${errorMsg}`,
          success: false,
          error: "missing_parameter",
          input: { orderUid: orderUid || "" },
        }
        return errorResult
      }

      // Default to Ethereum if chainId not provided
      const chainId = params.chainId || 1

      const inputParams = { orderUid, chainId }

      logger.info(
        `[CHECK_COWSWAP_ORDER_STATUS] Checking status for order ${orderUid} on chain ${chainId}`
      )

      // Get order status from service
      const result = await service.getOrderStatus(orderUid, chainId)

      // Format response text
      let text = ` Order Status for ${orderUid}:\n\n`
      text += `Status: ${result.status}\n`
      text += `Created: ${new Date(result.creationTime).toLocaleString()}\n`

      if (result.executedBuyAmount) {
        text += `Executed Buy Amount: ${result.executedBuyAmount}\n`
      }
      if (result.executedSellAmount) {
        text += `Executed Sell Amount: ${result.executedSellAmount}\n`
      }
      if (result.executedFeeAmount) {
        text += `Fee Paid: ${result.executedFeeAmount}\n`
      }
      if (result.surplus) {
        text += `Surplus Captured: ${result.surplus}\n`
      }
      if (result.txHash) {
        text += `Transaction Hash: ${result.txHash}\n`
      }

      text += `\nView on Explorer: ${result.explorerUrl}`

      callback?.({
        text,
        content: { success: true, data: result },
      })

      const successResult: OrderStatusActionResult = {
        text,
        success: true,
        data: result,
        input: inputParams,
      }
      return successResult
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      logger.error(`[CHECK_COWSWAP_ORDER_STATUS] Error: ${errorMsg}`)

      // Try to capture input even on failure
      let catchFailureInput = {}
      try {
        const composedState = await runtime.composeState(
          message,
          ["ACTION_STATE"],
          true
        )
        const params = composedState?.data?.actionParams || {}
        catchFailureInput = {
          orderUid: params?.orderUid,
          chainId: params?.chainId,
        }
      } catch (e) {
        // Continue with empty object
      }

      callback?.({
        text: ` Error checking order status: ${errorMsg}`,
        content: { error: "execution_failed", details: errorMsg },
      })

      const errorResult: OrderStatusActionResult = {
        text: ` Error checking order status: ${errorMsg}`,
        success: false,
        error: "execution_failed",
        input: catchFailureInput as OrderStatusInput,
      }
      return errorResult
    }
  },

  examples: [
    [
      {
        name: "{{user1}}",
        content: {
          text: "Check my CowSwap order status 0x1234567890abcdef",
        },
      },
      {
        name: "{{agent}}",
        content: {
          text: " Order Status: PENDING - Your order is waiting to be filled by the solvers.",
          action: "CHECK_COWSWAP_ORDER_STATUS",
        },
      },
    ],
    [
      {
        name: "{{user1}}",
        content: {
          text: "What's the status of order 0xabc123def456 on Base?",
        },
      },
      {
        name: "{{agent}}",
        content: {
          text: " Order Status: FULFILLED - Your order has been executed successfully!",
          action: "CHECK_COWSWAP_ORDER_STATUS",
        },
      },
    ],
  ],
}

export default cowswapOrderStatusAction
