import { IAgentRuntime, Service, logger } from "@elizaos/core";
import { CdpClient, EvmServerAccount } from "@coinbase/cdp-sdk";
import {
  createPublicClient,
  createWalletClient,
  http,
  type PublicClient,
  type WalletClient,
} from "viem";
import { toAccount } from "viem/accounts";
import {
  base,
  baseSepolia,
  mainnet,
  arbitrum,
  polygon,
  type Chain,
  optimism,
} from "viem/chains";
import { z } from "zod";
import { type CdpNetwork, DEFAULT_RPC_URLS } from "../types";
import { MAINNET_NETWORKS, getChainConfig } from "../constants/chains";
import { waitForTxConfirmation } from "../constants/timeouts";
import { executeSwap } from "../utils/swap";
import { executeTransfer } from "../utils/transfer";

const cdpConfigSchema = z.object({
  apiKeyId: z.string().min(1, "COINBASE_API_KEY_NAME must be a non-empty string"),
  apiKeySecret: z.string().min(1, "COINBASE_PRIVATE_KEY must be a non-empty string"),
  walletSecret: z.string().min(1, "COINBASE_WALLET_SECRET must be a non-empty string"),
});

type CdpConfig = z.infer<typeof cdpConfigSchema>;

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
  capabilityDescription = "Provides authenticated access to Coinbase CDP SDK";

  private client: CdpClient | null = null;
  private walletInfoCache: Map<string, {
    data: WalletInfo;
    timestamp: number;
  }> = new Map();
  private readonly CACHE_DURATION_MS = 60 * 1000;

  constructor(runtime: IAgentRuntime) {
    super(runtime);
  }

  static async start(runtime: IAgentRuntime): Promise<CdpService> {
    const svc = new CdpService(runtime);
    await svc.initClient();
    return svc;
  }

  async stop(): Promise<void> {}

  private async initClient(): Promise<void> {
    try {
      const apiKeyId = process.env.COINBASE_API_KEY_NAME || process.env.CDP_API_KEY_ID;
      const apiKeySecret = process.env.COINBASE_PRIVATE_KEY || process.env.CDP_API_KEY_SECRET;
      const walletSecret = process.env.COINBASE_WALLET_SECRET;

      if (!apiKeyId || !apiKeySecret) {
        logger.warn(
          "CDP_SERVICE: Missing required env vars (COINBASE_API_KEY_NAME, COINBASE_PRIVATE_KEY)",
        );
        this.client = null;
        return;
      }

      if (!walletSecret) {
        logger.warn(
          "CDP_SERVICE: COINBASE_WALLET_SECRET is required for wallet operations. Generate one with: openssl rand -hex 32",
        );
        this.client = null;
        return;
      }

      // Validate configuration with Zod schema
      const validationResult = cdpConfigSchema.safeParse({
        apiKeyId,
        apiKeySecret,
        walletSecret,
      });

      if (!validationResult.success) {
        const errors = validationResult.error.issues
          .map((issue: z.ZodIssue) => `${issue.path.join(".")}: ${issue.message}`)
          .join("; ");
        logger.error(`CDP_SERVICE: Configuration validation failed - ${errors}`);
        this.client = null;
        return;
      }

      const config: CdpConfig = validationResult.data;

      this.client = new CdpClient({
        apiKeyId: config.apiKeyId,
        apiKeySecret: config.apiKeySecret,
        walletSecret: config.walletSecret,
      });
      
      logger.info("CDP_SERVICE initialized successfully with validated configuration");
    } catch (error) {
      logger.error("CDP_SERVICE init error:", error instanceof Error ? error.message : String(error));
      this.client = null;
    }
  }

  async createEvmAccount(): Promise<EvmServerAccount> {
    if (!this.client) {
      throw new Error("CDP is not authenticated");
    }
    return this.client.evm.createAccount();
  }

  async getOrCreateAccount(options: { name: string }): Promise<EvmServerAccount> {
    if (!this.client) {
      throw new Error("CDP is not authenticated");
    }
    return this.client.evm.getOrCreateAccount(options);
  }

  getClient(): CdpClient | null {
    return this.client;
  }

  /**
   * Returns viem wallet/public clients backed by a CDP EVM account.
   * Uses viem's toAccount() wrapper as per CDP SDK documentation.
   * @see https://github.com/coinbase/cdp-sdk/blob/main/typescript/README.md#sending-transactions
   */
  async getViemClientsForAccount(options: {
    accountName: string;
    network?: CdpNetwork;
    rpcUrl?: string;
  }): Promise<{
    address: `0x${string}`;
    walletClient: WalletClient;
    publicClient: PublicClient;
  }> {
    if (!this.client) { 
      throw new Error("CDP is not authenticated");
    }

    const network = options.network ?? "base";
    const NETWORK_CONFIG: Record<CdpNetwork, { chain: Chain; envVar: string }> = {
      base: { chain: base, envVar: "BASE_RPC_URL" },
      optimism: { chain: optimism, envVar: "OPTIMISM_RPC_URL" },
      "base-sepolia": { chain: baseSepolia, envVar: "BASE_SEPOLIA_RPC_URL" },
      ethereum: { chain: mainnet, envVar: "ETHEREUM_RPC_URL" },
      arbitrum: { chain: arbitrum, envVar: "ARBITRUM_RPC_URL" },
      polygon: { chain: polygon, envVar: "POLYGON_RPC_URL" },
    };

    const cfg = NETWORK_CONFIG[network] ?? NETWORK_CONFIG.base;
    const defaultRpcFromMap = DEFAULT_RPC_URLS[cfg.chain.id];
    const rpcUrl = options.rpcUrl || process.env[cfg.envVar] || defaultRpcFromMap;
    const chain = cfg.chain;

    const account = await this.getOrCreateAccount({ name: options.accountName });
    const address = account.address as `0x${string}`;

    // Wrap CDP EvmServerAccount with viem's toAccount() as shown in CDP docs
    const publicClient = createPublicClient({
      chain,
      transport: http(rpcUrl),
    }) as PublicClient;
    
    const walletClient = createWalletClient({
      account: toAccount(account),
      chain,
      transport: http(rpcUrl),
    });

    return { address, walletClient, publicClient };
  }

  /**
   * Helper function to safely convert BigInt balance to number
   */
  private safeBalanceToNumber(balanceHex: string, decimals: number): number {
    try {
      const balance = BigInt(balanceHex);
      // Convert to string first, then do division to avoid Number overflow
      const balanceStr = balance.toString();
      const decimalPoint = balanceStr.length - decimals;
      
      if (decimalPoint <= 0) {
        // Very small number (0.00xxx)
        const zeros = '0'.repeat(Math.abs(decimalPoint));
        return parseFloat(`0.${zeros}${balanceStr}`);
      } else {
        // Normal number
        const intPart = balanceStr.slice(0, decimalPoint);
        const fracPart = balanceStr.slice(decimalPoint);
        return parseFloat(`${intPart}.${fracPart}`);
      }
    } catch (err) {
      logger.warn(`[CDP Service] Error converting balance ${balanceHex} with ${decimals} decimals:`, err instanceof Error ? err.message : String(err));
      return 0;
    }
  }

  /**
   * Fetch native token price from CoinGecko Pro API
   */
  private async getNativeTokenPrice(coingeckoId: string): Promise<number> {
    const apiKey = process.env.COINGECKO_API_KEY;
    if (!apiKey) {
      logger.warn('[CDP Service] CoinGecko API key not configured');
      return 0;
    }

    try {
      const url = `https://pro-api.coingecko.com/api/v3/simple/price?ids=${coingeckoId}&vs_currencies=usd`;
      const response = await fetch(url, {
        headers: {
          'x-cg-pro-api-key': apiKey,
          'Accept': 'application/json',
        },
      });

      if (response.ok) {
        const data = await response.json();
        return data[coingeckoId]?.usd || 0;
      }
    } catch (err) {
      logger.warn(`[CDP Service] Failed to fetch native token price for ${coingeckoId}:`, err instanceof Error ? err.message : String(err));
    }

    return 0;
  }

  /**
   * Fetch token info (price and metadata) from CoinGecko Pro API
   */
  private async getTokenInfo(contractAddress: string, platform: string): Promise<{
    price: number;
    name?: string;
    symbol?: string;
    decimals?: number;
  } | null> {
    const apiKey = process.env.COINGECKO_API_KEY;
    if (!apiKey) {
      logger.warn('[CDP Service] CoinGecko API key not configured');
      return null;
    }

    try {
      const url = `https://pro-api.coingecko.com/api/v3/coins/${platform}/contract/${contractAddress}`;
      const response = await fetch(url, {
        headers: {
          'x-cg-pro-api-key': apiKey,
          'Accept': 'application/json',
        },
      });

      if (response.ok) {
        const data = await response.json();
        return {
          price: data.market_data?.current_price?.usd || 0,
          name: data.name || undefined,
          symbol: data.symbol?.toUpperCase() || undefined,
          decimals: data.detail_platforms?.[platform]?.decimal_place || 18,
        };
      }
    } catch (err) {
      logger.warn(`[CDP Service] Failed to fetch token info for ${contractAddress}:`, err instanceof Error ? err.message : String(err));
    }

    return null;
  }

  /**
   * Get comprehensive wallet information from cache if available and not expired
   * Falls back to fetching fresh data if cache miss or expired
   * @param accountName User's account identifier
   * @param chain Optional specific chain to fetch (if not provided, fetches all chains)
   */
  async getWalletInfoCached(accountName: string, chain?: string): Promise<WalletInfo> {
    // Create cache key that includes chain if specified
    const cacheKey = chain ? `${accountName}:${chain}` : accountName;
    const cached = this.walletInfoCache.get(cacheKey);
    const now = Date.now();
    
    if (cached && (now - cached.timestamp) < this.CACHE_DURATION_MS) {
      logger.info(`[CDP Service] Using cached wallet info for ${accountName}${chain ? ` (chain: ${chain})` : ''} (age: ${Math.round((now - cached.timestamp) / 1000)}s)`);
      return cached.data;
    }
    
    // Cache miss or expired, fetch fresh data
    logger.info(`[CDP Service] Cache miss or expired for ${accountName}${chain ? ` (chain: ${chain})` : ''}, fetching fresh data`);
    return this.fetchWalletInfo(accountName, chain);
  }

  /**
   * Invalidate cached wallet info for a specific account
   */
  invalidateWalletCache(accountName: string): void {
    this.walletInfoCache.delete(accountName);
    logger.info(`[CDP Service] Cache invalidated for ${accountName}`);
  }

  /**
   * Clear all wallet info cache
   */
  clearWalletCache(): void {
    this.walletInfoCache.clear();
    logger.info('[CDP Service] All wallet cache cleared');
  }

  /**
   * Fetch fresh wallet information, bypassing cache
   * Use this when you need the most up-to-date wallet state
   * Automatically updates the cache with fresh data
   * @param accountName User's account identifier
   * @param chain Optional specific chain to fetch (if not provided, fetches all chains)
   */
  async fetchWalletInfo(accountName: string, chain?: string): Promise<WalletInfo> {
    if (!this.client) {
      throw new Error("CDP is not authenticated");
    }
    // Get the account to retrieve the address
    const account = await this.getOrCreateAccount({ name: accountName });
    const address = account.address;

    logger.info(`[CDP Service] Fetching wallet info for ${accountName} (${address})${chain ? ` on chain: ${chain}` : ' (all chains)'}`);

    const alchemyKey = process.env.ALCHEMY_API_KEY;
    if (!alchemyKey) {
      throw new Error('Alchemy API key not configured');
    }

    // Determine which networks to fetch
    let networksToFetch: string[];
    if (chain) {
      // Validate the chain is supported
      const chainConfig = getChainConfig(chain);
      if (!chainConfig) {
        throw new Error(`Unsupported chain: ${chain}`);
      }
      // Check if it's a mainnet network
      if (!MAINNET_NETWORKS.includes(chain as any)) {
        throw new Error(`Chain ${chain} is not a supported mainnet network`);
      }
      networksToFetch = [chain];
    } else {
      networksToFetch = MAINNET_NETWORKS;
    }

    const allTokens: any[] = [];
    const allNfts: any[] = [];
    let totalUsdValue = 0;

    // Fetch tokens across specified networks
    for (const network of networksToFetch) {
      try {
        const chainConfig = getChainConfig(network);
        if (!chainConfig) {
          logger.warn(`[CDP Service] Unsupported network: ${network}`);
          continue;
        }

        const rpcUrl = chainConfig.rpcUrl(alchemyKey);

        // Step 1: Fetch native token balance
        const nativeResponse = await fetch(rpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'eth_getBalance',
            params: [address, 'latest'],
          }),
        });

        const nativeJson = await nativeResponse.json();
        const nativeBalance = BigInt(nativeJson.result || '0');

        // Add native token if balance > 0
        if (nativeBalance > 0n) {
          const amountNum = this.safeBalanceToNumber('0x' + nativeBalance.toString(16), chainConfig.nativeToken.decimals);
          const usdPrice = await this.getNativeTokenPrice(chainConfig.nativeToken.coingeckoId);
          const usdValue = amountNum * usdPrice;
          
          if (!isNaN(usdValue)) {
            totalUsdValue += usdValue;
          }

          allTokens.push({
            symbol: chainConfig.nativeToken.symbol,
            name: chainConfig.nativeToken.name,
            balance: isNaN(amountNum) ? '0' : amountNum.toString(),
            balanceFormatted: isNaN(amountNum) ? '0' : amountNum.toFixed(6).replace(/\.?0+$/, ''),
            usdValue: isNaN(usdValue) ? 0 : usdValue,
            usdPrice: isNaN(usdPrice) ? 0 : usdPrice,
            contractAddress: null,
            chain: network,
            decimals: chainConfig.nativeToken.decimals,
          });
        }

        // Step 2: Fetch ERC20 token balances using Alchemy
        const tokensResponse = await fetch(rpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 2,
            method: 'alchemy_getTokenBalances',
            params: [address],
          }),
        });

        if (!tokensResponse.ok) {
          logger.warn(`[CDP Service] Failed to fetch tokens for ${network}: ${tokensResponse.status}`);
          continue;
        }

        const tokensJson = await tokensResponse.json();
        if (tokensJson.error) {
          logger.warn(`[CDP Service] RPC error for ${network}:`, tokensJson.error);
          continue;
        }

        const tokenBalances = tokensJson?.result?.tokenBalances || [];

        // Step 3: Process ERC20 tokens
        for (const tokenBalance of tokenBalances) {
          try {
            const contractAddress = tokenBalance.contractAddress;
            const tokenBalanceHex = tokenBalance.tokenBalance;
            
            // Skip tokens with 0 balance
            if (!tokenBalanceHex || BigInt(tokenBalanceHex) === 0n) continue;
            
            // Get token info from CoinGecko
            const platform = chainConfig.coingeckoPlatform;
            const tokenInfo = await this.getTokenInfo(contractAddress, platform);
            
            if (!tokenInfo) {
              logger.debug(`[CDP Service] Could not get price for token ${contractAddress} on ${network}`);
              continue;
            }
            
            const usdPrice = tokenInfo.price || 0;
            const amountNum = this.safeBalanceToNumber(tokenBalanceHex, tokenInfo.decimals || 18);
            const usdValue = amountNum * usdPrice;
            
            if (!isNaN(usdValue)) {
              totalUsdValue += usdValue;
            }
            
            allTokens.push({
              symbol: tokenInfo.symbol || 'UNKNOWN',
              name: tokenInfo.name || 'Unknown Token',
              balance: isNaN(amountNum) ? '0' : amountNum.toString(),
              balanceFormatted: isNaN(amountNum) ? '0' : amountNum.toFixed(6).replace(/\.?0+$/, ''),
              usdValue: isNaN(usdValue) ? 0 : usdValue,
              usdPrice: isNaN(usdPrice) ? 0 : usdPrice,
              contractAddress,
              chain: network,
              decimals: tokenInfo.decimals || 18,
            });
          } catch (err) {
            logger.warn(`[CDP Service] Error processing token ${tokenBalance.contractAddress} on ${network}:`, err instanceof Error ? err.message : String(err));
          }
        }

        // Step 4: Fetch NFTs using Alchemy NFT API
        const baseUrl = rpcUrl.replace('/v2/', '/nft/v3/');
        const nftUrl = `${baseUrl}/getNFTsForOwner?owner=${address}&withMetadata=true&pageSize=100`;

        const nftResponse = await fetch(nftUrl);
        
        if (nftResponse.ok) {
          const nftData = await nftResponse.json();
          const nfts = nftData.ownedNfts || [];

          for (const nft of nfts) {
            const metadata = nft.raw?.metadata || {};
            const tokenId = nft.tokenId;
            const contractAddress = nft.contract?.address;

            allNfts.push({
              chain: network,
              contractAddress,
              tokenId,
              name: metadata.name || nft.name || `${nft.contract?.name || 'Unknown'} #${tokenId}`,
              description: metadata.description || nft.description || '',
              contractName: nft.contract?.name || nft.contract?.symbol || 'Unknown Collection',
              tokenType: nft.tokenType || 'ERC721',
            });
          }
        }
      } catch (err) {
        logger.warn(`[CDP Service] Failed to fetch balances for ${network}:`, err instanceof Error ? err.message : String(err));
      }
    }

    const finalTotalUsdValue = isNaN(totalUsdValue) ? 0 : totalUsdValue;
    
    logger.info(`[CDP Service] Found ${allTokens.length} tokens, ${allNfts.length} NFTs for ${accountName}${chain ? ` on ${chain}` : ''}, total value: $${finalTotalUsdValue.toFixed(2)}`);

    const walletInfo: WalletInfo = {
      address,
      tokens: allTokens,
      nfts: allNfts,
      totalUsdValue: finalTotalUsdValue,
    };

    // Update cache with fresh data (cache key includes chain if specified)
    const cacheKey = chain ? `${accountName}:${chain}` : accountName;
    this.walletInfoCache.set(cacheKey, {
      data: walletInfo,
      timestamp: Date.now(),
    });

    return walletInfo;
  }

  /**
   * Transfer tokens from CDP wallet
   * Delegates to transfer utils for implementation
   */
  async transfer(params: {
    accountName: string;
    network: CdpNetwork;
    to: `0x${string}`;
    token: `0x${string}` | "eth";
    amount: bigint;
  }): Promise<{ transactionHash: string; from: string }> {
    if (!this.client) {
      throw new Error("CDP is not authenticated");
    }

    const { accountName, network, to, token, amount } = params;

    logger.info(`[CDP Service] Transferring ${amount.toString()} ${token} to ${to} on ${network} for ${accountName}`);

    const account = await this.getOrCreateAccount({ name: accountName });

    return executeTransfer({
      account,
      accountName,
      network,
      to,
      token,
      amount,
      getViemClients: (accountName: string, network: CdpNetwork) => this.getViemClientsForAccount({ accountName, network }),
      getChainIdForNetwork: this.getChainIdForNetwork.bind(this),
      DEFAULT_RPC_URLS,
    });
  }

  /**
   * Helper to get chain ID for a network
   */
  private getChainIdForNetwork(network: CdpNetwork): number {
    const chainIds: Record<CdpNetwork, number> = {
      base: 8453,
      optimism: 10,
      'base-sepolia': 84532,
      ethereum: 1,
      arbitrum: 42161,
      polygon: 137,
    };
    return chainIds[network];
  }

  /**
   * Execute token swap with automatic fallback to multiple swap providers
   * Delegates to swap utils for implementation
   * 
   * Fallback chain:
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
    if (!this.client) {
      throw new Error("CDP is not authenticated");
    }

    const { accountName, network, fromToken, toToken, fromAmount, slippageBps = 100 } = params;

    logger.info(`[CDP Service] Executing swap: ${fromAmount.toString()} ${fromToken} to ${toToken} on ${network} for ${accountName}`);

    const account = await this.getOrCreateAccount({ name: accountName });

    return executeSwap({
      account,
      accountName,
      network,
      fromToken,
      toToken,
      fromAmount,
      slippageBps,
      getViemClients: (accountName: string, network: CdpNetwork) => this.getViemClientsForAccount({ accountName, network }),
    });
  }

  /**
   * Transfer NFT from CDP wallet
   * Uses viem to execute ERC721 safeTransferFrom
   */
  async transferNft(params: {
    accountName: string;
    network: CdpNetwork;
    to: `0x${string}`;
    contractAddress: `0x${string}`;
    tokenId: string;
  }): Promise<{ transactionHash: string; from: string }> {
    if (!this.client) {
      throw new Error("CDP is not authenticated");
    }

    const { accountName, network, to, contractAddress, tokenId } = params;

    logger.info(`[CDP Service] Transferring NFT ${contractAddress}:${tokenId} to ${to} on ${network} for ${accountName}`);

    const account = await this.getOrCreateAccount({ name: accountName });
    const { walletClient, publicClient } = await this.getViemClientsForAccount({
      accountName,
      network,
    });

    // ERC721 safeTransferFrom ABI
    const erc721Abi = [
      {
        name: 'safeTransferFrom',
        type: 'function',
        stateMutability: 'nonpayable',
        inputs: [
          { name: 'from', type: 'address' },
          { name: 'to', type: 'address' },
          { name: 'tokenId', type: 'uint256' }
        ],
        outputs: []
      }
    ] as const;

    const txHash = await walletClient.writeContract({
      address: contractAddress,
      abi: erc721Abi,
      functionName: 'safeTransferFrom',
      args: [account.address as `0x${string}`, to, BigInt(tokenId)],
      account: walletClient.account ?? null,
      chain: walletClient.chain ?? undefined,
    });

    // Wait for transaction confirmation
    await waitForTxConfirmation(publicClient, txHash, "NFT transfer");

    return {
      transactionHash: txHash,
      from: account.address,
    };
  }
}