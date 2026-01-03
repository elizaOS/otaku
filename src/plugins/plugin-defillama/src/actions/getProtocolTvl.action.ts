import {
  Action,
  ActionResult,
  HandlerCallback,
  HandlerOptions,
  IAgentRuntime,
  Memory,
  State,
  logger,
} from "@elizaos/core";
import { DefiLlamaService, type ProtocolLookupResult, type ProtocolSummary } from "../services/defillama.service";
import { validateDefillamaService, getDefillamaService, extractActionParams } from "../utils/actionHelpers";

// Extend Action type to support parameter schemas for tool calling

export const getProtocolTvlAction: Action = {
  name: "GET_PROTOCOL_TVL",
  similes: [
    "PROTOCOL_TVL",
    "COMPARE_TVL",
    "DEFILLAMA_PROTOCOL_TVL",
    "TVL",
  ],
  description:
    "Use this action to fetch DeFi protocol TVL and change metrics by protocol name or symbol.",

  // Parameter schema for tool calling
  parameters: {
    protocols: {
      type: "string",
      description: "Comma-separated list of DeFi protocol names or symbols (e.g., 'Aave,Curve' or 'EIGEN,MORPHO')",
      required: true,
    },
  },

  validate: async (runtime: IAgentRuntime, message: Memory, state?: State): Promise<boolean> => {
    return validateDefillamaService(runtime, "GET_PROTOCOL_TVL", state, message);
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: HandlerOptions,
    callback?: HandlerCallback,
  ): Promise<ActionResult> => {
    try {
      const svc = getDefillamaService(runtime);
      if (!svc) {
        throw new Error("DefiLlamaService not available");
      }

      // Read parameters from state (extracted by multiStepDecisionTemplate)
      const params = await extractActionParams<{ protocols?: string }>(runtime, message);

      // Extract and validate protocols parameter (required)
      const protocolsRaw: string | undefined = params?.protocols?.trim();

      if (!protocolsRaw) {
        const errorMsg = "Missing required parameter 'protocols'. Please specify which DeFi protocol(s) to fetch TVL for (e.g., 'Aave,Curve' or 'EIGEN,MORPHO').";
        logger.error(`[GET_PROTOCOL_TVL] ${errorMsg}`);
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

      // Parse comma-separated protocol names
      const names = protocolsRaw
        .split(",")
        .map((s: string) => s.trim())
        .filter(Boolean);

      if (!names.length) {
        const errorMsg = "No valid protocol names found. Please provide DeFi protocol names or symbols.";
        logger.error(`[GET_PROTOCOL_TVL] ${errorMsg}`);
        const errorResult: ActionResult = {
          text: errorMsg,
          success: false,
          error: "invalid_parameter",
        };
        if (callback) {
          await callback({
            text: errorResult.text,
            content: { error: "invalid_parameter", details: errorMsg },
          });
        }
        return errorResult;
      }

      logger.info(`[GET_PROTOCOL_TVL] Fetching TVL for: ${names.join(", ")}`);

      // Store input parameters for return
      const inputParams = { protocols: protocolsRaw };

      // Fetch protocol TVL data
      const results = await svc.getProtocolsByNames(names);

      if (!Array.isArray(results) || results.length === 0) {
        const errorMsg = "No protocols matched the provided names";
        logger.error(`[GET_PROTOCOL_TVL] ${errorMsg}`);
        const errorResult: ActionResult = {
          text: errorMsg,
          success: false,
          error: "no_results",
          input: inputParams,
        } as ActionResult & { input: typeof inputParams };
        if (callback) {
          await callback({
            text: errorResult.text,
            content: { error: "no_results", details: errorMsg },
          });
        }
        return errorResult;
      }

      const successes = results.filter(
        (result): result is ProtocolLookupResult & { data: ProtocolSummary } => Boolean(result.success && result.data)
      );
      const failed = results.filter((result) => !result.success);
      
      if (successes.length === 0) {
        const errorMsg = "No protocols matched the provided names";
        logger.error(`[GET_PROTOCOL_TVL] ${errorMsg}`);
        const errorResult: ActionResult = {
          text: errorMsg,
          success: false,
          error: "no_matches",
          input: inputParams,
        } as ActionResult & { input: typeof inputParams };
        if (callback) {
          await callback({
            text: errorResult.text,
            content: { error: "no_matches", details: errorMsg },
          });
        }
        return errorResult;
      }

      const messageText = failed.length > 0
        ? `Fetched TVL for ${successes.length} protocol(s); ${failed.length} not matched`
        : `Fetched TVL for ${successes.length} protocol(s)`;

      if (callback) {
        await callback({
          text: messageText,
          actions: ["GET_PROTOCOL_TVL"],
          content: results,
          source: message.content.source,
        });
      }

      return {
        text: messageText,
        success: true,
        data: results,
        values: successes.map((r) => r.data),
        input: inputParams,
      } as ActionResult & { input: typeof inputParams };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`[GET_PROTOCOL_TVL] Action failed: ${msg}`);
      
      // Try to capture input params even in failure
      const params = await extractActionParams<{ protocols?: string }>(runtime, message);
      const failureInputParams = {
        protocols: params?.protocols,
      };
      
      const errorResult: ActionResult = {
        text: `Failed to fetch protocol TVL: ${msg}`,
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
        content: { text: "Compare EIGEN and MORPHO TVL" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Fetched TVL for 2 protocol(s)",
          actions: ["GET_PROTOCOL_TVL"],
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: { text: "What is the TVL of Aave and Curve?" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Fetched TVL for 2 protocol(s)",
          actions: ["GET_PROTOCOL_TVL"],
        },
      },
    ],
  ],
};


