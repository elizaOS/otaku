import type { Plugin } from "@elizaos/core";
import { RelayService } from "./services/relay.service";
import { relayQuoteAction, relayBridgeAction, relayStatusAction } from "./actions";

export const relayPlugin: Plugin = {
  name: "relay",
  description:
    "Relay Link integration for cross-chain bridging, swapping, and execution using the Relay protocol",
  actions: [relayQuoteAction, relayBridgeAction, relayStatusAction],
  services: [RelayService],
  evaluators: [],
  providers: [],
};

export default relayPlugin;

// Re-export types for external use
export * from "./types";
export { RelayService } from "./services/relay.service";

// Re-export matcher for context-aware action activation
export { shouldRelayPluginBeInContext, relayKeywordPatterns } from "../matcher";
