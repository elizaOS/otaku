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

export const cowswapSwapAction: Action = {
  name: "EXECUTE_COWSWAP_SWAP",
  similes: ["COWSWAP_SWAP", "SWAP_ON_COWSWAP", "EXECUTE_SWAP"],
  description: "Execute a swap on CowSwap. Can use existing quote or get fresh one.",

  parameters: {
    quoteId: {
      type: "number",
      description: "Quote ID from GET_COWSWAP_QUOTE",
      required: false,
    },
    sellToken: { type: "string", description: "Token to sell", required: false },
    buyToken: { type: "string", description: "Token to buy", required: false },
    amount: { type: "string", description: "Amount", required: false },
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

      const wallet = await getEntityWallet(runtime as any, message, "EXECUTE_COWSWAP_SWAP", callback)
      if (wallet.success === false) return wallet.result as ActionResult

      const cdp = runtime.getService("CDP_SERVICE") as any
      const viemClient = await cdp.getViemClientsForAccount({
        accountName: wallet.metadata?.accountName,
        network: params.chainId ? String(params.chainId) : "1",
      })

      let result
      if (params.quoteId) {
        result = await service.executeSwapFromQuote(
          { quoteId: params.quoteId, chainId: params.chainId },
          viemClient.walletClient,
          viemClient.address,
          runtime
        )
      } else {
        result = await service.executeSwap(
          {
            sellToken: params.sellToken,
            buyToken: params.buyToken,
            amount: params.amount,
            kind: params.kind || "SELL",
            chainId: params.chainId,
          },
          viemClient.walletClient,
          viemClient.address,
          runtime
        )
      }

      return {
        text: ` Swap executed! Order: ${result.orderUid}`,
        success: true,
        data: result,
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      return { text: ` Error: ${errorMsg}`, success: false, error: "execution_failed" }
    }
  },

  examples: [[
    { name: "{{user1}}", content: { text: "Execute swap" } },
    { name: "{{agent}}", content: { text: " Done!", action: "EXECUTE_COWSWAP_SWAP" } },
  ]],
}

export default cowswapSwapAction
