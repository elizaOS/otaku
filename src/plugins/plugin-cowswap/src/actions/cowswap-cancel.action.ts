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
import { getEntityWallet } from "../../../../utils/entity"

export const cowswapCancelAction: Action = {
  name: "CANCEL_COWSWAP_ORDER",
  similes: ["COWSWAP_CANCEL", "CANCEL_ORDER"],
  description: "Cancel a pending CowSwap order",

  parameters: {
    orderUid: { type: "string", description: "Order UID to cancel", required: true },
    chainId: { type: "number", description: "Chain ID", required: false },
  },

  validate: async (runtime: IAgentRuntime) => {
    const service = runtime.getService(CowSwapService.serviceType)
    return !!service
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    options?: Record<string, unknown>,
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    try {
      const service = runtime.getService(CowSwapService.serviceType) as CowSwapService
      const composedState = await runtime.composeState(message, ["ACTION_STATE"], true)
      const params = composedState?.data?.actionParams ?? {}

      const wallet = await getEntityWallet(runtime as any, message, "CANCEL_COWSWAP_ORDER", callback)
      if (wallet.success === false) return wallet.result as ActionResult

      const cdp = runtime.getService("CDP_SERVICE") as any
      const viemClient = await cdp.getViemClientsForAccount({
        accountName: wallet.metadata?.accountName,
        network: params.chainId ? String(params.chainId) : "1",
      })

      await service.cancelOrder(
        params.orderUid,
        params.chainId || 1,
        viemClient.walletClient
      )

      return {
        text: ` Order ${params.orderUid} cancelled successfully`,
        success: true,
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      return { text: ` Error: ${errorMsg}`, success: false, error: "execution_failed" }
    }
  },

  examples: [[
    { name: "{{user1}}", content: { text: "Cancel order 0x123" } },
    { name: "{{agent}}", content: { text: " Cancelled!", action: "CANCEL_COWSWAP_ORDER" } },
  ]],
}

export default cowswapCancelAction
