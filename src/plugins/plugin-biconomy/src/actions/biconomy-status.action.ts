import {
  type Action,
  type IAgentRuntime,
  logger,
  type Memory,
  type State,
  type HandlerCallback,
  type ActionResult,
} from "@elizaos/core";
import { BiconomyService } from "../services/biconomy.service";
import { validateBiconomyService } from "../utils/actionHelpers";

/**
 * MEE Supertransaction Status Action
 * 
 * Track the status of a MEE supertransaction using its hash.
 */
export const meeSupertransactionStatusAction: Action = {
  name: "MEE_SUPERTRANSACTION_STATUS",
  description: "Check the status of a MEE supertransaction using its supertx hash.",
  similes: [
    "MEE_STATUS",
    "SUPERTX_STATUS",
    "TRACK_SUPERTRANSACTION",
  ],

  parameters: {
    supertxHash: {
      type: "string",
      description: "The Biconomy supertransaction hash to check (e.g., 'stx_0x...')",
      required: true,
    },
  },

  validate: async (runtime: IAgentRuntime, message: Memory, state?: State) => {
    return validateBiconomyService(runtime, "MEE_SUPERTRANSACTION_STATUS", state, message);
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    options?: { [key: string]: unknown },
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    logger.info("[MEE_SUPERTX_STATUS] Handler invoked");

    try {
      const biconomyService = runtime.getService<BiconomyService>(BiconomyService.serviceType);
      if (!biconomyService) {
        const errorMsg = "Biconomy service not initialized";
        callback?.({ text: `❌ ${errorMsg}` });
        return { text: `❌ ${errorMsg}`, success: false, error: "service_unavailable" };
      }

      // Extract parameters
      const composedState = await runtime.composeState(message, ["ACTION_STATE"], true);
      const params = composedState?.data?.actionParams || {};
      const supertxHash = params?.supertxHash?.trim();

      if (!supertxHash) {
        const errorMsg = "Missing required parameter: supertxHash";
        callback?.({ text: `❌ ${errorMsg}` });
        return { text: `❌ ${errorMsg}`, success: false, error: "missing_parameters" };
      }

      callback?.({ text: `🔍 Checking status for ${supertxHash}...` });

      const status = await biconomyService.getStatus(supertxHash);
      const explorerUrl = biconomyService.getExplorerUrl(supertxHash);

      // Format status indicator
      const statusIndicator = 
        status.status === "success" ? "✅" : 
        status.status === "pending" ? "⏳" : 
        status.status === "failed" ? "❌" : "❓";

      // Format transactions if available
      let txDetails = "";
      if (status.transactions && status.transactions.length > 0) {
        txDetails = "\n\n**Transactions:**";
        for (const tx of status.transactions) {
          const chainName = biconomyService.getChainName(tx.chainId);
          txDetails += `\n- ${chainName}: \`${tx.txHash}\` (${tx.status})`;
        }
      }

      const responseText = `
${statusIndicator} **Supertransaction Status: ${status.status.toUpperCase()}**

**Hash:** \`${status.supertxHash}\`
**Track:** [MEE Explorer](${explorerUrl})${txDetails}${status.error ? `\n\n**Error:** ${status.error}` : ""}
      `.trim();

      callback?.({
        text: responseText,
        actions: ["MEE_SUPERTRANSACTION_STATUS"],
        source: message.content.source,
      });

      return {
        text: responseText,
        success: true,
        data: {
          status,
          explorerUrl,
        },
      };
    } catch (error) {
      const err = error as Error;
      logger.error(`[MEE_SUPERTX_STATUS] Error: ${err.message}`);
      callback?.({ text: `❌ Error: ${err.message}` });
      return {
        text: `❌ Error: ${err.message}`,
        success: false,
        error: "handler_error",
      };
    }
  },

  examples: [
    [
      {
        name: "{{user}}",
        content: {
          text: "Check the status of my supertransaction stx_0x123...",
        },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Checking the status of your MEE supertransaction...",
          action: "MEE_SUPERTRANSACTION_STATUS",
        },
      },
    ],
  ],
};

export default meeSupertransactionStatusAction;

