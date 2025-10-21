import { IAgentRuntime, logger, Service } from "@elizaos/core";
import type { ProgressData } from "@relayprotocol/relay-sdk";
import {
  convertViemChainToRelayChain,
  createClient,
  getClient,
  MAINNET_RELAY_API,
  TESTNET_RELAY_API
} from "@relayprotocol/relay-sdk";
import { type Address, type Chain, type WalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  arbitrum,
  base,
  blast,
  linea,
  mainnet,
  optimism,
  polygon,
  scroll,
  zora
} from "viem/chains";
import type {
  ExecuteCallRequest,
  QuoteRequest,
  RelayChain,
  RelayCurrencyInfo,
  RelayExecuteResult,
  RelayStatus,
  ResolvedBridgeRequest,
  StatusRequest
} from "../types";
import { createMultiChainWallet, type MultiChainWallet } from "../utils/multichain-wallet";

export class RelayService extends Service {
  static serviceType = "cross_chain_bridge" as const;

  private apiUrl: string = "";
  private apiKey?: string;
  private isTestnet: boolean = false;

  constructor(runtime: IAgentRuntime) {
    super(runtime);
  }

  get capabilityDescription(): string {
    return "Cross-chain bridging and token transfers via Relay Protocol. Supports quote generation, bridge execution, and transaction status tracking across multiple EVM chains including Ethereum, Base, Arbitrum, Polygon, Optimism, and more.";
  }

  static async start(runtime: IAgentRuntime): Promise<RelayService> {
    console.log("[RELAY SERVICE] Starting Relay service");
    const service = new RelayService(runtime);
    await service.initialize(runtime);
    return service;
  }

  async stop(): Promise<void> {
    // Cleanup if needed
  }

  async initialize(runtime: IAgentRuntime): Promise<void> {
    this.isTestnet = runtime.getSetting("RELAY_ENABLE_TESTNET") === "true";
    this.apiUrl = this.isTestnet ? TESTNET_RELAY_API : MAINNET_RELAY_API;
    this.apiKey = runtime.getSetting("RELAY_API_KEY");

    // Define supported chains
    const supportedChains: Chain[] = [
      mainnet,
      base,
      arbitrum,
      polygon,
      optimism,
      zora,
      blast,
      scroll,
      linea,
    ];

    // Initialize Relay SDK with createClient (singleton)
    try {
      createClient({
        baseApiUrl: this.apiUrl,
        source: "elizaos-agent",
        chains: supportedChains.map((chain) => convertViemChainToRelayChain(chain)),
        ...(this.apiKey ? { apiKey: this.apiKey } : {}),
      });
    } catch (error) {
      // Client may already be initialized; avoid breaking startup
      const err = error as Error;
      logger.debug(`Relay client already initialized: ${err.message}`);
    }
  }

  /**
   * Get a quote for cross-chain transaction
   */
  async getQuote(request: QuoteRequest) {
    try {
      const client = getClient();
      if (!client) {
        throw new Error("Relay client not initialized");
      }

      // Validate request
      if (!request.user || !request.chainId || !request.toChainId) {
        throw new Error("Missing required fields: user, chainId, toChainId");
      }

      if (!request.amount || BigInt(request.amount) <= 0n) {
        throw new Error("Invalid amount: must be greater than 0");
      }

      const options = {
        user: request.user as Address,
        chainId: request.chainId,
        toChainId: request.toChainId,
        currency: request.currency as Address,
        toCurrency: (request.toCurrency || request.currency) as Address,
        amount: request.amount,
        recipient: (request.recipient || request.user) as Address,
        tradeType: request.tradeType || "EXACT_INPUT",
        ...(request.referrer && { referrer: request.referrer as Address }),
      };

      const quote = await client.actions.getQuote(options);

      if (!quote) {
        throw new Error("No quote returned from Relay API");
      }

      return quote;
    } catch (error) {
      const err = error as Error;
      logger.error(`Failed to get quote: ${err.message}`);
      throw new Error(`Failed to get quote: ${err.message}`);
    }
  }

  /**
   * Execute a bridge transaction
   * Accepts a resolved bridge request with chain IDs
   */
  async executeBridge(
    request: ResolvedBridgeRequest,
    options: { walletClient: WalletClient },
    onProgress?: (data: ProgressData) => void
  ): Promise<string> {
    try {
      const client = getClient();
      if (!client) {
        throw new Error("Relay client not initialized");
      }

      // Validate request
      if (!request.user || !request.originChainId || !request.destinationChainId) {
        throw new Error("Missing required fields: user, originChainId, destinationChainId");
      }

      if (!request.amount || BigInt(request.amount) <= 0n) {
        throw new Error("Invalid amount: must be greater than 0");
      }

      // Get quote before execution
      const quote = await this.getQuote({
        user: request.user,
        chainId: request.originChainId,
        toChainId: request.destinationChainId,
        currency: request.currency,
        toCurrency: request.toCurrency || request.currency,
        amount: request.amount,
        recipient: request.recipient,
        tradeType: request.useExactInput ? "EXACT_INPUT" : "EXACT_OUTPUT",
        referrer: request.referrer,
      });

      const wallet = options?.walletClient
      // Execute with the quote
      const result = await client.actions.execute({
        quote,
        wallet,
        onProgress,
      });

      // Extract request ID from the execution result
      // Log the full result structure for debugging
      logger.debug(`Execute result structure: ${JSON.stringify(Object.keys(result || {}))}`);
      
      const requestId = (result as RelayExecuteResult)?.data?.request?.id ||
        (result as RelayExecuteResult)?.requestId ||
        (result as any)?.id ||
        "pending";

      logger.info(`Bridge executed successfully. Request ID: ${requestId}`);
      return requestId;
    } catch (error) {
      const err = error as Error;
      logger.error(`Failed to execute bridge: ${err.message}`);
      throw new Error(`Failed to execute bridge: ${err.message}`);
    }
  }

  /**
   * Execute a cross-chain call with custom transactions
   */
  async executeCall(
    request: ExecuteCallRequest,
    options: { walletClient: WalletClient },
    onProgress?: (data: ProgressData) => void
  ): Promise<string> {
    try {
      const client = getClient();
      if (!client) {
        throw new Error("Relay client not initialized. Please call initialize() first.");
      }

      // Validate request
      if (!request.user || !request.originChainId || !request.destinationChainId) {
        throw new Error("Missing required fields: user, originChainId, destinationChainId");
      }

      if (!request.txs || request.txs.length === 0) {
        throw new Error("No transactions provided for cross-chain call");
      }

      // First get a quote
      const quote = await this.getQuote({
        user: request.user,
        chainId: request.originChainId,
        toChainId: request.destinationChainId,
        currency: request.originCurrency,
        amount: request.amount,
        recipient: request.recipient,
        tradeType: "EXACT_INPUT",
      });

      const wallet = options?.walletClient

      // Execute the call with SDK
      const result = await client.actions.execute({
        quote,
        wallet,
        onProgress: (data: ProgressData) => {
          if (onProgress) {
            onProgress(data);
          }
        },
      });

      // Extract request ID from the execution result
      const requestId: string = (result as import("../types").RelayExecuteResult)?.data?.request?.id ||
        (result as import("../types").RelayExecuteResult)?.requestId ||
        "pending";

      return requestId;
    } catch (error) {
      const err = error as Error;
      logger.error(`Relay executeCall error: ${err.message}`);
      throw new Error(`Failed to execute call: ${err.message}`);
    }
  }

  /**
   * Get status of a transaction
   */
  async getStatus(request: StatusRequest): Promise<RelayStatus[]> {
    try {
      // Validate at least one identifier is provided
      if (!request.requestId && !request.txHash && !request.user) {
        throw new Error("At least one of requestId, txHash, or user must be provided");
      }

      const params = new URLSearchParams();
      if (request.requestId) params.append("id", request.requestId);
      if (request.txHash) params.append("hash", request.txHash);
      if (request.user) params.append("user", request.user);

      const response = await fetch(`${this.apiUrl}/requests/v2?${params.toString()}`, {
        headers: {
          "Content-Type": "application/json",
          ...(this.apiKey && { "x-api-key": this.apiKey }),
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to get status: ${response.status} ${errorText}`);
      }

      const data: any = await response.json();
      return data.requests || [];
    } catch (error: unknown) {
      console.error("Relay getStatus error:", error);
      const err = error as Error;
      throw new Error(`Failed to get status: ${err.message}`);
    }
  }

  /**
   * Get supported chains
   */
  async getChains(): Promise<RelayChain[]> {
    try {
      const response = await fetch(`${this.apiUrl}/chains`, {
        headers: {
          "Content-Type": "application/json",
          ...(this.apiKey && { "x-api-key": this.apiKey }),
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to get chains: ${response.status} ${errorText}`);
      }

      const data: any = await response.json();
      return data.chains || [];
    } catch (error: unknown) {
      console.error("Relay getChains error:", error);
      const err = error as Error;
      throw new Error(`Failed to get chains: ${err.message}`);
    }
  }

  /**
   * Get supported currencies for a chain
   */
  async getCurrencies(chainId: number): Promise<RelayCurrencyInfo[]> {
    try {
      if (!chainId || chainId <= 0) {
        throw new Error("Invalid chainId provided");
      }

      const response = await fetch(`${this.apiUrl}/currencies?chainId=${chainId}`, {
        headers: {
          "Content-Type": "application/json",
          ...(this.apiKey && { "x-api-key": this.apiKey }),
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to get currencies: ${response.status} ${errorText}`);
      }

      const data: any = await response.json();
      return data.currencies || [];
    } catch (error: any) {
      console.error("Relay getCurrencies error:", error);
      throw new Error(`Failed to get currencies: ${error.message}`);
    }
  }

  /**
   * Index a transaction for faster processing
   */
  async indexTransaction(txHash: string, chainId: number): Promise<void> {
    try {
      if (!txHash || !chainId) {
        throw new Error("Both txHash and chainId are required");
      }

      const response = await fetch(`${this.apiUrl}/transactions/index`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.apiKey && { "x-api-key": this.apiKey }),
        },
        body: JSON.stringify({
          txHash,
          chainId,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.warn(`Failed to index transaction: ${response.status} ${errorText}`);
      }
    } catch (error: unknown) {
      // Don't throw, just log - indexing is optional
      const err = error as Error;
      console.warn(`Failed to index transaction: ${err.message}`);
    }
  }
}

export default RelayService;
