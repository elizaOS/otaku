import type { Plugin, IAgentRuntime } from "@elizaos/core";
import { logger } from "@elizaos/core";

// Import services
import { MorphoService } from "./services";

// Import actions
import {
  marketInfoAction,
  marketPositionsAction,
  marketTransferAction,
  vaultPositionsAction,
  vaultInfoAction,
  vaultTransferAction,
} from "./actions";

export const morphoPlugin: Plugin = {
  name: "plugin-morpho",
  description:
    "Morpho protocol integration for optimized lending and borrowing through peer-to-peer matching",

  async init(): Promise<void> {
    logger.info("Initializing Morpho plugin...");
  },

  // Services that manage state and external integrations
  services: [MorphoService],

  // Actions that handle user commands
  actions: [
    marketInfoAction,
    marketPositionsAction,
    marketTransferAction,
    vaultPositionsAction,
    vaultInfoAction,
    vaultTransferAction,
  ],

  // Providers that supply read-only context
  providers: [],

  // Evaluators for post-interaction analysis
  evaluators: [],
};

export default morphoPlugin;
