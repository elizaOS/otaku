import {
  Action,
  ActionResult,
  HandlerCallback,
  IAgentRuntime,
  Memory,
  State,
  logger,
} from "@elizaos/core";
import { validateCoingeckoService, getCoingeckoService } from "../utils/actionHelpers";

export const getNFTCollectionStatsAction: Action = {
  name: "GET_NFT_COLLECTION_STATS",
  similes: [
    "NFT_STATS",
    "NFT_COLLECTION_INFO",
    "NFT_FLOOR_PRICE",
    "NFT_COLLECTION_DATA",
    "NFT_VOLUME",
  ],
  description:
    "Use this action when the user asks about NFT collection statistics including floor price, market cap, volume, sales, number of owners, and other collection metrics. Accepts NFT collection ID, name, or contract address.",

  // Parameter schema for tool calling
  parameters: {
    collection: {
      type: "string",
      description: "NFT collection identifier (collection ID, name, or contract address). Examples: 'cryptopunks', 'bored-ape-yacht-club', '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d'",
      required: true,
    },
  },

  validate: async (runtime: IAgentRuntime, message: Memory, state?: State): Promise<boolean> => {
    return validateCoingeckoService(runtime, "GET_NFT_COLLECTION_STATS", state, message);
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: any,
    callback?: HandlerCallback,
  ): Promise<ActionResult> => {
    try {
      const svc = getCoingeckoService(runtime);
      if (!svc) {
        throw new Error("CoinGeckoService not available");
      }

      // Read parameters from state (extracted by multiStepDecisionTemplate)
      const composedState = await runtime.composeState(message, ["ACTION_STATE"], true);
      const params = composedState?.data?.actionParams || {};

      // Extract and validate collection parameter (required)
      const collectionRaw: string | undefined = params?.collection?.trim();

      if (!collectionRaw) {
        const errorMsg = "Missing required parameter 'collection'. Please specify which NFT collection to fetch stats for (e.g., 'cryptopunks', 'bored-ape-yacht-club', or a contract address).";
        logger.error(`[GET_NFT_COLLECTION_STATS] ${errorMsg}`);
        const errorResult: ActionResult = {
          text: errorMsg,
          success: false,
          error: "missing_required_parameter",
        };
        if (callback) {
          await callback({
            text: errorResult.text,
            content: { error: "missing_required_parameter", details: errorMsg },
          });
        }
        return errorResult;
      }

      logger.info(`[GET_NFT_COLLECTION_STATS] Fetching stats for collection: ${collectionRaw}`);

      // Store input parameters for return
      const inputParams = { collection: collectionRaw };

      // Fetch NFT collection stats
      const stats = await svc.getNFTCollectionStats(collectionRaw);

      const text = `Retrieved stats for NFT collection: ${stats.name || collectionRaw}`;

      if (callback) {
        await callback({
          text,
          actions: ["GET_NFT_COLLECTION_STATS"],
          content: stats as any,
          source: message.content.source,
        });
      }

      return {
        text,
        success: true,
        data: stats,
        values: stats,
        input: inputParams,
      } as ActionResult & { input: typeof inputParams };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`[GET_NFT_COLLECTION_STATS] Action failed: ${msg}`);
      
      // Try to capture input params even in failure
      const composedState = await runtime.composeState(message, ["ACTION_STATE"], true);
      const params = composedState?.data?.actionParams || {};
      const failureInputParams = {
        collection: params?.collection,
      };
      
      // Provide helpful error message
      const errorText = `Failed to fetch NFT collection stats: ${msg}

Please provide a valid NFT collection identifier:
- Collection ID (e.g., 'cryptopunks', 'bored-ape-yacht-club', 'azuki')
- Contract address (e.g., '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d')

Example: "Get stats for cryptopunks" or "Show me floor price for bored-ape-yacht-club"`;
      
      const errorResult: ActionResult = {
        text: errorText,
        success: false,
        error: msg,
        input: failureInputParams,
      } as ActionResult & { input: typeof failureInputParams };
      
      if (callback) {
        await callback({
          text: errorResult.text,
          content: { error: "action_failed", details: msg },
        });
      }
      return errorResult;
    }
  },

  examples: [
    [
      {
        name: "{{user}}",
        content: { text: "What's the floor price of CryptoPunks?" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Retrieved stats for NFT collection: CryptoPunks",
          actions: ["GET_NFT_COLLECTION_STATS"],
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: { text: "Show me stats for bored-ape-yacht-club" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Retrieved stats for NFT collection: Bored Ape Yacht Club",
          actions: ["GET_NFT_COLLECTION_STATS"],
        },
      },
    ],
  ],
};

