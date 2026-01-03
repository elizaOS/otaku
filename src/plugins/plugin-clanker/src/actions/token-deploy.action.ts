import {
  Action,
  ActionResult,
  HandlerCallback,
  IAgentRuntime,
  Memory,
  ModelType,
  State,
  logger,
  parseKeyValueXml,
  composePromptFromState,
} from "@elizaos/core";
import { z } from "zod";
import { TokenDeploySchema } from "../types";
import { ClankerService } from "../services/clanker.service";
import { shortenAddress } from "../utils/format";
import { handleError } from "../utils/errors";
import { getEntityWallet } from "../../../../utils/entity";
import { validateClankerService, getClankerService, extractActionParams } from "../utils/actionHelpers";

// Utility function to safely serialize objects with BigInt values
function safeStringify(obj: any): any {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === "bigint") {
    return obj.toString();
  }

  if (Array.isArray(obj)) {
    return obj.map(safeStringify);
  }

  if (typeof obj === "object") {
    const result: any = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = safeStringify(value);
    }
    return result;
  }

  return obj;
}


export const tokenDeployAction: Action = {
  name: "DEPLOY_TOKEN",
  similes: ["CREATE_TOKEN", "LAUNCH_TOKEN", "MINT_TOKEN"],
  description: "Use this action when you need to deploy a new token on Base via Clanker.",

  parameters: {
    name: {
      type: "string",
      description: "Token name (e.g., 'Based Token')",
      required: true,
    },
    symbol: {
      type: "string",
      description: "Token symbol (e.g., 'BASE'). Will be automatically uppercased.",
      required: true,
    },
    tokenAdmin: {
      type: "string",
      description: "Admin address for the token (optional)",
      required: false,
    },
    vanity: {
      type: "boolean",
      description: "Whether to use vanity address (optional, default: false)",
      required: false,
    },
    image: {
      type: "string",
      description: "Image URL for the token (optional)",
      required: false,
    },
    description: {
      type: "string",
      description: "Token description for metadata (optional)",
      required: false,
    },
    socialMediaUrls: {
      type: "string",
      description: "Comma-separated list of social media URLs (e.g., 'https://twitter.com/token,https://discord.gg/token'). Optional.",
      required: false,
    },
    devBuy: {
      type: "string",
      description: "Amount of ETH to spend on initial token purchase (e.g., '0.1' for 0.1 ETH). Optional.",
      required: false,
    },
  },

  validate: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State | undefined,
  ): Promise<boolean> => {
    return validateClankerService(runtime, "DEPLOY_TOKEN", state, message);
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    _options: any,
    callback?: HandlerCallback,
    _responses?: Memory[],
  ): Promise<ActionResult> => {
    try {
      logger.info("Handling DEPLOY_TOKEN action");

      // Get services
      const clankerService = runtime.getService(
        ClankerService.serviceType,
      ) as ClankerService;

      if (!clankerService) {
        throw new Error("Required services not available");
      }

      // Read parameters from state (extracted by multiStepDecisionTemplate)
      const composedState = await runtime.composeState(message, ["ACTION_STATE"], true);
      const params = composedState?.data?.actionParams || {};

      // Store input parameters for return
      const inputParams = {
        name: params.name,
        symbol: params.symbol,
        tokenAdmin: params.tokenAdmin,
        vanity: params.vanity,
        image: params.image,
        description: params.description,
        socialMediaUrls: params.socialMediaUrls,
        devBuy: params.devBuy,
      };

      // Validate required parameters
      if (!params.name?.trim()) {
        const errorMsg = "Missing required parameter 'name'. Please specify the token name.";
        logger.error(`[DEPLOY_TOKEN] ${errorMsg}`);
        const errorResult: ActionResult = {
          text: `❌ ${errorMsg}`,
          success: false,
          error: "missing_required_parameter",
          input: inputParams,
        } as ActionResult & { input: typeof inputParams };
        callback?.({ 
          text: errorResult.text,
          content: { error: "missing_required_parameter", details: errorMsg }
        });
        return errorResult;
      }

      if (!params.symbol?.trim()) {
        const errorMsg = "Missing required parameter 'symbol'. Please specify the token symbol.";
        logger.error(`[DEPLOY_TOKEN] ${errorMsg}`);
        const errorResult: ActionResult = {
          text: `❌ ${errorMsg}`,
          success: false,
          error: "missing_required_parameter",
          input: inputParams,
        } as ActionResult & { input: typeof inputParams };
        callback?.({ 
          text: errorResult.text,
          content: { error: "missing_required_parameter", details: errorMsg }
        });
        return errorResult;
      }

      // Prepare deploy parameters with proper structure
      const deployParamsForValidation = {
        name: params.name.trim(),
        symbol: params.symbol.trim().toUpperCase(),
        tokenAdmin: params.tokenAdmin?.trim(),
        vanity: params.vanity === true,
        image: params.image?.trim(),
        metadata: (params.description || params.socialMediaUrls) ? {
          description: params.description?.trim(),
          socialMediaUrls: params.socialMediaUrls 
            ? params.socialMediaUrls.split(',').map((url: string) => url.trim()).filter(Boolean)
            : undefined,
          auditUrls: [],
        } : undefined,
        devBuy: params.devBuy ? {
          ethAmount: parseFloat(params.devBuy),
        } : undefined,
      };

      // Validate parameters
      const validation = TokenDeploySchema.safeParse(deployParamsForValidation);
      if (!validation.success) {
        const errors = validation.error.issues
          .map((e: z.ZodIssue) => `${e.path.join(".")}: ${e.message}`)
          .join(", ");
        const errorMsg = `Invalid parameters: ${errors}`;
        logger.error(`[DEPLOY_TOKEN] ${errorMsg}`);
        const errorResult: ActionResult = {
          text: `❌ ${errorMsg}`,
          success: false,
          error: "validation_failed",
          input: inputParams,
        } as ActionResult & { input: typeof inputParams };
        callback?.({ 
          text: errorResult.text,
          content: { error: "validation_failed", details: errorMsg }
        });
        return errorResult;
      }

      const deployParams = validation.data;

      const wallet = await getEntityWallet(
        runtime,
        message,
        "DEPLOY_TOKEN",
        callback,
      );

      if (wallet.success === false) {
        logger.error("[DEPLOY_TOKEN] Failed to get entity wallet");
        return {
          ...wallet.result,
          input: inputParams,
        } as ActionResult & { input: typeof inputParams };
      }

      const accountName = wallet.metadata?.accountName as string;
     

      const result = await clankerService.deployToken(
        {
          name: deployParams.name,
          symbol: deployParams.symbol,
          vanity: deployParams.vanity,
          image: deployParams.image,
          metadata: deployParams.metadata,
          context: deployParams.context,
          pool: deployParams.pool,
          fees: deployParams.fees,
          rewards: deployParams.rewards,
          vault: deployParams.vault,
          devBuy: deployParams.devBuy,
        },
        accountName
      );

      // Prepare response
      const responseText =
        `✅ Token deployed successfully!\n\n` +
        `Token: ${deployParams.name} (${deployParams.symbol})\n` +
        `Contract: ${shortenAddress(result.contractAddress)}\n` +
        `Total Supply: 1,000,000,000 ${deployParams.symbol} (1B tokens)\n` +
        `Transaction: ${shortenAddress(result.transactionHash)}\n` +
        `View on Clanker World: https://clanker.world/clanker/${result.contractAddress}\n` +
        `View on BaseScan: https://basescan.org/token/${result.contractAddress}`;

      if (callback) {
        await callback({
          text: responseText,
          actions: ["DEPLOY_TOKEN"],
          source: message.content.source,
        });
      }

      return {
        text: responseText,
        success: true,
        values: {
          tokenDeployed: true,
          contractAddress: result.contractAddress,
          transactionHash: result.transactionHash,
          tokenId: result.tokenId,
          deploymentCost: result.deploymentCost,
          clankerResult: `https://clanker.world/clanker/${result.contractAddress}`,
        },
        data: safeStringify({
          actionName: "DEPLOY_TOKEN",
          contractAddress: result.contractAddress,
          transactionHash: result.transactionHash,
          tokenId: result.tokenId,
          deploymentCost: result.deploymentCost,
          result: result,
        }),
        input: inputParams,
      } as ActionResult & { input: typeof inputParams };
    } catch (error) {
      logger.error(
        "Error in DEPLOY_TOKEN action:",
        error instanceof Error ? error.message : String(error),
      );
      const errorResponse = handleError(error);

      // Try to capture input params even in failure
      let catchFailureInput = {};
      try {
        const composedState = await runtime.composeState(message, ["ACTION_STATE"], true);
        const params = composedState?.data?.actionParams || {};
        catchFailureInput = {
          name: params.name,
          symbol: params.symbol,
          tokenAdmin: params.tokenAdmin,
          vanity: params.vanity,
          image: params.image,
          description: params.description,
          socialMediaUrls: params.socialMediaUrls,
          devBuy: params.devBuy,
        };
      } catch (e) {
        // If we can't get params, just use empty object
      }

      if (callback) {
        await callback({
          text: `❌ Token deployment failed: ${errorResponse.message}`,
          actions: ["DEPLOY_TOKEN"],
          source: message.content.source,
        });
      }

      return {
        text: `❌ Token deployment failed: ${errorResponse.message}`,
        success: false,
        values: {
          tokenDeployed: false,
          error: true,
          errorMessage: errorResponse.message,
        },
        data: safeStringify({
          actionName: "DEPLOY_TOKEN",
          error: error instanceof Error ? error.message : String(error),
          errorStack: error instanceof Error ? error.stack : undefined,
        }),
        error: error instanceof Error ? error : new Error(String(error)),
        input: catchFailureInput,
      } as ActionResult & { input: typeof catchFailureInput };
    }
  },

  examples: [
    [
      {
        name: "{{name1}}",
        content: {
          text: 'Deploy a new token called "Based Token" with symbol BASE and 1 million supply',
        },
      },
      {
        name: "{{name2}}",
        content: {
          text: "✅ Token deployed successfully!\n\nToken: Based Token (BASE)\nContract: 0x1234...5678\nTotal Supply: 1,000,000,000 BASE (1B tokens)\nTransaction: 0xabcd...ef01\nView on Clanker World: https://clanker.world/clanker/0x1234...5678",
          actions: ["DEPLOY_TOKEN"],
        },
      },
    ],
    [
      {
        name: "{{name1}}",
        content: {
          text: "Create a memecoin called PEPE with 69 billion tokens",
        },
      },
      {
        name: "{{name2}}",
        content: {
          text: "✅ Token deployed successfully!\n\nToken: PEPE (PEPE)\nContract: 0x5678...1234\nTotal Supply: 1,000,000,000 PEPE (1B tokens)\nTransaction: 0xef01...abcd\nView on Clanker World: https://clanker.world/clanker/0x5678...1234",
          actions: ["DEPLOY_TOKEN"],
        },
      },
    ],
  ],
};
