import {
  type Action,
  type IAgentRuntime,
  logger,
  type Memory,
  type State,
  type HandlerCallback,
  type ActionResult,
} from "@elizaos/core";
import { RelayService } from "../services/relay.service";
import type { StatusRequest, RelayStatus } from "../types";
import { validateRelayService, getChainName } from "../utils/actionHelpers";

interface StatusParams {
  requestId?: string;
  txHash?: string;
  user?: string;
}

export const relayStatusAction: Action = {
  name: "CHECK_RELAY_STATUS",
  description: "Use this action when you need to check the status of a Relay transaction.",
  similes: [
    "GET_RELAY_STATUS",
    "CHECK_BRIDGE_STATUS",
    "TRANSACTION_STATUS",
    "BRIDGE_STATUS",
    "CHECK_CROSS_CHAIN",
  ],

  // Parameter schema for tool calling
  parameters: {
    requestId: {
      type: "string",
      description: "The Relay request ID from a previous bridge transaction",
      required: false,
    },
    txHash: {
      type: "string",
      description: "The blockchain transaction hash to check",
      required: false,
    },
    user: {
      type: "string",
      description: "The user wallet address to check all transactions for",
      required: false,
    },
  },

  validate: async (runtime: IAgentRuntime, message: Memory, state?: State) => {
    return validateRelayService(runtime, "CHECK_RELAY_STATUS", state, message);
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    options?: { [key: string]: unknown },
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    logger.info("[CHECK_RELAY_STATUS] Handler invoked");
    
    try {
      // Get Relay service
      const relayService = runtime.getService<RelayService>(RelayService.serviceType);

      if (!relayService) {
        const errorMsg = "Relay service not initialized";
        logger.error(`[CHECK_RELAY_STATUS] ${errorMsg}`);
        
        // Try to capture input params even in early failure
        let earlyFailureInput = {};
        try {
          const composedState = await runtime.composeState(message, ["ACTION_STATE"], true);
          const params = composedState?.data?.actionParams || {};
          earlyFailureInput = {
            requestId: params?.requestId,
            txHash: params?.txHash,
            user: params?.user,
          };
        } catch (e) {
          // If we can't get params, just use empty object
        }
        
        const errorResult: ActionResult = {
          text: ` ${errorMsg}`,
          success: false,
          error: "service_unavailable",
          input: earlyFailureInput,
        } as ActionResult & { input: typeof earlyFailureInput };
        callback?.({ 
          text: errorResult.text,
          content: { error: "service_unavailable", details: errorMsg }
        });
        return errorResult;
      }

      let statusParams: StatusParams | null = null;

      // First, check if requestId and txHashes are available from previous action (bridge completion)
      // Check multiple possible locations where the data might be passed
      const bridgeData = options?.data || 
                         message.content?.data || 
                         (state as any)?.lastActionResult?.data ||
                         (state as any)?.recentMessages?.[0]?.content?.data;
                         
      if (bridgeData && typeof bridgeData === 'object') {
        const requestId = bridgeData.requestId as string;
        const txHashes = bridgeData.txHashes as Array<{ txHash: string; chainId: number }>;
        
        // If requestId is "pending" or not available, try using transaction hash
        if (requestId && requestId !== 'pending') {
          logger.info(`[CHECK_RELAY_STATUS] Using requestId from bridge action: ${requestId}`);
          statusParams = {
            requestId,
          };
        } else if (txHashes && txHashes.length > 0) {
          // Use the first transaction hash (origin chain)
          logger.info(`[CHECK_RELAY_STATUS] RequestId is pending, using tx hash: ${txHashes[0].txHash}`);
          statusParams = {
            txHash: txHashes[0].txHash,
          };
        } else if (requestId === 'pending') {
          logger.warn('[CHECK_RELAY_STATUS] RequestId is pending and no transaction hashes available');
          statusParams = {
            requestId: 'pending',
          };
        }
      }

      // Try to find in recent messages if not found yet
      if (!statusParams) {
        const recentMessages = (state as any)?.recentMessages || [];
        for (const msg of recentMessages) {
          if (msg?.content?.data?.requestId && msg.content.data.requestId !== 'pending') {
            logger.info(`[CHECK_RELAY_STATUS] Found requestId in recent message: ${msg.content.data.requestId}`);
            statusParams = {
              requestId: msg.content.data.requestId as string,
            };
            break;
          }
          // Also check for tx hashes
          if (msg?.content?.data?.txHashes && msg.content.data.txHashes.length > 0) {
            logger.info(`[CHECK_RELAY_STATUS] Found tx hash in recent message: ${msg.content.data.txHashes[0].txHash}`);
            statusParams = {
              txHash: msg.content.data.txHashes[0].txHash,
            };
            break;
          }
        }
      }

      // If no direct data found, try to extract from actionParams
      if (!statusParams) {
        const composedState = await runtime.composeState(message, ["ACTION_STATE"], true);
        const params = composedState?.data?.actionParams || {};

        statusParams = {
          requestId: params?.requestId?.trim(),
          txHash: params?.txHash?.trim(),
          user: params?.user?.trim(),
        };
      }
      
      // Validate that at least one identifier is provided
      if (!statusParams || (!statusParams.requestId && !statusParams.txHash && !statusParams.user)) {
        const errorMsg = "Missing status identifiers. Please provide at least one of: request ID, transaction hash, or user address.";
        logger.error(`[CHECK_RELAY_STATUS] ${errorMsg}`);
        const errorResult: ActionResult = {
          text: ` ${errorMsg}`,
          success: false,
          error: "missing_required_parameter",
          input: statusParams || {},
        } as ActionResult & { input: typeof statusParams };
        callback?.({ 
          text: errorResult.text,
          content: { error: "missing_required_parameter", details: errorMsg }
        });
        return errorResult;
      }

      // Store input parameters for return
      const inputParams = {
        requestId: statusParams.requestId,
        txHash: statusParams.txHash,
        user: statusParams.user,
      };

      logger.info(`[CHECK_RELAY_STATUS] Status parameters: ${JSON.stringify(statusParams)}`);

      // Get status from Relay
      const statuses = await relayService.getStatus(statusParams as StatusRequest);

      if (statuses.length === 0) {
        const errorMsg = "No transactions found matching your request";
        logger.warn(`[CHECK_RELAY_STATUS] ${errorMsg}`);
        const notFoundResponse: ActionResult = {
          text: ` ${errorMsg}`,
          success: false,
          error: "no_transactions_found",
          input: inputParams,
        } as ActionResult & { input: typeof inputParams };

        callback?.({
          text: notFoundResponse.text,
          content: { error: "no_transactions_found", details: errorMsg },
        });

        return notFoundResponse;
      }

      // Format response
      const responseText = formatStatusResponse(statuses);
      const response: ActionResult = {
        text: responseText,
        success: true,
        data: {
          statuses,
          request: statusParams,
        },
        input: inputParams,
      } as ActionResult & { input: typeof inputParams };

      callback?.({
        text: response.text,
        actions: ["CHECK_RELAY_STATUS"],
        source: message.content.source,
        data: response.data,
      });

      return response;
    } catch (error: unknown) {
      const errorMessage = (error as Error).message;
      logger.error(`[CHECK_RELAY_STATUS] Action failed: ${errorMessage}`);
      
      // Try to capture input params even in failure
      let catchFailureInput = {};
      try {
        const composedState = await runtime.composeState(message, ["ACTION_STATE"], true);
        const params = composedState?.data?.actionParams || {};
        catchFailureInput = {
          requestId: params?.requestId,
          txHash: params?.txHash,
          user: params?.user,
        };
      } catch (e) {
        // If we can't get params, just use empty object
      }
      
      const errorText = ` Failed to get transaction status: ${errorMessage}`;
      const errorResponse: ActionResult = {
        text: errorText,
        success: false,
        error: "action_failed",
        input: catchFailureInput,
      } as ActionResult & { input: typeof catchFailureInput };

      callback?.({
        text: errorResponse.text,
        content: { error: "relay_status_failed", details: errorMessage },
      });

      return errorResponse;
    }
  },

  examples: [
    [
      {
        name: "{{user}}",
        content: {
          text: "Check the status of request 0x1234...",
        },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Let me check the status of that transaction...",
          action: "CHECK_RELAY_STATUS",
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: {
          text: "What's the status of my bridge transaction?",
        },
      },
      {
        name: "{{agent}}",
        content: {
          text: "I'll check your recent bridge transactions...",
          action: "CHECK_RELAY_STATUS",
        },
      },
    ],
  ],
};

function formatStatusResponse(statuses: RelayStatus[]): string {
  if (statuses.length === 1) {
    return formatSingleStatus(statuses[0]);
  }

  let response = ` **Found ${statuses.length} Transactions**\n\n`;

  statuses.forEach((status, index) => {
    response += `**${index + 1}. ${status.id.slice(0, 10)}...**\n`;
    response += `- Status: ${getStatusIndicator(status.status)} ${status.status}\n`;
    response += `- Created: ${new Date(status.createdAt).toLocaleString()}\n`;

    if (status.data?.inTxs?.[0]) {
      response += `- Origin: Chain ${status.data.inTxs[0].chainId}\n`;
    }
    if (status.data?.outTxs?.[0]) {
      response += `- Destination: Chain ${status.data.outTxs[0].chainId}\n`;
    }

    response += "\n";
  });

  return response.trim();
}

function formatSingleStatus(status: RelayStatus): string {
  const statusIndicator = getStatusIndicator(status.status);

  let response = `
${statusIndicator} **Transaction Status: ${status.status.toUpperCase()}**

**Request ID:** \`${status.id}\`
**User:** \`${status.user}\`
**Recipient:** \`${status.recipient}\`
**Created:** ${new Date(status.createdAt).toLocaleString()}
**Updated:** ${new Date(status.updatedAt).toLocaleString()}
  `.trim();

  if (status.data?.inTxs?.[0]) {
    const inTx = status.data.inTxs[0];
    response += `\n\n**Origin Transaction:**`;
    response += `\n- Chain: ${getChainName(inTx.chainId)}`;
    response += `\n- Hash: \`${inTx.hash}\``;
    response += `\n- Time: ${new Date(inTx.timestamp * 1000).toLocaleString()}`;
  }

  if (status.data?.outTxs?.[0]) {
    const outTx = status.data.outTxs[0];
    response += `\n\n**Destination Transaction:**`;
    response += `\n- Chain: ${getChainName(outTx.chainId)}`;
    response += `\n- Hash: \`${outTx.hash}\``;
    response += `\n- Time: ${new Date(outTx.timestamp * 1000).toLocaleString()}`;
  }

  if (status.data?.fees) {
    const gasFeeWei = typeof status.data.fees.gas === "string"
      ? status.data.fees.gas
      : status.data.fees.gas ?? "0";
    const relayerFeeWei = typeof status.data.fees.relayer === "string"
      ? status.data.fees.relayer
      : status.data.fees.relayer ?? "0";
    const totalFees = BigInt(gasFeeWei) + BigInt(relayerFeeWei);
    response += `\n\n**Fees:**`;
    response += `\n- Gas: ${(Number(gasFeeWei) / 1e18).toFixed(6)} ETH`;
    response += `\n- Relayer: ${(Number(relayerFeeWei) / 1e18).toFixed(6)} ETH`;
    response += `\n- Total: ${(Number(totalFees) / 1e18).toFixed(6)} ETH`;
  }

  return response;
}

function getStatusIndicator(status: string): string {
  const indicators: Record<string, string> = {
    success: "",
    pending: "",
    failed: "",
    processing: "",
  };
  return indicators[status.toLowerCase()] || "?";
}

export default relayStatusAction;
