import {
  type Action,
  type IAgentRuntime,
  logger,
  type Memory,
  type State,
  type HandlerCallback,
  type ActionResult,
  composePromptFromState,
  parseKeyValueXml,
  ModelType,
} from "@elizaos/core";
import { RelayService } from "../services/relay.service";
import type { StatusRequest, RelayStatus } from "../types";

interface StatusParams {
  requestId?: string;
  txHash?: string;
  user?: string;
}

const parseStatusParams = (text: string): StatusParams | null => {
  const parsed = parseKeyValueXml(text);
  
  // At least one identifier must be provided
  if (!parsed?.requestId && !parsed?.txHash && !parsed?.user) {
    logger.warn(`Missing status identifiers: ${JSON.stringify({ parsed })}`);
    return null;
  }

  return {
    requestId: parsed.requestId?.trim(),
    txHash: parsed.txHash?.trim(),
    user: parsed.user?.trim(),
  };
};

const statusTemplate = `# Transaction Status Request

## Conversation Context
{{recentMessages}}

## Instructions
Determine and extract the transaction status details from the conversation context.

**You need at least ONE of these:**
- Request ID (transaction/request ID from Relay)
- Transaction hash (blockchain transaction hash)
- User address (wallet address)

Respond with the status parameters in this exact format:
<response>
  <requestId></requestId>
  <txHash></txHash>
</response>`;

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

  validate: async (runtime: IAgentRuntime, message: Memory, state?: State) => {
    try {
      // Check if services are available
      const relayService = runtime.getService(
        RelayService.serviceType,
      ) as RelayService;

      if (!relayService) {
        logger.warn("Required services not available for token deployment");
        return false;
      }

      return true;
    } catch (error) {
      logger.error(
        "Error validating token deployment action:",
        error instanceof Error ? error.message : String(error),
      );
      return false;
    }
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state: State,
    options?: { [key: string]: unknown },
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    try {
      // Get Relay service
      const relayService = runtime.getService<RelayService>(RelayService.serviceType);

      if (!relayService) {
        throw new Error("Relay service not initialized");
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
          logger.info(`Using requestId from bridge action: ${requestId}`);
          statusParams = {
            requestId,
          };
        } else if (txHashes && txHashes.length > 0) {
          // Use the first transaction hash (origin chain)
          logger.info(`RequestId is pending, using tx hash: ${txHashes[0].txHash}`);
          statusParams = {
            txHash: txHashes[0].txHash,
          };
        } else if (requestId === 'pending') {
          logger.warn('RequestId is pending and no transaction hashes available');
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
            logger.info(`Found requestId in recent message: ${msg.content.data.requestId}`);
            statusParams = {
              requestId: msg.content.data.requestId as string,
            };
            break;
          }
          // Also check for tx hashes
          if (msg?.content?.data?.txHashes && msg.content.data.txHashes.length > 0) {
            logger.info(`Found tx hash in recent message: ${msg.content.data.txHashes[0].txHash}`);
            statusParams = {
              txHash: msg.content.data.txHashes[0].txHash,
            };
            break;
          }
        }
      }

      // If no direct requestId, try to extract from message using LLM
      if (!statusParams) {
        const composedState = await runtime.composeState(message, ["RECENT_MESSAGES"], true);
        const context = composePromptFromState({
          state: composedState,
          template: statusTemplate,
        });

        const xmlResponse = await runtime.useModel(ModelType.TEXT_LARGE, {
          prompt: context,
        });
        
        statusParams = parseStatusParams(xmlResponse);
      }
      
      if (!statusParams) {
        throw new Error("Failed to parse status parameters from request. Please provide a request ID, transaction hash, or user address.");
      }

      // Get status from Relay
      const statuses = await relayService.getStatus(statusParams as StatusRequest);

      if (statuses.length === 0) {
        const notFoundResponse: ActionResult = {
          text: "No transactions found matching your request.",
          success: false,
        };

        if (callback) {
          callback({
            text: notFoundResponse.text,
            content: { error: "no_transactions_found" },
          });
        }

        return notFoundResponse;
      }

      // Format response
      const response: ActionResult = {
        text: formatStatusResponse(statuses),
        success: true,
        data: {
          statuses,
          request: statusParams,
        },
      };

      if (callback) {
        callback({
          text: response.text,
          actions: ["CHECK_RELAY_STATUS"],
          source: message.content.source,
          data: response.data,
        });
      }

      return response;
    } catch (error: unknown) {
      const errorMessage = (error as Error).message;
      const errorResponse: ActionResult = {
        text: `Failed to get transaction status: ${errorMessage}`,
        success: false,
        error: errorMessage,
      };

      if (callback) {
        callback({
          text: errorResponse.text,
          content: { error: "relay_status_failed", details: errorMessage },
        });
      }

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

  let response = `📊 **Found ${statuses.length} Transactions**\n\n`;

  statuses.forEach((status, index) => {
    response += `**${index + 1}. ${status.id.slice(0, 10)}...**\n`;
    response += `- Status: ${getStatusEmoji(status.status)} ${status.status}\n`;
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
  const statusEmoji = getStatusEmoji(status.status);

  let response = `
${statusEmoji} **Transaction Status: ${status.status.toUpperCase()}**

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

function getStatusEmoji(status: string): string {
  const emojis: Record<string, string> = {
    success: "✅",
    pending: "⏳",
    failed: "❌",
    processing: "🔄",
  };
  return emojis[status.toLowerCase()] || "❓";
}

function getChainName(chainId: number): string {
  const chains: Record<number, string> = {
    1: "Ethereum",
    8453: "Base",
    42161: "Arbitrum",
    137: "Polygon",
    10: "Optimism",
    7777777: "Zora",
    81457: "Blast",
    534352: "Scroll",
    59144: "Linea",
  };
  return chains[chainId] || `Chain ${chainId}`;
}

export default relayStatusAction;
