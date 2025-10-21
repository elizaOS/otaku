import { createWalletClient, http, type Address, type WalletClient } from "viem";
import {
  arbitrum,
  base,
  blast,
  linea,
  mainnet,
  optimism,
  polygon,
  scroll,
  zora,
  type Chain,
} from "viem/chains";
import type { Account } from "viem/accounts";

// Map of chain IDs to viem Chain objects
const CHAIN_MAP: Record<number, Chain> = {
  [mainnet.id]: mainnet,
  [base.id]: base,
  [arbitrum.id]: arbitrum,
  [polygon.id]: polygon,
  [optimism.id]: optimism,
  [zora.id]: zora,
  [blast.id]: blast,
  [scroll.id]: scroll,
  [linea.id]: linea,
};

// Default RPC URLs for each chain
const DEFAULT_RPC_URLS: Record<number, string> = {
  [mainnet.id]: "https://eth.llamarpc.com",
  [base.id]: "https://mainnet.base.org",
  [arbitrum.id]: "https://arb1.arbitrum.io/rpc",
  [polygon.id]: "https://polygon-rpc.com",
  [optimism.id]: "https://mainnet.optimism.io",
  [zora.id]: "https://rpc.zora.energy",
  [blast.id]: "https://rpc.blast.io",
  [scroll.id]: "https://rpc.scroll.io",
  [linea.id]: "https://rpc.linea.build",
};

/**
 * Multi-chain wallet adapter for Relay SDK
 * Dynamically creates wallet clients for each chain as needed
 */
export class MultiChainWallet {
  private account: Account;
  private currentChainId: number;
  private walletClients: Map<number, WalletClient> = new Map();
  private defaultRpcUrl?: string;

  constructor(account: Account, defaultRpcUrl?: string, initialChainId: number = base.id) {
    this.account = account;
    this.currentChainId = initialChainId;
    this.defaultRpcUrl = defaultRpcUrl;
  }

  /**
   * Get or create a wallet client for the specified chain
   */
  private getWalletClient(chainId: number): WalletClient {
    if (!this.walletClients.has(chainId)) {
      const chain = CHAIN_MAP[chainId];
      if (!chain) {
        throw new Error(`Unsupported chain ID: ${chainId}`);
      }

      // Use chain-specific RPC URL, not the default one
      const rpcUrl = DEFAULT_RPC_URLS[chainId];
      if (!rpcUrl) {
        throw new Error(`No RPC URL configured for chain ${chainId}`);
      }

      const client = createWalletClient({
        account: this.account,
        chain,
        transport: http(rpcUrl),
      });

      this.walletClients.set(chainId, client);
    }

    return this.walletClients.get(chainId)!;
  }

  /**
   * Get the current chain ID
   */
  async getChainId(): Promise<number> {
    return this.currentChainId;
  }

  /**
   * Switch to a different chain
   */
  async switchChain(chainId: number): Promise<void> {
    this.currentChainId = chainId;
    this.getWalletClient(chainId);
  }

  /**
   * Get the wallet address
   */
  async address(): Promise<string> {
    return this.account.address;
  }

  /**
   * Get the current wallet client for the active chain
   */
  getCurrentWalletClient(): WalletClient {
    return this.getWalletClient(this.currentChainId);
  }

  /**
   * Get the underlying account
   */
  getAccount(): Account {
    return this.account;
  }
}

/**
 * Create a Relay-compatible wallet adapter from an account
 */
export function createMultiChainWallet(
  account: Account,
  defaultRpcUrl?: string
): MultiChainWallet {
  return new MultiChainWallet(account, defaultRpcUrl);
}

