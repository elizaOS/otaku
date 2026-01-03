import type { Plugin } from "@elizaos/core";
import { logger } from "@elizaos/core";

// Import services
import { ClankerService } from "./services";

// Import actions
import { tokenDeployAction } from "./actions";

// Import matcher
import { shouldClankerPluginBeInContext } from "../matcher";

export const clankerPlugin: Plugin = {
  name: "plugin-clanker",
  description:
    "Clanker protocol integration for token deployment and trading on Base L2",

  async init() {
    logger.info("Initializing Clanker plugin...");
  },

  // Services that manage state and external integrations
  services: [ClankerService],

  // Actions that handle user commands
  actions: [tokenDeployAction, 
    // tokenInfoAction
  ],

  // Providers that supply context
  providers: [],

  // Evaluators for post-interaction processing
  evaluators: [],
};

export default clankerPlugin;
