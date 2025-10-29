import { Service, IAgentRuntime, ServiceType } from "@elizaos/core";

export interface TransactionReceipt {
  status: string;
  blockNumber: string;
  blockHash: string;
  transactionHash: string;
  transactionIndex: string;
  from: string;
  to: string;
  contractAddress: string | null;
  gasUsed: string;
  cumulativeGasUsed: string;
  effectiveGasPrice: string;
  confirmations: number;
  success: boolean;
}

export interface TransactionStatus {
  isError: string;
  errDescription: string;
}

// Supported chains with their chain IDs for Etherscan V2 API
export const CHAIN_IDS = {
  ethereum: 1,
  eth: 1,
  mainnet: 1,
  polygon: 137,
  matic: 137,
  arbitrum: 42161,
  arb: 42161,
  optimism: 10,
  op: 10,
  base: 8453,
  bsc: 56,
  binance: 56,
  avalanche: 43114,
  avax: 43114,
  fantom: 250,
  ftm: 250,
  sepolia: 11155111,
  goerli: 5,
  holesky: 17000,
} as const;

export type SupportedChain = keyof typeof CHAIN_IDS;

export class EtherscanService extends Service {
  static serviceType = "ETHERSCAN" as const;

  private apiKey: string = "";
  private baseUrl: string = "https://api.etherscan.io/v2/api";
  private defaultChainId: number = 1; // Ethereum mainnet

  get capabilityDescription(): string {
    return "Etherscan blockchain data service for checking transaction confirmations and status across 60+ EVM chains using V2 API";
  }

  constructor(runtime: IAgentRuntime) {
    super(runtime);
  }

  static async start(runtime: IAgentRuntime): Promise<EtherscanService> {
    const svc = new EtherscanService(runtime);
    await svc.initialize(runtime);
    return svc;
  }

  async initialize(runtime: IAgentRuntime): Promise<void> {
    this.apiKey = runtime.getSetting("ETHERSCAN_API_KEY") || "";
    
    // Allow override for custom deployments, but default to V2
    const customUrl = runtime.getSetting("ETHERSCAN_BASE_URL");
    if (customUrl) {
      this.baseUrl = customUrl;
    }

    if (!this.apiKey) {
      console.warn("⚠️ ETHERSCAN_API_KEY not set. Etherscan plugin will have limited functionality.");
    }
  }

  async stop(): Promise<void> {
    // No cleanup needed for this service
  }

  /**
   * Validate that the API key is configured
   * @throws Error if API key is not configured
   */
  private validateApiKey(): void {
    if (!this.apiKey) {
      throw new Error("ETHERSCAN_API_KEY is not configured. Please set it in your environment variables or character settings.");
    }
  }

  /**
   * Get the chain ID for a specific chain name
   * @param chain Chain name or identifier (optional, defaults to Ethereum)
   * @returns Chain ID for Etherscan V2 API
   */
  private getChainId(chain?: string): number {
    if (!chain) {
      return this.defaultChainId;
    }

    const chainLower = chain.toLowerCase() as SupportedChain;
    return CHAIN_IDS[chainLower] || this.defaultChainId;
  }

  /**
   * Get transaction receipt including confirmation status
   * Uses Etherscan V2 API with chainid parameter
   * @param txHash Transaction hash to check
   * @param chain Chain name (optional, defaults to Ethereum)
   * @returns Transaction receipt with confirmation details
   */
  async getTransactionReceipt(txHash: string, chain?: string): Promise<TransactionReceipt> {
    this.validateApiKey();
    const chainId = this.getChainId(chain);
    const url = `${this.baseUrl}?chainid=${chainId}&module=proxy&action=eth_getTransactionReceipt&txhash=${txHash}&apikey=${this.apiKey}`;

    try {
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      // Handle Etherscan V2 API error responses
      if (data.error) {
        const errorMessage = typeof data.error === 'object' 
          ? data.error.message || JSON.stringify(data.error)
          : String(data.error);
        throw new Error(`Etherscan API error: ${errorMessage}`);
      }

      // Handle V2 API status codes
      if (data.status === "0" && data.message !== "OK") {
        throw new Error(`Etherscan API: ${data.message || 'Unknown error'} ${data.result || ''}`);
      }

      if (!data.result) {
        throw new Error("Transaction not found or pending. Please verify the transaction hash and try again.");
      }

      const receipt = data.result;
      
      // Get current block to calculate confirmations
      const currentBlockUrl = `${this.baseUrl}?chainid=${chainId}&module=proxy&action=eth_blockNumber&apikey=${this.apiKey}`;
      const blockResponse = await fetch(currentBlockUrl);
      
      if (!blockResponse.ok) {
        throw new Error(`Failed to fetch current block: HTTP ${blockResponse.status}`);
      }

      const blockData = await blockResponse.json();

      if (blockData.error) {
        throw new Error(`Failed to get current block: ${typeof blockData.error === 'object' ? blockData.error.message : blockData.error}`);
      }

      if (!blockData.result) {
        throw new Error("Failed to retrieve current block number");
      }

      const currentBlock = parseInt(blockData.result, 16);
      const txBlock = parseInt(receipt.blockNumber, 16);
      const confirmations = currentBlock - txBlock + 1;

      return {
        status: receipt.status,
        blockNumber: receipt.blockNumber,
        blockHash: receipt.blockHash,
        transactionHash: receipt.transactionHash,
        transactionIndex: receipt.transactionIndex,
        from: receipt.from,
        to: receipt.to || null,
        contractAddress: receipt.contractAddress || null,
        gasUsed: receipt.gasUsed,
        cumulativeGasUsed: receipt.cumulativeGasUsed,
        effectiveGasPrice: receipt.effectiveGasPrice,
        confirmations,
        success: receipt.status === "0x1",
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to get transaction receipt: ${errorMessage}`);
    }
  }

  /**
   * Check transaction execution status
   * Uses Etherscan V2 API with chainid parameter
   * @param txHash Transaction hash to check
   * @param chain Chain name (optional, defaults to Ethereum)
   * @returns Transaction status (success/failure with error description)
   */
  async getTransactionStatus(txHash: string, chain?: string): Promise<TransactionStatus> {
    this.validateApiKey();
    const chainId = this.getChainId(chain);
    const url = `${this.baseUrl}?chainid=${chainId}&module=transaction&action=getstatus&txhash=${txHash}&apikey=${this.apiKey}`;

    try {
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      if (data.error) {
        const errorMessage = typeof data.error === 'object' 
          ? data.error.message || JSON.stringify(data.error)
          : String(data.error);
        throw new Error(`Etherscan API error: ${errorMessage}`);
      }

      if (data.status === "0") {
        throw new Error(data.message || "Failed to fetch transaction status");
      }

      return data.result as TransactionStatus;
    } catch (error) {
      throw new Error(`Failed to get transaction status: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Check transaction receipt status (simple success/fail check)
   * Uses Etherscan V2 API with chainid parameter
   * @param txHash Transaction hash to check
   * @param chain Chain name (optional, defaults to Ethereum)
   * @returns Receipt status
   */
  async getTransactionReceiptStatus(txHash: string, chain?: string): Promise<{ status: string }> {
    this.validateApiKey();
    const chainId = this.getChainId(chain);
    const url = `${this.baseUrl}?chainid=${chainId}&module=transaction&action=gettxreceiptstatus&txhash=${txHash}&apikey=${this.apiKey}`;

    try {
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      if (data.error) {
        const errorMessage = typeof data.error === 'object' 
          ? data.error.message || JSON.stringify(data.error)
          : String(data.error);
        throw new Error(`Etherscan API error: ${errorMessage}`);
      }

      if (data.status === "0") {
        throw new Error(data.message || "Failed to fetch receipt status");
      }

      return data.result as { status: string };
    } catch (error) {
      throw new Error(`Failed to get receipt status: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get transaction details by hash
   * Uses Etherscan V2 API with chainid parameter
   * @param txHash Transaction hash
   * @param chain Chain name (optional, defaults to Ethereum)
   * @returns Transaction details
   */
  async getTransactionByHash(txHash: string, chain?: string): Promise<Record<string, unknown>> {
    this.validateApiKey();
    const chainId = this.getChainId(chain);
    const url = `${this.baseUrl}?chainid=${chainId}&module=proxy&action=eth_getTransactionByHash&txhash=${txHash}&apikey=${this.apiKey}`;

    try {
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      if (data.error) {
        const errorMessage = typeof data.error === 'object' 
          ? data.error.message || JSON.stringify(data.error)
          : String(data.error);
        throw new Error(`Etherscan API error: ${errorMessage}`);
      }

      if (!data.result) {
        throw new Error("Transaction not found");
      }

      return data.result;
    } catch (error) {
      throw new Error(`Failed to get transaction: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

