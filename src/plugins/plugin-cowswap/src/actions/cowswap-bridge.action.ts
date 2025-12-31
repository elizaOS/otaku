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

export const cowswapBridgeAction: Action = {
  name: "EXECUTE_COWSWAP_BRIDGE",
  similes: ["COWSWAP_BRIDGE", "CROSS_CHAIN_SWAP", "BRIDGE_SWAP"],
  description: "Execute a cross-chain swap via CowSwap bridge integration",

  parameters: {
    sellToken: { type: "string", description: "Token to sell", required: true },
    buyToken: { type: "string", description: "Token to buy", required: true },
    amount: { type: "string", description: "Amount", required: true },
    fromChainId: { type: "number", description: "Source chain ID", required: true },
    toChainId: { type: "number", description: "Destination chain ID", required: true },
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

      const wallet = await getEntityWallet(runtime as any, message, "EXECUTE_COWSWAP_BRIDGE", callback)
      if (wallet.success === false) return wallet.result as ActionResult

      const cdp = runtime.getService("CDP_SERVICE") as any
      const viemClient = await cdp.getViemClientsForAccount({
        accountName: wallet.metadata?.accountName,
        network: String(params.fromChainId || 1),
      })

      const result = await service.executeBridge(
        {
          sellToken: params.sellToken,
          buyToken: params.buyToken,
          amount: params.amount,
          fromChainId: params.fromChainId,
          toChainId: params.toChainId,
        },
        viemClient.walletClient,
        viemClient.address,
        runtime
      )

      return {
        text: ` Cross-chain swap initiated! Order: ${result.orderUid}`,
        success: true,
        data: result,
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      return { text: ` Error: ${errorMsg}`, success: false, error: "execution_failed" }
    }
  },

  examples: [[
    { name: "{{user1}}", content: { text: "Bridge 100 USDC from Base to Ethereum" } },
    { name: "{{agent}}", content: { text: " Bridge executed!", action: "EXECUTE_COWSWAP_BRIDGE" } },
  ]],
}

export default cowswapBridgeAction
