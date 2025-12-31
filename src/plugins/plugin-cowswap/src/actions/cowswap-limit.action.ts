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

export const cowswapLimitAction: Action = {
  name: "CREATE_COWSWAP_LIMIT_ORDER",
  similes: ["COWSWAP_LIMIT", "LIMIT_ORDER"],
  description: "Create a limit order on CowSwap",

  parameters: {
    sellToken: { type: "string", description: "Token to sell", required: true },
    buyToken: { type: "string", description: "Token to buy", required: true },
    sellAmount: { type: "string", description: "Sell amount", required: true },
    buyAmount: { type: "string", description: "Buy amount (target)", required: true },
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

      const wallet = await getEntityWallet(runtime as any, message, "CREATE_COWSWAP_LIMIT_ORDER", callback)
      if (wallet.success === false) return wallet.result as ActionResult

      const cdp = runtime.getService("CDP_SERVICE") as any
      const viemClient = await cdp.getViemClientsForAccount({
        accountName: wallet.metadata?.accountName,
        network: params.chainId ? String(params.chainId) : "1",
      })

      const result = await service.createLimitOrder(
        {
          sellToken: params.sellToken,
          buyToken: params.buyToken,
          sellAmount: params.sellAmount,
          buyAmount: params.buyAmount,
          chainId: params.chainId,
        },
        viemClient.walletClient,
        viemClient.address,
        runtime
      )

      return {
        text: ` Limit order created! Price: ${result.limitPrice}`,
        success: true,
        data: result,
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      return { text: ` Error: ${errorMsg}`, success: false, error: "execution_failed" }
    }
  },

  examples: [[
    { name: "{{user1}}", content: { text: "Create limit order" } },
    { name: "{{agent}}", content: { text: " Done!", action: "CREATE_COWSWAP_LIMIT_ORDER" } },
  ]],
}

export default cowswapLimitAction
