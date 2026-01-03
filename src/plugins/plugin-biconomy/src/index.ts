import type { Plugin } from "@elizaos/core";
import {
  meeFusionSwapAction,
  meeSupertransactionRebalanceAction,
  meeSupertransactionStatusAction,
  biconomyWithdrawAllAction,
  meeCcipBridgeAction
} from "./actions/index";
import { BiconomyService } from "./services/biconomy.service";

/**
 * MEE (Modular Execution Environment) Plugin
 * 
 * Provides Biconomy MEE integration for gasless cross-chain operations:
 * - Gasless swaps - gas is paid from the input token
 * - Cross-chain token swaps and bridges via Fusion
 * - Multi-output portfolio rebalancing via Supertransactions
 * - CCIP token bridging via Chainlink
 * 
 * Actions:
 * - MEE_FUSION_SWAP: Gasless cross-chain token swap (single input → single output)
 * - MEE_CCIP_BRIDGE: Bridge tokens across chains using Chainlink CCIP
 * - MEE_SUPERTRANSACTION_REBALANCE: Gasless multi-chain portfolio rebalancing (single input → multiple weighted outputs)
 * - MEE_SUPERTRANSACTION_STATUS: Track supertransaction status
 * - BICONOMY_WITHDRAW_ALL: Withdraw all tokens from Nexus companion wallet to user address
 * 
 * Supported Chains:
 * Ethereum, Base, Arbitrum, Polygon, Optimism, BSC, Scroll, Gnosis, Sonic,
 * Linea, Blast, Sei, Unichain, Worldchain, Lisk, and more.
 * 
 * @see https://docs.biconomy.io
 */
export const meePlugin: Plugin = {
  name: "mee",
  description:
    "Biconomy MEE (Modular Execution Environment) plugin for gasless cross-chain swaps, CCIP bridging, and portfolio rebalancing",
  actions: [meeFusionSwapAction, biconomyWithdrawAllAction, meeSupertransactionRebalanceAction, meeSupertransactionStatusAction],
  services: [BiconomyService],
  evaluators: [],
  providers: [],
};

export default meePlugin;

// Re-export types and service for external use
export { BiconomyService } from "./services/biconomy.service";
export * from "./types";
export { shouldBiconomyPluginBeInContext } from "./matcher";

