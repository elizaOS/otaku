import { IAgentRuntime, Service, logger } from "@elizaos/core";
import { type CdpNetwork } from "../types";
import { CdpTransactionManager } from "@/managers/cdp-transaction-manager";

interface WalletToken {
  symbol: string;
  name: string;
  balance: string;
  balanceFormatted: string;
  usdValue: number;
  usdPrice: number;
  contractAddress: string | null;
  chain: string;
  decimals: number;
}

interface WalletNFT {
  chain: string;
  contractAddress: string;
  tokenId: string;
  name: string;
  description: string;
  contractName: string;
  tokenType: string;
  balance?: string;
  attributes?: unknown[];
}

interface WalletInfo {
  address: string;
  tokens: WalletToken[];
  nfts: WalletNFT[];
  totalUsdValue: number;
}

export class CdpService extends Service {
  static serviceType = "CDP_SERVICE";
  capabilityDescription = "Provides authenticated access to Coinbase CDP via Transaction Manager";

  private transactionManager: CdpTransactionManager;

  constructor(runtime: IAgentRuntime) {
    super(runtime);
    this.transactionManager = CdpTransactionManager.getInstance();
  }

  static async start(runtime: IAgentRuntime): Promise<CdpService> {
    const svc = new CdpService(runtime);
    logger.info("CDP_SERVICE: Started with CdpTransactionManager");
    return svc;
  }

  async stop(): Promise<void> {
    logger.info("CDP_SERVICE: Stopping");
  }

  /**
   * Get or create wallet for account
   * Delegates to transaction manager
   */
  async getOrCreateWallet(accountName: string): Promise<{ address: string; accountName: string }> {
    return this.transactionManager.getOrCreateWallet(accountName);
  }

  /**
   * Get Viem wallet and public clients for a CDP account on a specific network
   * Delegates to transaction manager
   * 
   * @param options.accountName - CDP account name
   * @param options.network - Network (defaults to 'base')
   * @returns Object containing address, walletClient, publicClient, and cdpAccount
   *   - cdpAccount: Raw CDP EvmAccount with native signing methods (use for EIP-712 typed data)
   */
  async getViemClientsForAccount(options: {
    accountName: string;
    network?: string;
  }): Promise<{
    address: `0x${string}`;
    walletClient: any;
    publicClient: any;
    cdpAccount: {
      address: string;
      signTypedData: (params: {
        domain: {
          name?: string;
          version?: string;
          chainId?: number | bigint;
          verifyingContract?: `0x${string}`;
          salt?: `0x${string}`;
        };
        types: Record<string, Array<{ name: string; type: string }>>;
        primaryType: string;
        message: Record<string, unknown>;
      }) => Promise<`0x${string}`>;
    };
  }> {
    return this.transactionManager.getViemClientsForAccount(options);
  }

  /**
   * Get comprehensive wallet information from cache if available and not expired
   * Falls back to fetching fresh data if cache miss or expired
   * Delegates to transaction manager (uses manager's 5-minute cache)
   * @param accountName User's account identifier
   * @param chain Optional specific chain to fetch (if not provided, fetches all chains)
   */
  async getWalletInfoCached(accountName: string, chain?: string, address?: string): Promise<WalletInfo> {
    logger.info(`[CDP Service] Getting wallet info for ${accountName}${chain ? ` (chain: ${chain})` : ' (all chains)'}${address ? ` (address: ${address.substring(0, 10)}...)` : ''}`);

    // Use manager's cache (5-minute TTL)
    // Pass address if available to avoid CDP account lookup
    const [tokensResult, nftsResult] = await Promise.all([
      this.transactionManager.getTokenBalances(accountName, chain, false, address), // use cache, pass address
      this.transactionManager.getNFTs(accountName, chain, false, address), // use cache, pass address
    ]);

    return {
      address: tokensResult.address,
      tokens: tokensResult.tokens,
      nfts: nftsResult.nfts,
      totalUsdValue: tokensResult.totalUsdValue,
    };
  }

  /**
   * Fetch fresh wallet information, bypassing cache
   * Use this when you need the most up-to-date wallet state (e.g., before transfers)
   * Delegates to transaction manager with forceSync=true
   * 
   * SECURITY: Use this before executing percentage-based transfers to prevent
   * TOCTOU (Time-of-Check to Time-of-Use) race conditions with stale balance data.
   * 
   * @param accountName User's account identifier
   * @param chain Optional specific chain to fetch (if not provided, fetches all chains)
   * @param address Optional wallet address to avoid CDP account lookup
   */
  async fetchWalletInfo(accountName: string, chain?: string, address?: string): Promise<WalletInfo> {
    logger.info(`[CDP Service] Force fetching wallet info for ${accountName}${chain ? ` on chain: ${chain}` : ' (all chains)'}${address ? ` (address: ${address.substring(0, 10)}...)` : ''}`);

    // Force sync - bypass manager's cache (forceSync = true)
    // Pass address if available to avoid CDP account lookup
    const [tokensResult, nftsResult] = await Promise.all([
      this.transactionManager.getTokenBalances(accountName, chain, true, address), // forceSync = true
      this.transactionManager.getNFTs(accountName, chain, true, address), // forceSync = true
    ]);

    return {
      address: tokensResult.address,
      tokens: tokensResult.tokens,
      nfts: nftsResult.nfts,
      totalUsdValue: tokensResult.totalUsdValue,
    };
  }

  /**
   * Transfer tokens from CDP wallet
   * Delegates to transaction manager
   */
  async transfer(params: {
    accountName: string;
    network: CdpNetwork;
    to: `0x${string}`;
    token: `0x${string}` | "eth";
    amount: bigint;
  }): Promise<{ transactionHash: string; from: string }> {
    const { accountName, network, to, token, amount } = params;

    logger.info(`[CDP Service] Transferring ${amount.toString()} ${token} to ${to} on ${network} for ${accountName}`);

    const result = await this.transactionManager.sendToken({
      userId: accountName,
      network,
      to,
      token,
      amount: amount.toString(),
    });

    return {
      transactionHash: result.transactionHash,
      from: result.from,
    };
  }

  /**
   * Execute token swap with automatic fallback to multiple swap providers
   * Delegates to transaction manager
   * 
   * Fallback chain (handled by manager):
   * 1. CDP SDK (for supported networks) with Permit2 approval handling
   * 2. 0x API v2 (if configured)
   * 3. Uniswap V3 (direct protocol interaction)
   * 
   * Reference: https://docs.cdp.coinbase.com/trade-api/quickstart#3-execute-a-swap
   */
  async swap(params: {
    accountName: string;
    network: CdpNetwork;
    fromToken: `0x${string}`;
    toToken: `0x${string}`;
    fromAmount: bigint;
    slippageBps?: number;
  }): Promise<{ transactionHash: string }> {
    const { accountName, network, fromToken, toToken, fromAmount, slippageBps = 100 } = params;

    logger.info(`[CDP Service] Executing swap: ${fromAmount.toString()} ${fromToken} to ${toToken} on ${network} for ${accountName}`);

    const result = await this.transactionManager.swap({
      userId: accountName,
      network,
      fromToken,
      toToken,
      fromAmount: fromAmount.toString(),
      slippageBps,
    });

    return {
      transactionHash: result.transactionHash,
    };
  }

  /**
   * Get swap price estimate
   * Delegates to transaction manager
   */
  async getSwapPrice(params: {
    accountName: string;
    network: CdpNetwork;
    fromToken: `0x${string}`;
    toToken: `0x${string}`;
    fromAmount: bigint;
  }): Promise<{
    liquidityAvailable: boolean;
    toAmount: string;
    minToAmount: string;
  }> {
    const { accountName, network, fromToken, toToken, fromAmount } = params;

    logger.info(`[CDP Service] Getting swap price: ${fromAmount.toString()} ${fromToken} to ${toToken} on ${network} for ${accountName}`);

    const result = await this.transactionManager.getSwapPrice({
      userId: accountName,
      network,
      fromToken,
      toToken,
      fromAmount: fromAmount.toString(),
    });

    return {
      liquidityAvailable: result.liquidityAvailable,
      toAmount: result.toAmount,
      minToAmount: result.minToAmount,
    };
  }

  /**
   * Transfer NFT from CDP wallet
   * Delegates to transaction manager
   */
  async transferNft(params: {
    accountName: string;
    network: CdpNetwork;
    to: `0x${string}`;
    contractAddress: `0x${string}`;
    tokenId: string;
  }): Promise<{ transactionHash: string; from: string }> {
    const { accountName, network, to, contractAddress, tokenId } = params;

    logger.info(`[CDP Service] Transferring NFT ${contractAddress}:${tokenId} to ${to} on ${network} for ${accountName}`);

    const result = await this.transactionManager.sendNFT({
      userId: accountName,
      network,
      to,
      contractAddress,
      tokenId,
    });

    return {
      transactionHash: result.transactionHash,
      from: result.from,
    };
  }

  /**
   * Get actual on-chain token balance for a specific token
   * This fetches the real-time balance directly from the blockchain
   * Use this for 100% swaps to ensure we use the exact on-chain balance
   * @param accountName User's account identifier
   * @param network Network to check balance on
   * @param tokenAddress Token contract address (or native token address)
   * @param walletAddress Optional wallet address to avoid CDP account lookup
   */
  async getOnChainBalance(params: {
    accountName: string;
    network: CdpNetwork;
    tokenAddress: `0x${string}`;
    walletAddress?: string;
  }): Promise<bigint> {
    const { accountName, network, tokenAddress, walletAddress } = params;

    logger.info(`[CDP Service] Getting on-chain balance for token ${tokenAddress} on ${network} for ${accountName}`);

    return this.transactionManager.getOnChainTokenBalance({
      userId: accountName,
      network,
      tokenAddress,
      walletAddress,
    });
  }
}
