import type { Plugin } from "@elizaos/core"
import { CowSwapService } from "./services/cowswap.service"
import {
  cowswapOrderStatusAction,
  cowswapQuoteAction,
  cowswapSwapAction,
  cowswapLimitAction,
  cowswapCancelAction,
  cowswapBridgeAction,
} from "./actions"

export const cowswapPlugin: Plugin = {
  name: "cowswap",
  description:
    "CowSwap integration for MEV-protected token swaps on multiple chains. Get quotes, execute swaps, create limit orders, cross-chain bridges, and track order status. Supports Ethereum, Base, Arbitrum, Polygon, and Gnosis.",
  actions: [
    cowswapQuoteAction,
    cowswapSwapAction,
    cowswapBridgeAction,
    cowswapLimitAction,
    cowswapOrderStatusAction,
    cowswapCancelAction,
  ],
  services: [CowSwapService],
  evaluators: [],
  providers: [],
}

export default cowswapPlugin

// Re-export types
export * from "./types"
export { CowSwapService } from "./services/cowswap.service"
