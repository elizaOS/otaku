import { logger } from '@elizaos/core';
import { CdpClient } from '@coinbase/cdp-sdk';
import { createWalletClient, createPublicClient, http, encodeFunctionData } from 'viem';
import type { WalletClient, PublicClient } from 'viem';
import { toAccount } from 'viem/accounts';
import {
  MAINNET_NETWORKS,
  getChainConfig,
  getViemChain,
  getRpcUrl,
  isCdpSwapSupported,
  NATIVE_TOKEN_ADDRESS,
  normalizeTokenAddress,
  UNISWAP_V3_ROUTER,
  UNISWAP_V3_QUOTER,
  WRAPPED_NATIVE_TOKEN,
  UNISWAP_POOL_FEES,
} from '@/constants/chains';

// ============================================================================
// Types
// ============================================================================

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

interface TokenBalance {
  symbol: string;
  name: string;
  balance: string;
  balanceFormatted: string;
  usdValue: number;
  usdPrice: number;
  contractAddress: string | null;
  chain: string;
  decimals: number;
  icon?: string;
}

interface NFT {
  chain: string;
  contractAddress: string;
  tokenId: string;
  name: string;
  description: string;
  image: string;
  contractName: string;
  tokenType: string;
  balance?: string;
  attributes: any[];
}

interface Transaction {
  chain: string;
  hash: string;
  from: string;
  to: string;
  value: string;
  asset: string;
  category: string;
  timestamp: number;
  blockNum: string;
  explorerUrl: string;
  direction: 'sent' | 'received';
  icon?: string | null;
  contractAddress?: string | null;
}

interface SwapPriceResult {
  liquidityAvailable: boolean;
  toAmount: string;
  minToAmount: string;
}

interface SwapResult {
  transactionHash: string;
  from: string;
  fromToken: string;
  toToken: string;
  fromAmount: string;
  toAmount: string;
  network: string;
  method: string;
}

interface SendResult {
  transactionHash: string;
  from: string;
  to: string;
  amount: string;
  token: string;
  network: string;
  method: string;
}

interface SendNFTResult {
  transactionHash: string;
  from: string;
  to: string;
  contractAddress: string;
  tokenId: string;
  network: string;
}

// ============================================================================
// CDP Transaction Manager Class (Singleton)
// ============================================================================

export class CdpTransactionManager {
  private static instance: CdpTransactionManager | null = null;
  
  private cdpClient: CdpClient | null = null;
  private tokensCache = new Map<string, CacheEntry<any>>();
  private nftsCache = new Map<string, CacheEntry<any>>();
  private iconCache = new Map<string, string | null>(); // Global icon cache: contractAddress -> iconUrl (null = no icon)
  private readonly CACHE_TTL = 300 * 1000; // 5 minutes

  // Private constructor to prevent direct instantiation
  private constructor() {
    this.initializeCdpClient();
  }

  /**
   * Get the singleton instance of CdpTransactionManager
   */
  public static getInstance(): CdpTransactionManager {
    if (!CdpTransactionManager.instance) {
      CdpTransactionManager.instance = new CdpTransactionManager();
    }
    return CdpTransactionManager.instance;
  }

  // ============================================================================
  // Initialization
  // ============================================================================

  private initializeCdpClient(): void {
    if (this.cdpClient) {
      return;
    }

    const apiKeyId = process.env.CDP_API_KEY_ID;
    const apiKeySecret = process.env.CDP_API_KEY_SECRET;
    const walletSecret = process.env.CDP_WALLET_SECRET;

    if (!apiKeyId || !apiKeySecret || !walletSecret) {
      logger.warn('[CdpTransactionManager] Missing CDP credentials in environment variables');
      return;
    }

    try {
      this.cdpClient = new CdpClient({
        apiKeyId,
        apiKeySecret,
        walletSecret,
      });
      logger.info('[CdpTransactionManager] CDP client initialized successfully');
    } catch (error) {
      logger.error('[CdpTransactionManager] Failed to initialize CDP client:', error instanceof Error ? error.message : String(error));
    }
  }

  private getCdpClient(): CdpClient {
    if (!this.cdpClient) {
      throw new Error('CDP client not initialized. Check environment variables.');
    }
    return this.cdpClient;
  }

  // ============================================================================
  // Icon Cache Helpers
  // ============================================================================

  /**
   * Get icon from global cache by contract address
   * Returns undefined if not in cache, null if cached as "no icon"
   */
  private getIconFromCache(contractAddress: string | null | undefined): string | null | undefined {
    if (!contractAddress) {
      return null;
    }
    const key = contractAddress.toLowerCase();
    if (!this.iconCache.has(key)) {
      return undefined; // Not in cache yet
    }
    return this.iconCache.get(key) || null; // Return cached value (could be null)
  }

  /**
   * Set icon in global cache by contract address
   * Accepts null to mark "no icon available" and prevent refetching
   */
  private setIconInCache(contractAddress: string | null | undefined, icon: string | null | undefined): void {
    if (!contractAddress) {
      return;
    }
    // Store even if icon is null/undefined to prevent refetching
    this.iconCache.set(contractAddress.toLowerCase(), icon || null);
  }

  /**
   * Get icon for a contract address (check cache, then fetch if needed)
   */
  private async getOrFetchIcon(contractAddress: string, chain: string): Promise<string | null> {
    // Check cache first
    const cached = this.getIconFromCache(contractAddress);
    if (cached !== undefined) {
      // Found in cache (could be null or a URL)
      return cached;
    }

    // Not in cache - fetch token info to get icon
    const chainConfig = getChainConfig(chain);
    if (!chainConfig) {
      // Cache null to prevent future attempts
      this.setIconInCache(contractAddress, null);
      return null;
    }

    try {
      const tokenInfo = await this.getTokenInfo(contractAddress, chainConfig.coingeckoPlatform);
      // Cache the result (even if null)
      this.setIconInCache(contractAddress, tokenInfo?.icon || null);
      return tokenInfo?.icon || null;
    } catch (error) {
      logger.debug(`[CdpTransactionManager] Failed to fetch icon for ${contractAddress}:`, error instanceof Error ? error.message : String(error));
      // Cache null to prevent retries
      this.setIconInCache(contractAddress, null);
      return null;
    }
  }

  // ============================================================================
  // Wallet Operations
  // ============================================================================

  async getOrCreateWallet(userId: string): Promise<{ address: string; accountName: string }> {
    logger.info(`[CdpTransactionManager] Getting/creating wallet for user: ${userId.substring(0, 8)}...`);
    
    const client = this.getCdpClient();
    const account = await client.evm.getOrCreateAccount({ name: userId });
    
    logger.info(`[CdpTransactionManager] Wallet ready: ${account.address}`);
    
    return {
      address: account.address,
      accountName: userId,
    };
  }

  /**
   * Construct viem walletClient and publicClient for a given CDP account and network
   * Note: Uses toAccount() to convert CDP server-managed wallet for viem compatibility
   */
  async getViemClientsForAccount(options: {
    accountName: string;
    network?: string;
  }): Promise<{
    address: `0x${string}`;
    walletClient: WalletClient;
    publicClient: PublicClient;
  }> {
    const client = this.getCdpClient();

    const network = options.network ?? 'base';
    const chainConfig = getChainConfig(network);
    if (!chainConfig) {
      throw new Error(`Unsupported network: ${network}`);
    }
    const chain = chainConfig.chain;

    const account = await client.evm.getOrCreateAccount({ name: options.accountName });
    const address = account.address as `0x${string}`;

    const alchemyKey = process.env.ALCHEMY_API_KEY;
    if (!alchemyKey) {
      throw new Error('Alchemy API key not configured');
    }
    const resolvedRpcUrl = chainConfig.rpcUrl(alchemyKey);

    const publicClient = createPublicClient({
      chain,
      transport: http(resolvedRpcUrl),
    }) as PublicClient;

    // toAccount() allows viem to use CDP's server-managed wallet signing
    const walletClient = createWalletClient({
      account: toAccount(account),
      chain,
      transport: http(resolvedRpcUrl),
    }) as WalletClient;

    return { address, walletClient, publicClient };
  }

  // ============================================================================
  // Token Operations
  // ============================================================================

  async getTokenBalances(userId: string, chain?: string, forceSync: boolean = false, address?: string): Promise<{
    tokens: TokenBalance[];
    totalUsdValue: number;
    address: string;
    fromCache: boolean;
  }> {
    // Validate chain if provided
    if (chain && !MAINNET_NETWORKS.includes(chain as any)) {
      throw new Error(`Invalid or unsupported chain: ${chain}`);
    }

    // Check cache first (unless force sync)
    if (!forceSync) {
      const cacheKey = chain ? `${userId}:${chain}` : userId;
      const cached = this.tokensCache.get(cacheKey);
      if (cached && (Date.now() - cached.timestamp) < this.CACHE_TTL) {
        logger.info(`[CdpTransactionManager] Returning cached token balances for user: ${userId.substring(0, 8)}...${chain ? ` (chain: ${chain})` : ''}`);
        return { ...cached.data, fromCache: true };
      }
    }

    const client = this.getCdpClient();
    const result = await this.fetchWalletTokens(client, userId, chain, address);

    // Update cache
    const cacheKey = chain ? `${userId}:${chain}` : userId;
    this.tokensCache.set(cacheKey, {
      data: result,
      timestamp: Date.now(),
    });

    return { ...result, fromCache: false };
  }

  /**
   * Get actual on-chain token balance for a specific token
   * This fetches the real-time balance directly from the blockchain
   * Use this for 100% swaps to ensure we use the exact on-chain balance
   * @param userId User's account identifier
   * @param network Network to check balance on
   * @param tokenAddress Token contract address (or native token address)
   * @param walletAddress Optional wallet address to avoid CDP account lookup
   */
  async getOnChainTokenBalance(params: {
    userId: string;
    network: string;
    tokenAddress: `0x${string}`;
    walletAddress?: string;
  }): Promise<bigint> {
    const { userId, network, tokenAddress, walletAddress } = params;

    logger.info(`[CdpTransactionManager] Getting on-chain balance for token ${tokenAddress} on ${network} for user ${userId.substring(0, 8)}...`);

    const client = this.getCdpClient();
    const account = await client.evm.getOrCreateAccount({ name: userId });
    
    // Use provided wallet address or account address
    const address = (walletAddress || account.address) as `0x${string}`;
    if (!address) {
      throw new Error(`Could not determine wallet address for user ${userId}`);
    }

    const normalizedTokenAddress = normalizeTokenAddress(tokenAddress);
    const chain = getViemChain(network);
    
    if (!chain) {
      throw new Error(`Invalid or unsupported network: ${network}`);
    }

    const alchemyKey = process.env.ALCHEMY_API_KEY;
    if (!alchemyKey) {
      throw new Error('ALCHEMY_API_KEY not configured. Cannot fetch on-chain balance.');
    }

    const rpcUrl = getRpcUrl(network, alchemyKey);
    if (!rpcUrl) {
      throw new Error(`Could not get RPC URL for network: ${network}`);
    }

    const publicClient = createPublicClient({
      chain,
      transport: http(rpcUrl),
    });

    // Handle native token balance
    if (normalizedTokenAddress.toLowerCase() === NATIVE_TOKEN_ADDRESS.toLowerCase()) {
      const balance = await publicClient.getBalance({ address });
      logger.info(`[CdpTransactionManager] On-chain native token balance: ${balance.toString()}`);
      return balance;
    }

    // Handle ERC20 token balance
    const balanceAbi = [
      {
        name: 'balanceOf',
        type: 'function',
        stateMutability: 'view',
        inputs: [{ name: 'account', type: 'address' }],
        outputs: [{ name: '', type: 'uint256' }]
      }
    ] as const;

    const balance = await publicClient.readContract({
      address: normalizedTokenAddress as `0x${string}`,
      abi: balanceAbi,
      functionName: 'balanceOf',
      args: [address],
    });

    logger.info(`[CdpTransactionManager] On-chain token balance: ${balance.toString()}`);
    return balance;
  }

  /**
   * Map our chain names to Alchemy Portfolio API network format
   */
  private getAlchemyNetworkName(chain: string): string | null {
    const mapping: Record<string, string> = {
      'ethereum': 'eth-mainnet',
      'base': 'base-mainnet',
      'polygon': 'matic-mainnet', // Alchemy uses 'matic-mainnet' not 'polygon-mainnet'
      'arbitrum': 'arb-mainnet',
      'optimism': 'opt-mainnet',
      'scroll': 'scroll-mainnet',
    };
    return mapping[chain] || null;
  }

  private async fetchWalletTokens(client: CdpClient, name: string, chain?: string, providedAddress?: string): Promise<{
    tokens: any[];
    totalUsdValue: number;
    address: string;
  }> {
    logger.info(`[CDP API] Fetching token balances for user: ${name}${chain ? ` on chain: ${chain}` : ' (all chains)'}`);
  
    let address = providedAddress;
    
    // If address not provided, get it from CDP account (for write operations or when entity metadata unavailable)
    if (!address || typeof address !== 'string' || !address.match(/^0x[a-fA-F0-9]{40}$/)) {
      logger.debug(`[CDP API] Address not provided or invalid, fetching from CDP account...`);
      const account = await client.evm.getOrCreateAccount({ name });
      address = account.address;
      
      // Validate address from account
      if (!address || typeof address !== 'string' || !address.match(/^0x[a-fA-F0-9]{40}$/)) {
        logger.error(`[CDP API] Invalid or missing account address for user: ${name}. Address: ${address}`);
        throw new Error(`Failed to get valid wallet address. Account may not be initialized. Received: ${address || 'undefined'}`);
      }
    } else {
      logger.debug(`[CDP API] Using provided wallet address from entity metadata: ${address}`);
    }
    
    logger.debug(`[CDP API] Using wallet address: ${address}`);
    
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

    // Convert our chain names to Alchemy network format
    const alchemyNetworks = networksToFetch
      .map(chain => this.getAlchemyNetworkName(chain))
      .filter((net): net is string => net !== null);

    if (alchemyNetworks.length === 0) {
      throw new Error('No valid Alchemy networks found for the requested chains');
    }

    // Use Alchemy Portfolio API to fetch tokens
    const portfolioApiUrl = `https://api.g.alchemy.com/data/v1/${alchemyKey}/assets/tokens/by-address`;
    
    const requestBody = {
      addresses: [{
        address: address,
        networks: alchemyNetworks,
      }],
      withMetadata: true,
      withPrices: true, // Required to get tokenPrices array with currency/value
      includeNativeTokens: true,
      includeErc20Tokens: true,
    };
    
    logger.debug(`[CDP API] Requesting tokens with prices for address ${address} on networks: ${alchemyNetworks.join(', ')}`);

    let allTokens: any[] = [];
    let totalUsdValue = 0;
    let pageKey: string | undefined;

    // Handle pagination
    do {
      try {
        const requestBodyWithPage = pageKey ? { ...requestBody, pageKey } : requestBody;
        
        const response = await fetch(portfolioApiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBodyWithPage),
        });

        if (!response.ok) {
          const errorText = await response.text();
          logger.error(`[CDP API] Alchemy Portfolio API error: ${response.status} - ${errorText}`);
          throw new Error(`Failed to fetch tokens from Alchemy Portfolio API: ${response.status}`);
        }

        const data = await response.json();
        const tokens = data?.data?.tokens || [];
        pageKey = data?.data?.pageKey;

        // Process tokens from Alchemy response
        for (const token of tokens) {
          try {
            // Skip if there's an error in the token data
            if (token.error) {
              logger.debug(`[CDP API] Token error for ${token.tokenAddress} on ${token.network}: ${token.error}`);
              continue;
            }

            // Skip tokens with 0 balance
            const balanceBigInt = BigInt(token.tokenBalance || '0');
            if (balanceBigInt === 0n) continue;

            // Map Alchemy network back to our chain name
            const ourChainName = networksToFetch.find(c => this.getAlchemyNetworkName(c) === token.network);
            if (!ourChainName) {
              logger.debug(`[CDP API] Unknown network ${token.network}, skipping`);
              continue;
            }

            const chainConfig = getChainConfig(ourChainName);
            if (!chainConfig) {
              logger.debug(`[CDP API] No config for chain ${ourChainName}, skipping`);
              continue;
            }

            // Extract token metadata
            const metadata = token.tokenMetadata || {};
            const decimals = metadata.decimals || 18;
            const symbol = metadata.symbol?.toUpperCase() || 'UNKNOWN';
            const tokenName = metadata.name || 'Unknown Token';
            let icon = metadata.logo || undefined;

            // Determine if this is a native token
            // Native tokens typically have null tokenAddress or special zero address
            const isNativeToken = !token.tokenAddress || 
                                  token.tokenAddress === '0x0000000000000000000000000000000000000000';

            // If Alchemy didn't provide an icon and this is not a native token, try to fetch from CoinGecko
            if (!icon && !isNativeToken && token.tokenAddress) {
              try {
                const cachedIcon = this.getIconFromCache(token.tokenAddress);
                if (cachedIcon !== undefined) {
                  // Use cached value (could be null or a URL)
                  icon = cachedIcon || undefined;
                } else {
                  // Not in cache - try to fetch from CoinGecko
                  const tokenInfo = await this.getTokenInfo(token.tokenAddress, chainConfig.coingeckoPlatform);
                  icon = tokenInfo?.icon || undefined;
                  // Cache the result (even if null) to prevent repeated fetches
                  this.setIconInCache(token.tokenAddress, icon || null);
                }
              } catch (err) {
                // If fetch fails, cache null to prevent retries
                logger.debug(`[CDP API] Failed to fetch icon for ${token.tokenAddress} on ${ourChainName}:`, err instanceof Error ? err.message : String(err));
                this.setIconInCache(token.tokenAddress, null);
              }
            } else if (icon && token.tokenAddress) {
              // Cache icon from Alchemy if available
              this.setIconInCache(token.tokenAddress, icon);
            }

            // Extract USD price according to Alchemy Portfolio API spec:
            // tokenPrices is an array of objects: [{ currency: string, value: string, lastUpdatedAt: string }]
            // Note: currency is lowercase "usd" not uppercase "USD"
            let usdPrice = 0;
            
            if (token.tokenPrices && Array.isArray(token.tokenPrices)) {
              // Find USD price entry in the array (case-insensitive comparison)
              const usdPriceData = token.tokenPrices.find((p: any) => 
                p.currency && p.currency.toLowerCase() === 'usd'
              );
              if (usdPriceData && usdPriceData.value) {
                // value is a string according to API spec, parse it
                usdPrice = parseFloat(usdPriceData.value);
                if (isNaN(usdPrice)) {
                  logger.warn(`[CDP API] Invalid USD price value for ${symbol} (${token.tokenAddress}): ${usdPriceData.value}`);
                  usdPrice = 0;
                }
              }
            } else if (token.tokenPrices) {
              // Unexpected structure - log for debugging
              logger.debug(`[CDP API] Token ${symbol} has unexpected tokenPrices structure: ${typeof token.tokenPrices}`);
            }

            // Convert balance from hex string to number
            const amountNum = this.safeBalanceToNumber(token.tokenBalance, decimals);
            const usdValue = amountNum * usdPrice;

            // Only add to total if it's a valid number
            if (!isNaN(usdValue) && usdValue > 0) {
              totalUsdValue += usdValue;
            }

            const formattedToken = {
              symbol: isNativeToken ? chainConfig.nativeToken.symbol : symbol,
              name: isNativeToken ? chainConfig.nativeToken.name : tokenName,
              balance: isNaN(amountNum) ? '0' : amountNum.toString(),
              balanceFormatted: isNaN(amountNum) ? '0' : amountNum.toFixed(6).replace(/\.?0+$/, ''),
              usdValue: isNaN(usdValue) ? 0 : usdValue,
              usdPrice: isNaN(usdPrice) ? 0 : usdPrice,
              contractAddress: isNativeToken ? null : token.tokenAddress,
              chain: ourChainName,
              decimals: decimals,
              icon: icon,
            };

            allTokens.push(formattedToken);

          } catch (err) {
            logger.warn(`[CDP API] Error processing token ${token.tokenAddress} on ${token.network}:`, err instanceof Error ? err.message : String(err));
          }
        }

        // Cache per-chain results after processing this page (for progressive UI updates)
        // Group tokens by chain and cache each chain separately
        for (const chainName of networksToFetch) {
          const chainTokens = allTokens.filter(t => t.chain === chainName);
          if (chainTokens.length > 0) {
            const chainCacheKey = `${name}:${chainName}`;
            const chainUsdValue = chainTokens.reduce((sum, t) => sum + (t.usdValue || 0), 0);
            
            this.tokensCache.set(chainCacheKey, {
              data: {
                tokens: chainTokens,
                totalUsdValue: chainUsdValue,
                address,
              },
              timestamp: Date.now(),
            });
            logger.debug(`[CDP API] Cached tokens for ${chainName}: ${chainTokens.length} tokens, $${chainUsdValue.toFixed(2)}`);
          }
        }

      } catch (err) {
        logger.error(`[CDP API] Failed to fetch tokens from Alchemy Portfolio API:`, err instanceof Error ? err.message : String(err));
        throw err;
      }
    } while (pageKey); // Continue fetching if there's a pageKey for pagination

    // Ensure totalUsdValue is a valid number
    const finalTotalUsdValue = isNaN(totalUsdValue) ? 0 : totalUsdValue;
    
    logger.info(`[CDP API] Found ${allTokens.length} tokens for user ${name}${chain ? ` on ${chain}` : ''}, total value: $${finalTotalUsdValue.toFixed(2)}`);
  
    // Cache aggregate result if fetching all chains
    if (!chain) {
      const aggregateCacheKey = name;
      this.tokensCache.set(aggregateCacheKey, {
        data: {
          tokens: allTokens,
          totalUsdValue: finalTotalUsdValue,
          address: address,
        },
        timestamp: Date.now(),
      });
      logger.debug(`[CDP API] Cached aggregate tokens for all chains: ${allTokens.length} tokens, $${finalTotalUsdValue.toFixed(2)}`);
    }
  
    return {
      tokens: allTokens,
      totalUsdValue: finalTotalUsdValue,
      address: address,
    };
  }

  // ============================================================================
  // NFT Operations
  // ============================================================================

  async getNFTs(userId: string, chain?: string, forceSync: boolean = false, address?: string): Promise<{
    nfts: NFT[];
    address: string;
    fromCache: boolean;
  }> {
    if (chain && !MAINNET_NETWORKS.includes(chain as any)) {
      throw new Error(`Invalid or unsupported chain: ${chain}`);
    }

    if (!forceSync) {
      const cacheKey = chain ? `${userId}:${chain}` : userId;
      const cached = this.nftsCache.get(cacheKey);
      if (cached && (Date.now() - cached.timestamp) < this.CACHE_TTL) {
        logger.info(`[CdpTransactionManager] Returning cached NFTs for user: ${userId.substring(0, 8)}...${chain ? ` (chain: ${chain})` : ''}`);
        return { ...cached.data, fromCache: true };
      }
    }

    const client = this.getCdpClient();
    const result = await this.fetchWalletNFTs(client, userId, chain, address);

    const cacheKey = chain ? `${userId}:${chain}` : userId;
    this.nftsCache.set(cacheKey, {
      data: result,
      timestamp: Date.now(),
    });

    return { ...result, fromCache: false };
  }

  private async fetchWalletNFTs(client: CdpClient, name: string, chain?: string, providedAddress?: string): Promise<{
    nfts: any[];
    address: string;
  }> {
    const alchemyKey = process.env.ALCHEMY_API_KEY;
    if (!alchemyKey) {
      throw new Error('Alchemy API key not configured');
    }
  
    logger.info(`[CDP API] Fetching NFTs for user: ${name}${chain ? ` on chain: ${chain}` : ' (all chains)'}`);
  
    let address = providedAddress;
    
    // If address not provided, get it from CDP account (for write operations or when entity metadata unavailable)
    if (!address || typeof address !== 'string' || !address.match(/^0x[a-fA-F0-9]{40}$/)) {
      logger.debug(`[CDP API] Address not provided or invalid, fetching from CDP account...`);
      const account = await client.evm.getOrCreateAccount({ name });
      address = account.address;
      
      // Validate address from account
      if (!address || typeof address !== 'string' || !address.match(/^0x[a-fA-F0-9]{40}$/)) {
        logger.error(`[CDP API] Invalid or missing account address for user: ${name}. Address: ${address}`);
        throw new Error(`Failed to get valid wallet address. Account may not be initialized. Received: ${address || 'undefined'}`);
      }
    } else {
      logger.debug(`[CDP API] Using provided wallet address from entity metadata: ${address}`);
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
  
    // Fetch NFTs from specified networks using Alchemy REST API
    const networks = networksToFetch.map(network => {
      const config = getChainConfig(network);
      const baseUrl = config?.rpcUrl(alchemyKey).replace('/v2/', '/nft/v3/');
      return {
        name: network,
        url: `${baseUrl}/getNFTsForOwner?owner=${address}&withMetadata=true&pageSize=100`
      };
    });
  
    const allNfts: any[] = [];
  
    for (const network of networks) {
      try {
        const response = await fetch(network.url);
        
        if (!response.ok) {
          logger.warn(`[CDP API] Failed to fetch NFTs for ${network.name}: ${response.status}`);
          continue;
        }
  
        const data = await response.json();
        const nfts = data.ownedNfts || [];
  
        for (const nft of nfts) {
          const metadata = nft.raw?.metadata || {};
          const tokenId = nft.tokenId;
          const contractAddress = nft.contract?.address;
          
          // Get image URL and handle IPFS
          let imageUrl = metadata.image || nft.image?.cachedUrl || nft.image?.originalUrl || nft.image?.thumbnailUrl || '';
          if (imageUrl && imageUrl.startsWith('ipfs://')) {
            imageUrl = imageUrl.replace('ipfs://', 'https://ipfs.io/ipfs/');
          }

          // Populate icon cache with NFT image (for NFT contract addresses)
          this.setIconInCache(contractAddress, imageUrl);
  
          allNfts.push({
            chain: network.name,
            contractAddress,
            tokenId,
            name: metadata.name || nft.name || `${nft.contract?.name || 'Unknown'} #${tokenId}`,
            description: metadata.description || nft.description || '',
            image: imageUrl,
            contractName: nft.contract?.name || nft.contract?.symbol || 'Unknown Collection',
            tokenType: nft.contract?.tokenType || 'ERC721',
            balance: nft.balance, // For ERC1155
            attributes: metadata.attributes || [], // NFT attributes/traits
          });
        }
      } catch (err) {
        logger.warn(`[CDP API] Error fetching NFTs for ${network.name}:`, err instanceof Error ? err.message : String(err));
      }
    }
  
    logger.info(`[CDP API] Found ${allNfts.length} NFTs for user ${name}${chain ? ` on ${chain}` : ''}`);
  
    return {
      nfts: allNfts,
      address,
    };
  }

  // ============================================================================
  // Transaction History
  // ============================================================================

  /**
   * Helper: Extract timestamp from transaction data
   * Falls back to fetching block timestamp if metadata is missing
   */
  private async getTransactionTimestamp(tx: any, rpcUrl: string): Promise<number> {
    // Use blockTimestamp if available
    if (tx.metadata?.blockTimestamp) {
      return new Date(tx.metadata.blockTimestamp).getTime();
    }
    
    // Fallback: fetch block timestamp from blockNum
    if (tx.blockNum) {
      logger.warn(`[CdpTransactionManager] Missing blockTimestamp for tx ${tx.hash}, fetching from block ${tx.blockNum}`);
      try {
        const blockResponse = await fetch(rpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'eth_getBlockByNumber',
            params: [tx.blockNum, false],
          }),
        });
        const blockData = await blockResponse.json();
        if (blockData.result?.timestamp) {
          // Block timestamp is in hex seconds, convert to milliseconds
          return parseInt(blockData.result.timestamp, 16) * 1000;
        }
      } catch (blockError) {
        logger.warn(`[CdpTransactionManager] Failed to fetch block timestamp:`, blockError instanceof Error ? blockError.message : String(blockError));
      }
    }
    
    // Last resort: use current time
    return Date.now();
  }

  async getTransactionHistory(userId: string, providedAddress?: string): Promise<{
    transactions: Transaction[];
    address: string;
  }> {
    const client = this.getCdpClient();
    const alchemyKey = process.env.ALCHEMY_API_KEY;
    
    if (!alchemyKey) {
      throw new Error('Alchemy API key not configured');
    }

    logger.info(`[CdpTransactionManager] Fetching transaction history for user: ${userId.substring(0, 8)}...`);

    let address = providedAddress;
    
    // If address not provided, get it from CDP account (for write operations or when entity metadata unavailable)
    if (!address || typeof address !== 'string' || !address.match(/^0x[a-fA-F0-9]{40}$/)) {
      logger.debug(`[CDP API] Address not provided or invalid, fetching from CDP account...`);
      const account = await client.evm.getOrCreateAccount({ name: userId });
      address = account.address;
      
      // Validate address from account
      if (!address || typeof address !== 'string' || !address.match(/^0x[a-fA-F0-9]{40}$/)) {
        logger.error(`[CDP API] Invalid or missing account address for user: ${userId}. Address: ${address}`);
        throw new Error(`Failed to get valid wallet address. Account may not be initialized. Received: ${address || 'undefined'}`);
      }
    } else {
      logger.debug(`[CDP API] Using provided wallet address from entity metadata: ${address}`);
    }

    const networks = MAINNET_NETWORKS.map(network => {
        const config = getChainConfig(network);
        return {
          name: network,
          rpc: config?.rpcUrl(alchemyKey) || '',
          explorer: config?.explorerUrl || '',
        };
    }).filter(n => n.rpc && n.explorer);

    const allTransactions: Transaction[] = [];

    for (const network of networks) {
      try {
        // Fetch sent transactions
        const sentResponse = await fetch(network.rpc, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'alchemy_getAssetTransfers',
            params: [{
              fromAddress: address,
              category: ['external', 'erc20', 'erc721', 'erc1155'],
              // maxCount: '0x19',
              withMetadata: true,
              excludeZeroValue: true,
            }],
          }),
        });

        // Fetch received transactions
        const receivedResponse = await fetch(network.rpc, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 2,
            method: 'alchemy_getAssetTransfers',
            params: [{
              toAddress: address,
              category: ['external', 'erc20', 'erc721', 'erc1155'],
              // maxCount: '0x19',
              withMetadata: true,
              excludeZeroValue: true,
            }],
          }),
        });

        if (sentResponse.ok) {
          const sentData = await sentResponse.json();
          if (!sentData.error) {
            const sentTransfers = sentData?.result?.transfers || [];
            for (const tx of sentTransfers) {
              const timestamp = await this.getTransactionTimestamp(tx, network.rpc);
              const contractAddress = tx.rawContract?.address || null;
              
              // Get icon from global cache or fetch if not found
              const icon = contractAddress 
                ? await this.getOrFetchIcon(contractAddress, network.name)
                : null;
              
              allTransactions.push({
                chain: network.name,
                hash: tx.hash,
                from: tx.from,
                to: tx.to,
                value: tx.value?.toString() || '0',
                asset: tx.asset || 'ETH',
                category: tx.category,
                timestamp,
                blockNum: tx.blockNum,
                explorerUrl: `${network.explorer}/tx/${tx.hash}`,
                direction: 'sent',
                icon,
                contractAddress,
              });
            }
          }
        }

        if (receivedResponse.ok) {
          const receivedData = await receivedResponse.json();
          if (!receivedData.error) {
            const receivedTransfers = receivedData?.result?.transfers || [];
            for (const tx of receivedTransfers) {
              const timestamp = await this.getTransactionTimestamp(tx, network.rpc);
              const contractAddress = tx.rawContract?.address || null;
              
              // Get icon from global cache or fetch if not found
              const icon = contractAddress 
                ? await this.getOrFetchIcon(contractAddress, network.name)
                : null;
              
              allTransactions.push({
                chain: network.name,
                hash: tx.hash,
                from: tx.from,
                to: tx.to,
                value: tx.value?.toString() || '0',
                asset: tx.asset || 'ETH',
                category: tx.category,
                timestamp,
                blockNum: tx.blockNum,
                explorerUrl: `${network.explorer}/tx/${tx.hash}`,
                direction: 'received',
                icon,
                contractAddress,
              });
            }
          }
        }
      } catch (err) {
        logger.warn(`[CdpTransactionManager] Error fetching history for ${network.name}:`, err instanceof Error ? err.message : String(err));
      }
    }

    allTransactions.sort((a, b) => b.timestamp - a.timestamp);

    logger.info(`[CdpTransactionManager] Found ${allTransactions.length} transactions for user ${userId.substring(0, 8)}...`);

    return {
      transactions: allTransactions,
      address,
    };
  }

  // ============================================================================
  // Send Operations
  // ============================================================================

  async sendToken(params: {
    userId: string;
    network: string;
    to: string;
    token: string;
    amount: string;
  }): Promise<SendResult> {
    const { userId, network, to, token, amount } = params;

    logger.info(`[CdpTransactionManager] User ${userId.substring(0, 8)}... sending ${amount} ${token} to ${to} on ${network}`);

    const client = this.getCdpClient();
    let transactionHash: string | undefined;
    let fromAddress: string;
    let cdpSuccess = false;

    try {
      logger.info(`[CdpTransactionManager] Attempting transfer with CDP SDK...`);
      const account = await client.evm.getOrCreateAccount({ name: userId });
      const networkAccount = await account.useNetwork(network);
      fromAddress = account.address;

      const amountBigInt = BigInt(amount);

      const result = await networkAccount.transfer({
        to: to as `0x${string}`,
        amount: amountBigInt,
        token: token as any,
      });

      if (result.transactionHash) {
        transactionHash = result.transactionHash;
        cdpSuccess = true;
        logger.info(`[CdpTransactionManager] CDP SDK transfer submitted: ${transactionHash}`);
        await this.waitForTransactionConfirmation(transactionHash, network, 'CDP SDK transfer');
      }
    } catch (cdpError) {
      logger.warn(
        `[CdpTransactionManager] CDP SDK transfer failed, trying viem fallback:`,
        cdpError instanceof Error ? cdpError.message : String(cdpError)
      );

      // Fallback to viem (CDP server-managed wallet via toAccount)
      logger.info(`[CdpTransactionManager] Using viem fallback for transfer...`);
      
      const chain = getViemChain(network);
      if (!chain) {
        throw new Error(`Unsupported network: ${network}`);
      }

      const account = await client.evm.getOrCreateAccount({ name: userId });
      fromAddress = account.address;

      const alchemyKey = process.env.ALCHEMY_API_KEY;
      if (!alchemyKey) {
        throw new Error('Alchemy API key not configured');
      }

      const rpcUrl = getRpcUrl(network, alchemyKey);
      if (!rpcUrl) {
        throw new Error(`Could not get RPC URL for network: ${network}`);
      }

      const walletClient = createWalletClient({
        account: toAccount(account),
        chain,
        transport: http(rpcUrl),
      });

      const publicClient = createPublicClient({
        chain,
        transport: http(rpcUrl),
      });

      const amountBigInt = BigInt(amount);
      const isNativeToken = !token.startsWith('0x');
      
      if (isNativeToken) {
        logger.info(`[CdpTransactionManager] Sending native token via viem...`);
        const hash = await walletClient.sendTransaction({
          chain,
          to: to as `0x${string}`,
          value: amountBigInt,
        });
        transactionHash = hash;
      } else {
        logger.info(`[CdpTransactionManager] Sending ERC20 token ${token} via viem...`);
        
        const hash = await walletClient.writeContract({
          chain,
          address: token as `0x${string}`,
          abi: [
            {
              name: 'transfer',
              type: 'function',
              stateMutability: 'nonpayable',
              inputs: [
                { name: 'to', type: 'address' },
                { name: 'amount', type: 'uint256' }
              ],
              outputs: [{ name: '', type: 'bool' }]
            }
          ] as const,
          functionName: 'transfer',
          args: [to as `0x${string}`, amountBigInt],
        });
        transactionHash = hash;
      }

      await this.waitForTransactionConfirmation(transactionHash, network, 'Viem transfer');
    }

    if (!transactionHash) {
      throw new Error('Transfer did not return a transaction hash');
    }

    return {
      transactionHash,
      from: fromAddress!,
      to,
      amount: amount.toString(),
      token,
      network,
      method: cdpSuccess ? 'cdp-sdk' : 'viem-fallback',
    };
  }

  async sendNFT(params: {
    userId: string;
    network: string;
    to: string;
    contractAddress: string;
    tokenId: string;
  }): Promise<SendNFTResult> {
    const { userId, network, to, contractAddress, tokenId } = params;

    logger.info(`[CdpTransactionManager] User ${userId.substring(0, 8)}... sending NFT ${contractAddress}:${tokenId} to ${to} on ${network}`);

    const client = this.getCdpClient();
    const account = await client.evm.getOrCreateAccount({ name: userId });
    
    const chain = getViemChain(network);
    if (!chain) {
      throw new Error(`Unsupported network: ${network}`);
    }
    
    const alchemyKey = process.env.ALCHEMY_API_KEY;
    if (!alchemyKey) {
      throw new Error('Alchemy API key not configured');
    }
    
    const rpcUrl = getRpcUrl(network, alchemyKey);
    if (!rpcUrl) {
      throw new Error(`Could not get RPC URL for network: ${network}`);
    }
    
    const walletClient = createWalletClient({
      account: toAccount(account),
      chain,
      transport: http(rpcUrl),
    });
    
    const publicClient = createPublicClient({
      chain,
      transport: http(rpcUrl),
    });

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
      address: contractAddress as `0x${string}`,
      abi: erc721Abi,
      functionName: 'safeTransferFrom',
      args: [account.address as `0x${string}`, to as `0x${string}`, BigInt(tokenId)],
      chain,
    });

    await publicClient.waitForTransactionReceipt({ hash: txHash });

    logger.info(`[CdpTransactionManager] NFT transfer successful: ${txHash}`);

    return {
      transactionHash: txHash,
      from: account.address,
      to,
      contractAddress,
      tokenId,
      network,
    };
  }

  // ============================================================================
  // Swap Operations
  // ============================================================================

  async getSwapPrice(params: {
    userId: string;
    network: string;
    fromToken: string;
    toToken: string;
    fromAmount: string;
  }): Promise<SwapPriceResult & {
    fromAmount: string;
    fromToken: string;
    toToken: string;
    network: string;
  }> {
    const { userId, network, fromToken, toToken, fromAmount } = params;

    logger.info(`[CdpTransactionManager] Getting swap price for user ${userId.substring(0, 8)}...: ${fromAmount} ${fromToken} to ${toToken} on ${network}`);

    const client = this.getCdpClient();
    const account = await client.evm.getOrCreateAccount({ name: userId });

    // Validate account address for price estimation
    if (!account.address || typeof account.address !== 'string' || !account.address.match(/^0x[a-fA-F0-9]{40}$/)) {
      logger.warn(`[CdpTransactionManager] Invalid account address for swap price, account may not be initialized. Address: ${account.address || 'undefined'}`);
      // For price estimation, we can use a placeholder address or fall back to alternative methods
      // Use a zero address as placeholder for price estimation only
      account.address = '0x0000000000000000000000000000000000000000' as `0x${string}`;
    }

    const normalizedFromToken = normalizeTokenAddress(fromToken);
    const normalizedToToken = normalizeTokenAddress(toToken);

    logger.debug(`[CdpTransactionManager] Normalized tokens: ${normalizedFromToken} -> ${normalizedToToken}`);

    let swapPriceResult: SwapPriceResult;

    if (isCdpSwapSupported(network)) {
      logger.info(`[CdpTransactionManager] Using CDP SDK for swap price on ${network}`);
      
      try {
        const swapPrice = await client.evm.getSwapPrice({
          fromToken: normalizedFromToken as `0x${string}`,
          toToken: normalizedToToken as `0x${string}`,
          fromAmount: BigInt(fromAmount),
          network: network as any,
          taker: account.address,
        });

        swapPriceResult = {
          liquidityAvailable: swapPrice.liquidityAvailable,
          toAmount: (swapPrice as any).toAmount?.toString() || '0',
          minToAmount: (swapPrice as any).minToAmount?.toString() || '0',
        };
      } catch (cdpError) {
        logger.warn(`[CdpTransactionManager] CDP SDK swap price failed, falling back to 0x API / Uniswap V3:`, cdpError instanceof Error ? cdpError.message : String(cdpError));
        // Fall through to 0x API / Uniswap V3 fallback
        const zeroXQuote = await this.get0xQuote(network, fromToken, toToken, BigInt(fromAmount), account.address);
        
        if (zeroXQuote) {
          logger.info(`[CdpTransactionManager] Using 0x API quote (CDP SDK fallback)`);
          swapPriceResult = {
            liquidityAvailable: true,
            toAmount: zeroXQuote.toAmount,
            minToAmount: zeroXQuote.toAmount,
          };
        } else {
          logger.info(`[CdpTransactionManager] 0x API unavailable, falling back to Uniswap V3`);
          
          const quoterAddress = UNISWAP_V3_QUOTER[network];
          if (!quoterAddress) {
            logger.warn(`[CdpTransactionManager] Uniswap V3 Quoter not available for ${network}`);
            swapPriceResult = {
              liquidityAvailable: false,
              toAmount: '0',
              minToAmount: '0',
            };
          } else {
            const chain = getViemChain(network);
            if (!chain) {
              throw new Error(`Unsupported network: ${network}`);
            }

            const alchemyKey = process.env.ALCHEMY_API_KEY;
            if (!alchemyKey) {
              throw new Error('Alchemy API key not configured');
            }

            const rpcUrl = getRpcUrl(network, alchemyKey);
            if (!rpcUrl) {
              throw new Error(`Could not get RPC URL for network: ${network}`);
            }

            const publicClient = createPublicClient({
              chain,
              transport: http(rpcUrl),
            });

            const wrappedNativeAddress = WRAPPED_NATIVE_TOKEN[network];
            if (!wrappedNativeAddress) {
              throw new Error(`Wrapped native token not configured for network: ${network}`);
            }

            const isFromNative = normalizedFromToken === NATIVE_TOKEN_ADDRESS;
            const isToNative = normalizedToToken === NATIVE_TOKEN_ADDRESS;

            const uniswapFromToken = isFromNative ? wrappedNativeAddress : normalizedFromToken;
            const uniswapToToken = isToNative ? wrappedNativeAddress : normalizedToToken;

            try {
              const { amountOut } = await this.getUniswapQuote(
                publicClient,
                quoterAddress,
                uniswapFromToken,
                uniswapToToken,
                BigInt(fromAmount)
              );
              
              const toAmountStr = amountOut.toString();
              swapPriceResult = {
                liquidityAvailable: true,
                toAmount: toAmountStr,
                minToAmount: toAmountStr,
              };
            } catch (quoteError) {
              logger.warn(`[CdpTransactionManager] Failed to get Uniswap quote:`, quoteError instanceof Error ? quoteError.message : String(quoteError));
              swapPriceResult = {
                liquidityAvailable: false,
                toAmount: '0',
                minToAmount: '0',
              };
            }
          }
        }
      }
    } else {
      logger.info(`[CdpTransactionManager] Using 0x API / Uniswap V3 for price estimation on ${network}`);
      
      const zeroXQuote = await this.get0xQuote(network, fromToken, toToken, BigInt(fromAmount), account.address);
      
      if (zeroXQuote) {
        logger.info(`[CdpTransactionManager] Using 0x API quote`);
        swapPriceResult = {
          liquidityAvailable: true,
          toAmount: zeroXQuote.toAmount,
          minToAmount: zeroXQuote.toAmount,
        };
      } else {
        logger.info(`[CdpTransactionManager] 0x API unavailable, falling back to Uniswap V3`);
      
        const quoterAddress = UNISWAP_V3_QUOTER[network];
        if (!quoterAddress) {
          logger.warn(`[CdpTransactionManager] Uniswap V3 Quoter not available for ${network}`);
          swapPriceResult = {
            liquidityAvailable: false,
            toAmount: '0',
            minToAmount: '0',
          };
        } else {
          const chain = getViemChain(network);
          if (!chain) {
            throw new Error(`Unsupported network: ${network}`);
          }

          const alchemyKey = process.env.ALCHEMY_API_KEY;
          if (!alchemyKey) {
            throw new Error('Alchemy API key not configured');
          }

          const rpcUrl = getRpcUrl(network, alchemyKey);
          if (!rpcUrl) {
            throw new Error(`Could not get RPC URL for network: ${network}`);
          }

          const publicClient = createPublicClient({
            chain,
            transport: http(rpcUrl),
          });

          const wrappedNativeAddress = WRAPPED_NATIVE_TOKEN[network];
          if (!wrappedNativeAddress) {
            throw new Error(`Wrapped native token not configured for network: ${network}`);
          }

          const isFromNative = normalizedFromToken === NATIVE_TOKEN_ADDRESS;
          const isToNative = normalizedToToken === NATIVE_TOKEN_ADDRESS;

          const uniswapFromToken = isFromNative ? wrappedNativeAddress : normalizedFromToken;
          const uniswapToToken = isToNative ? wrappedNativeAddress : normalizedToToken;

          try {
            const { amountOut } = await this.getUniswapQuote(
              publicClient,
              quoterAddress,
              uniswapFromToken,
              uniswapToToken,
              BigInt(fromAmount)
            );
            
            const toAmountStr = amountOut.toString();
            swapPriceResult = {
              liquidityAvailable: true,
              toAmount: toAmountStr,
              minToAmount: toAmountStr,
            };
          } catch (quoteError) {
            logger.warn(`[CdpTransactionManager] Failed to get Uniswap quote:`, quoteError instanceof Error ? quoteError.message : String(quoteError));
            swapPriceResult = {
              liquidityAvailable: false,
              toAmount: '0',
              minToAmount: '0',
            };
          }
        }
      }
    }

    logger.info(`[CdpTransactionManager] Swap price retrieved. Liquidity available: ${swapPriceResult.liquidityAvailable}`);

    return {
      ...swapPriceResult,
      fromAmount,
      fromToken,
      toToken,
      network,
    };
  }

  async swap(params: {
    userId: string;
    network: string;
    fromToken: string;
    toToken: string;
    fromAmount: string;
    slippageBps: number;
  }): Promise<SwapResult> {
    const { userId, network, fromToken, toToken, fromAmount, slippageBps } = params;

    logger.info(`[CdpTransactionManager] User ${userId.substring(0, 8)}... executing swap: ${fromAmount} ${fromToken} to ${toToken} on ${network}`);

    const client = this.getCdpClient();
    const account = await client.evm.getOrCreateAccount({ name: userId });
    
    const normalizedFromToken = normalizeTokenAddress(fromToken);
    const normalizedToToken = normalizeTokenAddress(toToken);

    logger.debug(`[CdpTransactionManager] Normalized tokens: ${normalizedFromToken} -> ${normalizedToToken}`);

    // Pre-flight check: Verify token balance before attempting swap
    if (normalizedFromToken !== NATIVE_TOKEN_ADDRESS) {
      try {
        const chain = getViemChain(network);
        if (chain) {
          const alchemyKey = process.env.ALCHEMY_API_KEY;
          if (alchemyKey) {
            const rpcUrl = getRpcUrl(network, alchemyKey);
            if (rpcUrl) {
              const publicClient = createPublicClient({
                chain,
                transport: http(rpcUrl),
              });

              // Check ERC20 balance
              const balanceAbi = [
                {
                  name: 'balanceOf',
                  type: 'function',
                  stateMutability: 'view',
                  inputs: [{ name: 'account', type: 'address' }],
                  outputs: [{ name: '', type: 'uint256' }]
                }
              ] as const;

              const balance = await publicClient.readContract({
                address: normalizedFromToken as `0x${string}`,
                abi: balanceAbi,
                functionName: 'balanceOf',
                args: [account.address as `0x${string}`],
              });

              const amountBigInt = BigInt(fromAmount);
              if (balance < amountBigInt) {
                throw new Error(
                  `Insufficient token balance. You have ${balance.toString()} but need ${fromAmount}. ` +
                  `Please ensure you have enough tokens before attempting the swap.`
                );
              }

              logger.debug(`[CdpTransactionManager] Balance check passed: ${balance.toString()} >= ${fromAmount}`);
            }
          }
        }
      } catch (balanceError) {
        const errorMsg = balanceError instanceof Error ? balanceError.message : String(balanceError);
        if (errorMsg.includes('Insufficient token balance')) {
          throw balanceError; // Re-throw balance errors immediately
        }
        logger.debug(`[CdpTransactionManager] Could not verify balance (non-critical): ${errorMsg}`);
      }
    }

    let transactionHash: string | undefined;
    let method: string = 'unknown';
    let toAmount: string = '0';

    if (isCdpSwapSupported(network)) {
      try {
        logger.info(`[CdpTransactionManager] Attempting swap with CDP SDK...`);
        
        // Use networkAccount for CDP swap
        const networkAccount = await account.useNetwork(network);
        
        const swapResult = await (networkAccount as any).swap({
          fromToken: normalizedFromToken as `0x${string}`,
          toToken: normalizedToToken as `0x${string}`,
          fromAmount: BigInt(fromAmount),
          slippageBps: slippageBps,
        });

        transactionHash = swapResult.transactionHash;
        toAmount = swapResult.toAmount?.toString() || '0';
        method = 'cdp-sdk';
        
        if (!transactionHash) {
          throw new Error('CDP SDK swap did not return a transaction hash');
        }
        
        logger.info(`[CdpTransactionManager] CDP SDK swap submitted: ${transactionHash}`);
        await this.waitForTransactionConfirmation(transactionHash, network, 'CDP SDK swap');
      } catch (cdpError) {
        const errorMessage = cdpError instanceof Error ? cdpError.message : String(cdpError);
        logger.warn(`[CdpTransactionManager] CDP SDK swap failed:`, errorMessage);
        
        // Handle nonce issues - wait for pending transactions to clear and retry
        const errorString = errorMessage.toLowerCase();
        const isNonceError = errorString.includes('nonce') && (
          errorString.includes('too low') || 
          errorString.includes('re-create') ||
          errorString.includes('recreate')
        );
        
        if (isNonceError) {
          logger.info(`[CdpTransactionManager] Nonce issue detected, waiting for pending transactions...`);
          try {
            const chain = getViemChain(network);
            if (chain) {
              const alchemyKey = process.env.ALCHEMY_API_KEY;
              if (alchemyKey) {
                const rpcUrl = getRpcUrl(network, alchemyKey);
                if (rpcUrl) {
                  const publicClient = createPublicClient({
                    chain,
                    transport: http(rpcUrl),
                  });
                  
                  const currentNonce = await publicClient.getTransactionCount({
                    address: account.address as `0x${string}`,
                  });
                  
                  // Wait up to 30 seconds for pending transactions to be mined
                  const maxWait = 30_000;
                  const checkInterval = 2_000;
                  const startTime = Date.now();
                  
                  while (Date.now() - startTime < maxWait) {
                    await new Promise(resolve => setTimeout(resolve, checkInterval));
                    const newNonce = await publicClient.getTransactionCount({
                      address: account.address as `0x${string}`,
                      blockTag: 'pending',
                    });
                    
                    if (newNonce > currentNonce) {
                      break;
                    }
                  }
                  
                  // Wait for CDP SDK nonce cache to sync
                  await new Promise(resolve => setTimeout(resolve, 5000));
                  
                  // Retry CDP SDK swap after nonce cleared
                  try {
                    const networkAccount = await account.useNetwork(network);
                    const swapResult = await (networkAccount as any).swap({
                      fromToken: normalizedFromToken as `0x${string}`,
                      toToken: normalizedToToken as `0x${string}`,
                      fromAmount: BigInt(fromAmount),
                      slippageBps: slippageBps,
                    });

                    transactionHash = swapResult.transactionHash;
                    toAmount = swapResult.toAmount?.toString() || '0';
                    method = 'cdp-sdk-retry';
                    
                    if (!transactionHash) {
                      throw new Error('CDP SDK swap did not return a transaction hash');
                    }
                    
                    logger.info(`[CdpTransactionManager] CDP SDK swap retry submitted: ${transactionHash}`);
                    await this.waitForTransactionConfirmation(transactionHash, network, 'CDP SDK swap');
                    
                    return {
                      transactionHash,
                      from: account.address,
                      fromToken,
                      toToken,
                      fromAmount: fromAmount.toString(),
                      toAmount,
                      network,
                      method,
                    };
                  } catch (retryError) {
                    logger.warn(`[CdpTransactionManager] CDP SDK swap retry failed, falling back to 0x API`);
                  }
                }
              }
            }
          } catch (nonceError) {
            logger.warn(`[CdpTransactionManager] Nonce handling failed, falling back to 0x API`);
          }
        }

        // Check if error is about token approval for Permit2
        if (errorMessage.includes("allowance") && errorMessage.includes("Permit2")) {
          logger.info(`[CdpTransactionManager] Token approval needed for Permit2, handling approval...`);
          
          const PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as `0x${string}`;
          
          // Get viem clients for approval transaction
          const { walletClient, publicClient } = await this.getViemClientsForAccount({
            accountName: userId,
            network,
          });
          
          // ERC20 approve ABI
          const approveAbi = [{
            name: "approve",
            type: "function",
            stateMutability: "nonpayable",
            inputs: [
              { name: "spender", type: "address" },
              { name: "amount", type: "uint256" }
            ],
            outputs: [{ type: "bool" }]
          }] as const;
          
          // Approve max uint256 for Permit2
          logger.info(`[CdpTransactionManager] Sending Permit2 approval transaction for ${normalizedFromToken}...`);
          const approvalHash = await walletClient.writeContract({
            address: normalizedFromToken as `0x${string}`,
            abi: approveAbi,
            functionName: "approve",
            args: [
              PERMIT2_ADDRESS,
              BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff")
            ],
            chain: walletClient.chain,
          } as any);
          
          logger.info(`[CdpTransactionManager] Permit2 approval sent: ${approvalHash}`);
          
          // Wait for approval confirmation
          logger.info(`[CdpTransactionManager] Waiting for approval confirmation...`);
          const receipt = await publicClient.waitForTransactionReceipt({ 
            hash: approvalHash,
            timeout: 60_000,
          });
          logger.info(`[CdpTransactionManager] Approval confirmed in block ${receipt.blockNumber}`);
          
          // Wait for CDP SDK's nonce cache to sync with on-chain state
          logger.info(`[CdpTransactionManager] Waiting 8 seconds for CDP SDK nonce cache to sync...`);
          await new Promise(resolve => setTimeout(resolve, 8000));
          
          // Retry swap after approval using networkAccount
          try {
            logger.info(`[CdpTransactionManager] Retrying swap after Permit2 approval...`);
            const networkAccount = await account.useNetwork(network);
            
            const swapResult = await (networkAccount as any).swap({
              fromToken: normalizedFromToken as `0x${string}`,
              toToken: normalizedToToken as `0x${string}`,
              fromAmount: BigInt(fromAmount),
              slippageBps: slippageBps,
            });

            transactionHash = swapResult.transactionHash;
            toAmount = swapResult.toAmount?.toString() || '0';
            method = 'cdp-sdk-with-permit2';
            
            if (!transactionHash) {
              throw new Error('CDP SDK swap did not return a transaction hash');
            }
            
            logger.info(`[CdpTransactionManager] CDP SDK swap submitted after Permit2 approval: ${transactionHash}`);
            await this.waitForTransactionConfirmation(transactionHash, network, 'CDP SDK swap');
          } catch (retryError) {
            // If retry still fails after Permit2 approval, fallback to 0x API
            logger.warn(
              `[CdpTransactionManager] CDP SDK swap failed even after Permit2 approval, falling back to 0x API:`,
              retryError instanceof Error ? retryError.message : String(retryError)
            );
            
            const result = await this.executeSwapWith0x(
              account,
              network,
              fromToken,
              toToken,
              BigInt(fromAmount),
              slippageBps
            );

            transactionHash = result.transactionHash;
            toAmount = result.toAmount;
            method = `${result.method}-after-permit2-fallback`;
            logger.info(`[CdpTransactionManager] Fallback swap successful after Permit2 approval failure`);
          }
        } else {
          // Fallback to 0x API for CDP-supported networks if not an approval issue
          logger.info(`[CdpTransactionManager] Falling back to 0x API for ${network}...`);
          
          const result = await this.executeSwapWith0x(
            account,
            network,
            fromToken,
            toToken,
            BigInt(fromAmount),
            slippageBps
          );

          transactionHash = result.transactionHash;
          toAmount = result.toAmount;
          method = `${result.method}-fallback`;
          logger.info(`[CdpTransactionManager] Fallback swap successful with method: ${result.method}`);
        }
      }
    } else {
      // Non-CDP-supported networks: use 0x API
      logger.info(`[CdpTransactionManager] Using 0x API for swap on ${network}`);

      const result = await this.executeSwapWith0x(
        account,
        network,
        fromToken,
        toToken,
        BigInt(fromAmount),
        slippageBps
      );

      transactionHash = result.transactionHash;
      toAmount = result.toAmount;
      method = result.method;
      logger.info(`[CdpTransactionManager] Swap successful with method: ${result.method}`);
    }

    if (!transactionHash) {
      throw new Error('Swap did not return a transaction hash');
    }

    return {
      transactionHash,
      from: account.address,
      fromToken,
      toToken,
      fromAmount: fromAmount.toString(),
      toAmount,
      network,
      method,
    };
  }

  // ============================================================================
  // Private Helper Methods - Transaction Confirmation
  // ============================================================================

  /**
   * Wait for transaction receipt and verify it didn't revert
   * @param transactionHash Transaction hash to wait for
   * @param network Network name
   * @param operationName Name of the operation (for logging)
   * @returns Transaction receipt
   * @throws Error if transaction reverted
   */
  private async waitForTransactionConfirmation(
    transactionHash: string,
    network: string,
    operationName: string = 'Transaction'
  ): Promise<any> {
    const chain = getViemChain(network);
    if (!chain) {
      logger.warn(`[CdpTransactionManager] Cannot verify transaction on unsupported network: ${network}`);
      return null;
    }

    const alchemyKey = process.env.ALCHEMY_API_KEY;
    if (!alchemyKey) {
      logger.warn(`[CdpTransactionManager] Cannot verify transaction: Alchemy API key not configured`);
      return null;
    }

    const rpcUrl = getRpcUrl(network, alchemyKey);
    if (!rpcUrl) {
      logger.warn(`[CdpTransactionManager] Cannot verify transaction: Could not get RPC URL for network: ${network}`);
      return null;
    }

    const publicClient = createPublicClient({
      chain,
      transport: http(rpcUrl),
    });

    logger.info(`[CdpTransactionManager] Waiting for ${operationName.toLowerCase()} transaction confirmation...`);
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: transactionHash as `0x${string}`,
      timeout: 120_000, // 2 minutes timeout
    });

    if (receipt.status === 'reverted') {
      const explorerUrl = getChainConfig(network)?.explorerUrl;
      const txUrl = explorerUrl ? `${explorerUrl}/tx/${transactionHash}` : transactionHash;
      throw new Error(
        `${operationName} transaction reverted on-chain. View transaction: ${txUrl}`
      );
    }

    logger.info(`[CdpTransactionManager] ${operationName} confirmed in block ${receipt.blockNumber}`);
    return receipt;
  }

  // ============================================================================
  // Private Helper Methods - Swap Fallback
  // ============================================================================

  /**
   * Execute swap using 0x API
   */
  private async executeSwapWith0x(
    account: any,
    network: string,
    fromToken: string,
    toToken: string,
    fromAmount: bigint,
    slippageBps: number
  ): Promise<{ transactionHash: string; toAmount: string; method: string }> {
    const chain = getViemChain(network);
    if (!chain) {
      throw new Error(`Unsupported network: ${network}`);
    }

    const alchemyKey = process.env.ALCHEMY_API_KEY;
    if (!alchemyKey) {
      throw new Error('Alchemy API key not configured');
    }

    const rpcUrl = getRpcUrl(network, alchemyKey);
    if (!rpcUrl) {
      throw new Error(`Could not get RPC URL for network: ${network}`);
    }

    const walletClient = createWalletClient({
      account: toAccount(account),
      chain,
      transport: http(rpcUrl),
    });

    const publicClient = createPublicClient({
      chain,
      transport: http(rpcUrl),
    });

    logger.info(`[CdpTransactionManager] Attempting swap with 0x API...`);
    const result = await this.execute0xSwap(
      walletClient,
      publicClient,
      account,
      network,
      fromToken,
      toToken,
      fromAmount,
      slippageBps
    );

    return {
      transactionHash: result.transactionHash,
      toAmount: result.toAmount,
      method: '0x-api',
    };
  }

  // ============================================================================
  // Private Helper Methods - Token Approval & Wrapping
  // ============================================================================

  private async ensureTokenApproval(
    walletClient: any,
    publicClient: any,
    tokenAddress: string,
    spenderAddress: string,
    amount: bigint,
    ownerAddress: string
  ): Promise<void> {
    if (tokenAddress === NATIVE_TOKEN_ADDRESS) {
      return;
    }

    const allowanceAbi = [
      {
        name: 'allowance',
        type: 'function',
        stateMutability: 'view',
        inputs: [
          { name: 'owner', type: 'address' },
          { name: 'spender', type: 'address' }
        ],
        outputs: [{ name: '', type: 'uint256' }]
      }
    ] as const;

    const currentAllowance = await publicClient.readContract({
      address: tokenAddress as `0x${string}`,
      abi: allowanceAbi,
      functionName: 'allowance',
      args: [ownerAddress as `0x${string}`, spenderAddress as `0x${string}`],
    });

    if (currentAllowance >= amount) {
      logger.debug(`[CdpTransactionManager] Token ${tokenAddress} already approved`);
      return;
    }

    logger.info(`[CdpTransactionManager] Approving token ${tokenAddress} for ${spenderAddress}`);

    const approveAbi = [
      {
        name: 'approve',
        type: 'function',
        stateMutability: 'nonpayable',
        inputs: [
          { name: 'spender', type: 'address' },
          { name: 'amount', type: 'uint256' }
        ],
        outputs: [{ name: '', type: 'bool' }]
      }
    ] as const;

    const maxUint256 = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
    
    const hash = await walletClient.writeContract({
      address: tokenAddress as `0x${string}`,
      abi: approveAbi,
      functionName: 'approve',
      args: [spenderAddress as `0x${string}`, maxUint256],
    });

    await publicClient.waitForTransactionReceipt({ hash });
    logger.info(`[CdpTransactionManager] Token approval successful: ${hash}`);
  }

  private async wrapNativeToken(
    walletClient: any,
    publicClient: any,
    wrappedTokenAddress: string,
    amount: bigint
  ): Promise<string> {
    logger.info(`[CdpTransactionManager] Wrapping native token: ${amount.toString()}`);
    
    const wethAbi = [
      {
        name: 'deposit',
        type: 'function',
        stateMutability: 'payable',
        inputs: [],
        outputs: []
      }
    ] as const;

    const hash = await walletClient.writeContract({
      address: wrappedTokenAddress as `0x${string}`,
      abi: wethAbi,
      functionName: 'deposit',
      value: amount,
    });

    await publicClient.waitForTransactionReceipt({ hash });
    logger.info(`[CdpTransactionManager] Native token wrapped successfully: ${hash}`);
    return hash;
  }

  private async unwrapNativeToken(
    walletClient: any,
    publicClient: any,
    wrappedTokenAddress: string,
    ownerAddress: string
  ): Promise<{ hash: string; amount: bigint }> {
    logger.info(`[CdpTransactionManager] Unwrapping native token`);
    
    const balanceAbi = [
      {
        name: 'balanceOf',
        type: 'function',
        stateMutability: 'view',
        inputs: [{ name: 'account', type: 'address' }],
        outputs: [{ name: '', type: 'uint256' }]
      }
    ] as const;

    const wrappedBalance = await publicClient.readContract({
      address: wrappedTokenAddress as `0x${string}`,
      abi: balanceAbi,
      functionName: 'balanceOf',
      args: [ownerAddress as `0x${string}`],
    });

    if (wrappedBalance === 0n) {
      logger.warn(`[CdpTransactionManager] No wrapped tokens to unwrap`);
      return { hash: '', amount: 0n };
    }

    const wethWithdrawAbi = [
      {
        name: 'withdraw',
        type: 'function',
        stateMutability: 'nonpayable',
        inputs: [{ name: 'amount', type: 'uint256' }],
        outputs: []
      }
    ] as const;

    const hash = await walletClient.writeContract({
      address: wrappedTokenAddress as `0x${string}`,
      abi: wethWithdrawAbi,
      functionName: 'withdraw',
      args: [wrappedBalance],
    });

    await publicClient.waitForTransactionReceipt({ hash });
    logger.info(`[CdpTransactionManager] Unwrapped ${wrappedBalance.toString()} to native token: ${hash}`);
    
    return { hash, amount: wrappedBalance };
  }

  // ============================================================================
  // Private Helper Methods - Uniswap
  // ============================================================================

  private async getUniswapQuote(
    publicClient: any,
    quoterAddress: string,
    tokenIn: string,
    tokenOut: string,
    amountIn: bigint
  ): Promise<{ amountOut: bigint; fee: number }> {
    const quoterAbi = [
      {
        name: 'quoteExactInputSingle',
        type: 'function',
        stateMutability: 'nonpayable',
        inputs: [
          {
            name: 'params',
            type: 'tuple',
            components: [
              { name: 'tokenIn', type: 'address' },
              { name: 'tokenOut', type: 'address' },
              { name: 'amountIn', type: 'uint256' },
              { name: 'fee', type: 'uint24' },
              { name: 'sqrtPriceLimitX96', type: 'uint160' }
            ]
          }
        ],
        outputs: [
          { name: 'amountOut', type: 'uint256' },
          { name: 'sqrtPriceX96After', type: 'uint160' },
          { name: 'initializedTicksCrossed', type: 'uint32' },
          { name: 'gasEstimate', type: 'uint256' }
        ]
      }
    ] as const;
  
    const quoteParams = {
      tokenIn: tokenIn as `0x${string}`,
      tokenOut: tokenOut as `0x${string}`,
      amountIn,
      fee: UNISWAP_POOL_FEES.MEDIUM,
      sqrtPriceLimitX96: 0n,
    };
  
    const errors: string[] = [];
  
    // Try MEDIUM fee tier first
    try {
      const quoteResult = await publicClient.simulateContract({
        address: quoterAddress as `0x${string}`,
        abi: quoterAbi,
        functionName: 'quoteExactInputSingle',
        args: [quoteParams],
      });
      const amountOut = quoteResult.result[0];
      logger.info(`[CDP API] Uniswap quote (MEDIUM fee 0.3%): ${amountOut.toString()}`);
      return { amountOut, fee: UNISWAP_POOL_FEES.MEDIUM };
    } catch (mediumError) {
      const errMsg = mediumError instanceof Error ? mediumError.message : String(mediumError);
      errors.push(`MEDIUM(0.3%): ${errMsg.substring(0, 100)}`);
      logger.debug(`[CDP API] MEDIUM fee tier failed, trying LOW`);
    }
  
    // Try LOW fee tier
    quoteParams.fee = UNISWAP_POOL_FEES.LOW;
    try {
      const quoteResult = await publicClient.simulateContract({
        address: quoterAddress as `0x${string}`,
        abi: quoterAbi,
        functionName: 'quoteExactInputSingle',
        args: [quoteParams],
      });
      const amountOut = quoteResult.result[0];
      logger.info(`[CDP API] Uniswap quote (LOW fee 0.05%): ${amountOut.toString()}`);
      return { amountOut, fee: UNISWAP_POOL_FEES.LOW };
    } catch (lowError) {
      const errMsg = lowError instanceof Error ? lowError.message : String(lowError);
      errors.push(`LOW(0.05%): ${errMsg.substring(0, 100)}`);
      logger.debug(`[CDP API] LOW fee tier failed, trying HIGH`);
    }
  
    // Try HIGH fee tier as last resort
    quoteParams.fee = UNISWAP_POOL_FEES.HIGH;
    try {
      const quoteResult = await publicClient.simulateContract({
        address: quoterAddress as `0x${string}`,
        abi: quoterAbi,
        functionName: 'quoteExactInputSingle',
        args: [quoteParams],
      });
      const amountOut = quoteResult.result[0];
      logger.info(`[CDP API] Uniswap quote (HIGH fee 1%): ${amountOut.toString()}`);
      return { amountOut, fee: UNISWAP_POOL_FEES.HIGH };
    } catch (highError) {
      const errMsg = highError instanceof Error ? highError.message : String(highError);
      errors.push(`HIGH(1%): ${errMsg.substring(0, 100)}`);
    }
  
    // All fee tiers failed - no liquidity pool exists
    logger.warn(`[CDP API] No Uniswap V3 liquidity pool found for token pair ${tokenIn} -> ${tokenOut}`);
    throw new Error(`No Uniswap V3 liquidity pool exists for this token pair. This pair is not tradeable on Uniswap V3 on this network.`);
  }

  private async executeUniswapSwap(
    walletClient: any,
    publicClient: any,
    account: any,
    network: string,
    fromToken: string,
    toToken: string,
    fromAmount: bigint,
    slippageBps: number
  ): Promise<{ transactionHash: string; toAmount: string }> {
    const routerAddress = UNISWAP_V3_ROUTER[network];
    if (!routerAddress) {
      throw new Error(`Uniswap V3 not available on network: ${network}`);
    }
  
    const quoterAddress = UNISWAP_V3_QUOTER[network];
    if (!quoterAddress) {
      throw new Error(`Uniswap V3 Quoter not available on network: ${network}`);
    }
  
    const wrappedNativeAddress = WRAPPED_NATIVE_TOKEN[network];
    if (!wrappedNativeAddress) {
      throw new Error(`Wrapped native token not configured for network: ${network}`);
    }
  
    // Normalize token addresses
    const normalizedFromToken = normalizeTokenAddress(fromToken);
    const normalizedToToken = normalizeTokenAddress(toToken);
  
    const isFromNative = normalizedFromToken === NATIVE_TOKEN_ADDRESS;
    const isToNative = normalizedToToken === NATIVE_TOKEN_ADDRESS;
  
    const uniswapFromToken = isFromNative ? wrappedNativeAddress : normalizedFromToken;
    const uniswapToToken = isToNative ? wrappedNativeAddress : normalizedToToken;
  
    logger.debug(`[CDP API] Uniswap tokens: ${uniswapFromToken} -> ${uniswapToToken}`);
  
    // If swapping FROM native token, wrap it first
    if (isFromNative) {
      await this.wrapNativeToken(walletClient, publicClient, wrappedNativeAddress, fromAmount);
    }
  
    // Approve token if needed
    await this.ensureTokenApproval(
      walletClient,
      publicClient,
      uniswapFromToken,
      routerAddress,
      fromAmount,
      account.address
    );
  
    // Get quote for slippage calculation
    logger.info(`[CDP API] Getting Uniswap quote for slippage calculation`);
    const { amountOut: expectedAmountOut, fee } = await this.getUniswapQuote(
      publicClient,
      quoterAddress,
      uniswapFromToken,
      uniswapToToken,
      fromAmount
    );
  
    // Calculate minimum amount out based on slippage tolerance
    const minAmountOut = (expectedAmountOut * BigInt(10000 - slippageBps)) / BigInt(10000);
    logger.info(`[CDP API] Slippage protection: expected=${expectedAmountOut.toString()}, min=${minAmountOut.toString()} (${slippageBps}bps)`);
  
    // Prepare and execute swap
    const swapRouterAbi = [
      {
        name: 'exactInputSingle',
        type: 'function',
        stateMutability: 'payable',
        inputs: [
          {
            name: 'params',
            type: 'tuple',
            components: [
              { name: 'tokenIn', type: 'address' },
              { name: 'tokenOut', type: 'address' },
              { name: 'fee', type: 'uint24' },
              { name: 'recipient', type: 'address' },
              { name: 'deadline', type: 'uint256' },
              { name: 'amountIn', type: 'uint256' },
              { name: 'amountOutMinimum', type: 'uint256' },
              { name: 'sqrtPriceLimitX96', type: 'uint160' }
            ]
          }
        ],
        outputs: [{ name: 'amountOut', type: 'uint256' }]
      }
    ] as const;
  
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 60 * 20); // 20 minutes
    const swapParams = {
      tokenIn: uniswapFromToken as `0x${string}`,
      tokenOut: uniswapToToken as `0x${string}`,
      fee,
      recipient: account.address as `0x${string}`,
      deadline,
      amountIn: fromAmount,
      amountOutMinimum: minAmountOut,
      sqrtPriceLimitX96: 0n,
    };
  
    const data = encodeFunctionData({
      abi: swapRouterAbi,
      functionName: 'exactInputSingle',
      args: [swapParams],
    });
  
    const hash = await walletClient.sendTransaction({
      to: routerAddress as `0x${string}`,
      data,
      value: 0n,
      chain: walletClient.chain,
    });
  
    await this.waitForTransactionConfirmation(hash, network, 'Uniswap V3 swap');
  
    let finalAmount = expectedAmountOut.toString();
  
    // If swapping TO native token, unwrap it
    if (isToNative) {
      const { amount } = await this.unwrapNativeToken(walletClient, publicClient, wrappedNativeAddress, account.address);
      if (amount > 0n) {
        finalAmount = amount.toString();
      }
    }
  
    return {
      transactionHash: hash,
      toAmount: finalAmount,
    };
  }

  // ============================================================================
  // Private Helper Methods - 0x API
  // ============================================================================

  private async get0xQuote(
    network: string,
    fromToken: string,
    toToken: string,
    fromAmount: bigint,
    takerAddress: string
  ): Promise<{ toAmount: string; data?: any } | null> {
    const apiKey = process.env.OX_API_KEY;
    if (!apiKey) {
      logger.debug('[CDP API] 0x API key not configured');
      return null;
    }
  
    try {
      const normalizedFromToken = normalizeTokenAddress(fromToken);
      const normalizedToToken = normalizeTokenAddress(toToken);
  
      const chainIdMap: Record<string, string> = {
        'ethereum': '1',
        'polygon': '137',
        'arbitrum': '42161',
        'optimism': '10',
        'base': '8453',
      };
  
      const chainId = chainIdMap[network];
      if (!chainId) {
        logger.debug(`[CDP API] 0x API not available for network: ${network}`);
        return null;
      }

      // Build base parameters
      const params = new URLSearchParams({
        chainId,
        sellToken: normalizedFromToken,
        buyToken: normalizedToToken,
        sellAmount: fromAmount.toString(),
        taker: takerAddress,
      });

      // Add fee recipient (for monetization/affiliate fees)
      // Defaults to Otaku treasury address if not configured
      const feeRecipient = process.env.SWAP_FEE_RECIPIENT || '0xE42b492846A2A220FB607745A63aF7d91A035d12';
      const feeRecipientBps = process.env.SWAP_FEE_BPS || '10'; // Default 0.1% fee
      const feeToken = process.env.SWAP_FEE_TOKEN || 'sell'; // 'sell' or 'buy' - which token to receive fees in
      
      params.append('swapFeeRecipient', feeRecipient);
      params.append('swapFeeBps', feeRecipientBps);
      // swapFeeToken must be either buyToken or sellToken per 0x API docs
      params.append('swapFeeToken', feeToken === 'buy' ? normalizedToToken : normalizedFromToken);
      logger.debug(`[CDP API] Adding fee recipient: ${feeRecipient} (${feeRecipientBps}bps in ${feeToken}Token)`);
  
      const url = `https://api.0x.org/swap/allowance-holder/price?${params.toString()}`;
      
      logger.info(`[CDP API] Fetching 0x v2 price quote for ${network} (chainId: ${chainId})`);
      const response = await fetch(url, {
        headers: {
          '0x-api-key': apiKey,
          '0x-version': 'v2',
        },
      });
  
      if (!response.ok) {
        const errorText = await response.text();
        logger.warn(`[CDP API] 0x API v2 error (${response.status}): ${errorText.substring(0, 200)}`);
        return null;
      }
  
      const data = await response.json();
      
      if (!data.buyAmount) {
        logger.warn('[CDP API] 0x API v2 returned no buyAmount');
        return null;
      }
  
      logger.info(`[CDP API] 0x v2 quote successful: ${data.buyAmount} tokens expected`);
      return {
        toAmount: data.buyAmount,
        data,
      };
    } catch (error) {
      logger.warn('[CDP API] 0x API v2 request failed:', error instanceof Error ? error.message : String(error));
      return null;
    }
  }
  
  /**
   * Execute swap using 0x API v2
   */
  private async execute0xSwap(
    walletClient: any,
    publicClient: any,
    account: any,
    network: string,
    fromToken: string,
    toToken: string,
    fromAmount: bigint,
    slippageBps: number
  ): Promise<{ transactionHash: string; toAmount: string }> {
    const apiKey = process.env.OX_API_KEY;
    if (!apiKey) {
      throw new Error('0x API key not configured');
    }
  
    const normalizedFromToken = normalizeTokenAddress(fromToken);
    const normalizedToToken = normalizeTokenAddress(toToken);
  
    const chainIdMap: Record<string, string> = {
      'ethereum': '1',
      'polygon': '137',
      'arbitrum': '42161',
      'optimism': '10',
      'base': '8453',
    };
  
    const chainId = chainIdMap[network];
    if (!chainId) {
      throw new Error(`0x API not available for network: ${network}`);
    }
  
    const slippageBps_param = slippageBps;
  
    // Build base parameters
    const params = new URLSearchParams({
      chainId,
      sellToken: normalizedFromToken,
      buyToken: normalizedToToken,
      sellAmount: fromAmount.toString(),
      taker: account.address,
      slippageBps: slippageBps_param.toString(),
    });

    // Add fee recipient (for monetization/affiliate fees)
    // Defaults to Otaku treasury address if not configured
    const feeRecipient = process.env.SWAP_FEE_RECIPIENT || '0xE42b492846A2A220FB607745A63aF7d91A035d12';
    const feeRecipientBps = process.env.SWAP_FEE_BPS || '10'; // Default 0.1% fee
    const feeToken = process.env.SWAP_FEE_TOKEN || 'sell'; // 'sell' or 'buy' - which token to receive fees in
    
    params.append('swapFeeRecipient', feeRecipient);
    params.append('swapFeeBps', feeRecipientBps);
    // swapFeeToken must be either buyToken or sellToken per 0x API docs
    params.append('swapFeeToken', feeToken === 'buy' ? normalizedToToken : normalizedFromToken);
    logger.debug(`[CDP API] Adding fee recipient: ${feeRecipient} (${feeRecipientBps}bps in ${feeToken}Token)`);
  
    const url = `https://api.0x.org/swap/allowance-holder/quote?${params.toString()}`;
    
    logger.info(`[CDP API] Fetching 0x v2 swap quote with ${slippageBps}bps slippage (chainId: ${chainId})`);
    const response = await fetch(url, {
      headers: {
        '0x-api-key': apiKey,
        '0x-version': 'v2',
      },
    });
  
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`0x API v2 error (${response.status}): ${errorText.substring(0, 200)}`);
    }
  
    const quote = await response.json();
  
    if (!quote.transaction || !quote.transaction.to || !quote.transaction.data || !quote.buyAmount) {
      throw new Error('Invalid 0x API v2 response');
    }
  
    // Check if quote has expired (0x quotes typically expire after a few seconds)
    if (quote.expirationTimeSeconds) {
      const expirationTime = BigInt(quote.expirationTimeSeconds) * 1000n;
      const currentTime = BigInt(Date.now());
      const timeUntilExpiry = expirationTime - currentTime;
      
      if (timeUntilExpiry < 0n) {
        throw new Error('0x API quote has expired. Please try again.');
      }
      
      // Warn if quote is about to expire (less than 10 seconds)
      if (timeUntilExpiry < 10_000n) {
        logger.warn(`[CDP API] 0x quote expires in ${Number(timeUntilExpiry) / 1000}s, executing immediately`);
      }
    }
  
    const tx = quote.transaction;
  
    if (normalizedFromToken !== NATIVE_TOKEN_ADDRESS && quote.issues?.allowance) {
      const spender = quote.issues.allowance.spender || tx.to;
      await this.ensureTokenApproval(
        walletClient,
        publicClient,
        normalizedFromToken,
        spender,
        fromAmount,
        account.address
      );
    }
  
    logger.info(`[CDP API] Executing 0x v2 swap transaction`);
    
    // Double-check quote hasn't expired right before execution
    if (quote.expirationTimeSeconds) {
      const expirationTime = BigInt(quote.expirationTimeSeconds) * 1000n;
      const currentTime = BigInt(Date.now());
      if (expirationTime < currentTime) {
        throw new Error('0x API quote expired during execution. Please retry the swap.');
      }
    }
    
    const value = normalizedFromToken === NATIVE_TOKEN_ADDRESS ? fromAmount : (tx.value ? BigInt(tx.value) : 0n);
    
    const txParams: any = {
      to: tx.to as `0x${string}`,
      data: tx.data as `0x${string}`,
      value,
      chain: walletClient.chain,
    };
  
    if (tx.gas) {
      txParams.gas = BigInt(tx.gas);
    }

    const hash = await walletClient.sendTransaction(txParams);
    await this.waitForTransactionConfirmation(hash, network, '0x v2 swap');
  
    return {
      transactionHash: hash,
      toAmount: quote.buyAmount,
    };
  }

  // ============================================================================
  // Token Search Operations
  // ============================================================================

  async searchTokens(params: {
    query: string;
    chain?: string;
  }): Promise<{ tokens: any[] }> {
    const { query, chain } = params;

    if (!query || query.length < 2) {
      throw new Error('Query parameter is required (min 2 characters)');
    }

    const apiKey = process.env.COINGECKO_API_KEY;
    const isPro = Boolean(apiKey);
    const baseUrl = isPro ? 'https://pro-api.coingecko.com/api/v3' : 'https://api.coingecko.com/api/v3';

    logger.info(`[CdpTransactionManager] Searching tokens: "${query}" on chain: ${chain || 'all'}`);

    // Map chain names to CoinGecko platform IDs
    const networkToPlatformId: Record<string, string> = {
      'ethereum': 'ethereum',
      'base': 'base',
      'polygon': 'polygon-pos',
      'arbitrum': 'arbitrum-one',
      'optimism': 'optimistic-ethereum',
    };

    const chainIdToNetwork: Record<string, string> = {
      'ethereum': 'ethereum',
      'base': 'base',
      'polygon-pos': 'polygon',
      'arbitrum-one': 'arbitrum',
      'optimistic-ethereum': 'optimism',
    };

    let tokens: any[] = [];

    // Check if query is a contract address
    const isAddress = /^0x[a-fA-F0-9]{40}$/.test(query);

    if (isAddress) {
      // Search by contract address
      const platforms = chain 
        ? [networkToPlatformId[chain.toLowerCase()]] 
        : ['ethereum', 'base', 'polygon-pos', 'arbitrum-one', 'optimistic-ethereum'];

      for (const platformId of platforms) {
        if (!platformId) continue;
        
        try {
          const url = `${baseUrl}/coins/${platformId}/contract/${query}`;
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 10000);

          const response = await fetch(url, {
            method: 'GET',
            headers: {
              'Accept': 'application/json',
              ...(isPro && apiKey ? { 'x-cg-pro-api-key': apiKey } : {}),
              'User-Agent': 'Otaku-CDP-Wallet/1.0',
            },
            signal: controller.signal,
          });

          clearTimeout(timeout);

          if (response.ok) {
            const data = await response.json();
            const currentPrice = data.market_data?.current_price?.usd || null;

            // Get decimals from CoinGecko's detail_platforms
            const networkName = chainIdToNetwork[platformId] || platformId;
            const decimals = data.detail_platforms?.[platformId]?.decimal_place || 18;

            tokens.push({
              id: data.id,
              symbol: data.symbol?.toUpperCase() || 'UNKNOWN',
              name: data.name || 'Unknown Token',
              contractAddress: query,
              chain: networkName,
              icon: data.image?.small || data.image?.thumb || null,
              price: currentPrice,
              platforms: data.platforms || {},
              decimals,
            });
            break; // Found it, no need to check other chains
          }
        } catch (error) {
          logger.debug(`[CdpTransactionManager] Contract search failed on ${platformId}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      // Fallback to DexScreener if CoinGecko didn't find the token
      if (tokens.length === 0) {
        logger.info(`[CdpTransactionManager] Token not found on CoinGecko, trying DexScreener...`);
        
        const networksToTry = chain 
          ? [chain.toLowerCase()] 
          : ['ethereum', 'base', 'polygon', 'arbitrum', 'optimism'];

        for (const networkName of networksToTry) {
          try {
            const dexInfo = await this.getTokenInfoFromDexScreener(query, networkName);
            if (dexInfo && dexInfo.price) {
              tokens.push({
                id: `dex-${query}-${networkName}`,
                symbol: dexInfo.symbol?.toUpperCase() || 'UNKNOWN',
                name: dexInfo.name || 'Unknown Token',
                contractAddress: query,
                chain: networkName,
                icon: null,
                price: dexInfo.price,
                platforms: { [networkName]: query },
                decimals: 18, // DexScreener doesn't provide decimals, assume 18
              });
              logger.info(`[CdpTransactionManager] Found token on DexScreener for ${networkName}`);
              break; // Found it on DexScreener, stop searching
            }
          } catch (error) {
            logger.debug(`[CdpTransactionManager] DexScreener search failed on ${networkName}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }
    } else {
      // Search by symbol or name using search endpoint
      const searchUrl = `${baseUrl}/search?query=${encodeURIComponent(query)}`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      try {
        const response = await fetch(searchUrl, {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
            ...(isPro && apiKey ? { 'x-cg-pro-api-key': apiKey } : {}),
            'User-Agent': 'Otaku-CDP-Wallet/1.0',
          },
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!response.ok) {
          throw new Error(`CoinGecko search failed: ${response.status}`);
        }

        const searchData = await response.json();
        const coins = searchData.coins || [];

        // Get detailed info for top results (limit to 10 for performance)
        const topCoins = coins.slice(0, 10);
        
        for (const coin of topCoins) {
          try {
            const detailUrl = `${baseUrl}/coins/${coin.id}`;
            const detailController = new AbortController();
            const detailTimeout = setTimeout(() => detailController.abort(), 5000);

            const detailResponse = await fetch(detailUrl, {
              method: 'GET',
              headers: {
                'Accept': 'application/json',
                ...(isPro && apiKey ? { 'x-cg-pro-api-key': apiKey } : {}),
                'User-Agent': 'Otaku-CDP-Wallet/1.0',
              },
              signal: detailController.signal,
            });

            clearTimeout(detailTimeout);

            if (detailResponse.ok) {
              const data = await detailResponse.json();
              const platforms = data.platforms || {};
              const currentPrice = data.market_data?.current_price?.usd || null;

              // Find contract address for the requested chain or any supported chain
              let contractAddress: string | null = null;
              let tokenChain: string | null = null;
              let platformIdForDecimals: string | null = null;

              if (chain) {
                const platformId = networkToPlatformId[chain.toLowerCase()];
                if (platformId && platforms[platformId]) {
                  contractAddress = platforms[platformId];
                  tokenChain = chain.toLowerCase();
                  platformIdForDecimals = platformId;
                }
              } else {
                // Get first available supported chain
                for (const [platformId, address] of Object.entries(platforms)) {
                  if (chainIdToNetwork[platformId] && address) {
                    contractAddress = address as string;
                    tokenChain = chainIdToNetwork[platformId];
                    platformIdForDecimals = platformId;
                    break;
                  }
                }
              }

              if (contractAddress && tokenChain && platformIdForDecimals) {
                // Get decimals from CoinGecko's detail_platforms
                const decimals = data.detail_platforms?.[platformIdForDecimals]?.decimal_place || 18;

                tokens.push({
                  id: data.id,
                  symbol: data.symbol?.toUpperCase() || 'UNKNOWN',
                  name: data.name || 'Unknown Token',
                  contractAddress,
                  chain: tokenChain,
                  icon: data.image?.small || data.image?.thumb || null,
                  price: currentPrice,
                  platforms: data.platforms || {},
                  decimals,
                });
              }
            }
          } catch (error) {
            logger.debug(`[CdpTransactionManager] Failed to fetch details for ${coin.id}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      } catch (error) {
        logger.error(`[CdpTransactionManager] CoinGecko search failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    logger.info(`[CdpTransactionManager] Found ${tokens.length} tokens matching "${query}"`);

    return { tokens };
  }

  // ============================================================================
  // Private Helper Methods - Token Info & Utilities
  // ============================================================================

  private async getTokenInfo(contractAddress: string, platform: string): Promise<{
    price: number;
    icon?: string;
    name?: string;
    symbol?: string;
    decimals?: number;
  } | null> {
    const apiKey = process.env.COINGECKO_API_KEY;
    if (!apiKey) {
      logger.warn('[CdpTransactionManager] CoinGecko API key not configured');
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
          icon: data.image?.small,
          name: data.name || undefined,
          symbol: data.symbol?.toUpperCase() || undefined,
          decimals: data.detail_platforms?.[platform]?.decimal_place || 18,
        };
      }
    } catch (err) {
      logger.warn(`[CdpTransactionManager] Failed to fetch token info for ${contractAddress}:`, err instanceof Error ? err.message : String(err));
    }

    return null;
  }

  private async getTokenInfoFromDexScreener(address: string, chainId: string): Promise<{
    price?: number;
    liquidity?: number;
    volume24h?: number;
    priceChange24h?: number;
    name?: string;
    symbol?: string;
  } | null> {
    try {
      const url = `https://api.dexscreener.com/latest/dex/tokens/${address}`;
      const response = await fetch(url);
      
      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      const pairs = data.pairs || [];
      
      const pair = pairs.find((p: any) => p.chainId === chainId);
      
      if (!pair) {
        return null;
      }

      return {
        price: parseFloat(pair.priceUsd) || undefined,
        liquidity: parseFloat(pair.liquidity?.usd) || undefined,
        volume24h: parseFloat(pair.volume?.h24) || undefined,
        priceChange24h: parseFloat(pair.priceChange?.h24) || undefined,
        name: pair.baseToken?.name || undefined,
        symbol: pair.baseToken?.symbol || undefined,
      };
    } catch (err) {
      logger.warn(`[CdpTransactionManager] DexScreener error for ${address}:`, err instanceof Error ? err.message : String(err));
      return null;
    }
  }

  private async getNativeTokenPrice(coingeckoId: string): Promise<number> {
    const apiKey = process.env.COINGECKO_API_KEY;
    if (!apiKey) {
      logger.warn('[CdpTransactionManager] CoinGecko API key not configured');
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
      logger.warn(`[CdpTransactionManager] Failed to fetch native token price for ${coingeckoId}:`, err instanceof Error ? err.message : String(err));
    }

    return 0;
  }

  private safeBalanceToNumber(balanceHex: string, decimals: number): number {
    try {
      const balance = BigInt(balanceHex);
      const balanceStr = balance.toString();
      const decimalPoint = balanceStr.length - decimals;
      
      if (decimalPoint <= 0) {
        const zeros = '0'.repeat(Math.abs(decimalPoint));
        return parseFloat(`0.${zeros}${balanceStr}`);
      } else {
        const intPart = balanceStr.slice(0, decimalPoint);
        const fracPart = balanceStr.slice(decimalPoint);
        return parseFloat(`${intPart}.${fracPart}`);
      }
    } catch (err) {
      logger.warn(`[CdpTransactionManager] Error converting balance ${balanceHex} with ${decimals} decimals:`, err instanceof Error ? err.message : String(err));
      return 0;
    }
  }

  /**
   * Get top tokens by market cap and trending tokens for a specific chain
   */
  async getTopAndTrendingTokens(params: {
    chain: string;
    limit?: number;
  }): Promise<{ topTokens: any[]; trendingTokens: any[] }> {
    const { chain, limit = 20 } = params;

    if (!chain) {
      throw new Error('Chain parameter is required');
    }

    const apiKey = process.env.COINGECKO_API_KEY;
    const isPro = Boolean(apiKey);
    const baseUrl = isPro ? 'https://pro-api.coingecko.com/api/v3' : 'https://api.coingecko.com/api/v3';

    // Map chain names to CoinGecko category IDs
    const chainToCategory: Record<string, string> = {
      'ethereum': 'ethereum-ecosystem',
      'base': 'base-ecosystem',
      'polygon': 'polygon-ecosystem',
      'arbitrum': 'arbitrum-ecosystem',
      'optimism': 'optimism-ecosystem',
    };

    const categoryId = chainToCategory[chain.toLowerCase()];

    const topTokens: any[] = [];
    const trendingTokens: any[] = [];

    // Fetch top tokens by market cap - get contract addresses for swap functionality
    if (categoryId) {
      try {
        const url = `${baseUrl}/coins/markets?vs_currency=usd&category=${categoryId}&order=market_cap_desc&per_page=${Math.min(limit, 15)}&page=1&sparkline=false`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);

        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
            ...(isPro && apiKey ? { 'x-cg-pro-api-key': apiKey } : {}),
            'User-Agent': 'Otaku-CDP-Wallet/1.0',
          },
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (response.ok) {
          const data = await response.json();
          
          // Map chain names to CoinGecko platform IDs
          const networkToPlatformId: Record<string, string> = {
            'ethereum': 'ethereum',
            'base': 'base',
            'polygon': 'polygon-pos',
            'arbitrum': 'arbitrum-one',
            'optimism': 'optimistic-ethereum',
          };

          const platformId = networkToPlatformId[chain.toLowerCase()];

          // Fetch contract addresses for top tokens (limit to avoid too many calls)
          const topCoinIds = data.slice(0, 15).map((t: any) => t.id);
          
          // Batch fetch coin details to get contract addresses
          // Use Promise.allSettled to handle failures gracefully
          const coinDetailPromises = topCoinIds.map(async (coinId: string) => {
            try {
              const detailUrl = `${baseUrl}/coins/${coinId}`;
              const detailController = new AbortController();
              const detailTimeout = setTimeout(() => detailController.abort(), 5000);

              const detailResponse = await fetch(detailUrl, {
                method: 'GET',
                headers: {
                  'Accept': 'application/json',
                  ...(isPro && apiKey ? { 'x-cg-pro-api-key': apiKey } : {}),
                  'User-Agent': 'Otaku-CDP-Wallet/1.0',
                },
                signal: detailController.signal,
              });

              clearTimeout(detailTimeout);

              if (detailResponse.ok) {
                const detailData = await detailResponse.json();
                const platforms = detailData.platforms || {};
                const contractAddress = platformId ? platforms[platformId] : null;
                
                if (contractAddress) {
                  const decimals = detailData.detail_platforms?.[platformId]?.decimal_place || 18;
                  const tokenData = data.find((t: any) => t.id === coinId);
                  
                  return {
                    id: coinId,
                    symbol: tokenData?.symbol?.toUpperCase() || 'UNKNOWN',
                    name: tokenData?.name || 'Unknown Token',
                    contractAddress,
                    chain: chain.toLowerCase(),
                    icon: tokenData?.image || null,
                    price: tokenData?.current_price || null,
                    decimals,
                  };
                }
              }
            } catch (error) {
              logger.debug(`[CdpTransactionManager] Failed to get contract for ${coinId}: ${error instanceof Error ? error.message : String(error)}`);
            }
            return null;
          });

          const coinDetails = await Promise.allSettled(coinDetailPromises);
          
          for (const result of coinDetails) {
            if (result.status === 'fulfilled' && result.value) {
              topTokens.push(result.value);
            }
          }
        }
      } catch (error) {
        logger.warn(`[CdpTransactionManager] Failed to fetch top tokens: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // Fetch trending tokens from CoinGecko
    try {
      const trendingUrl = `${baseUrl}/search/trending`;
      const trendingController = new AbortController();
      const trendingTimeout = setTimeout(() => trendingController.abort(), 10000);

      const trendingResponse = await fetch(trendingUrl, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          ...(isPro && apiKey ? { 'x-cg-pro-api-key': apiKey } : {}),
          'User-Agent': 'Otaku-CDP-Wallet/1.0',
        },
        signal: trendingController.signal,
      });

      clearTimeout(trendingTimeout);

      if (trendingResponse.ok) {
        const trendingData = await trendingResponse.json();
        const coins = trendingData.coins || [];
        
        // Map chain names to CoinGecko platform IDs
        const networkToPlatformId: Record<string, string> = {
          'ethereum': 'ethereum',
          'base': 'base',
          'polygon': 'polygon-pos',
          'arbitrum': 'arbitrum-one',
          'optimism': 'optimistic-ethereum',
        };

        const platformId = networkToPlatformId[chain.toLowerCase()];

        // Get top trending coins (limit to avoid too many API calls)
        const trendingCoinIds = coins.slice(0, Math.min(limit, 15)).map((coin: any) => coin.item?.id).filter(Boolean);
        
        // Fetch contract addresses for trending tokens
        const trendingDetailPromises = trendingCoinIds.map(async (coinId: string) => {
          try {
            const detailUrl = `${baseUrl}/coins/${coinId}`;
            const detailController = new AbortController();
            const detailTimeout = setTimeout(() => detailController.abort(), 5000);

            const detailResponse = await fetch(detailUrl, {
              method: 'GET',
              headers: {
                'Accept': 'application/json',
                ...(isPro && apiKey ? { 'x-cg-pro-api-key': apiKey } : {}),
                'User-Agent': 'Otaku-CDP-Wallet/1.0',
              },
              signal: detailController.signal,
            });

            clearTimeout(detailTimeout);

            if (detailResponse.ok) {
              const detailData = await detailResponse.json();
              const platforms = detailData.platforms || {};
              const contractAddress = platformId ? platforms[platformId] : null;
              
              if (contractAddress) {
                const decimals = detailData.detail_platforms?.[platformId]?.decimal_place || 18;
                const coinItem = coins.find((c: any) => c.item?.id === coinId)?.item;
                
                // Get current price from markets endpoint
                let price = null;
                try {
                  const priceUrl = `${baseUrl}/simple/price?ids=${coinId}&vs_currencies=usd`;
                  const priceController = new AbortController();
                  const priceTimeout = setTimeout(() => priceController.abort(), 5000);
                  const priceResponse = await fetch(priceUrl, {
                    method: 'GET',
                    headers: {
                      'Accept': 'application/json',
                      ...(isPro && apiKey ? { 'x-cg-pro-api-key': apiKey } : {}),
                      'User-Agent': 'Otaku-CDP-Wallet/1.0',
                    },
                    signal: priceController.signal,
                  });
                  clearTimeout(priceTimeout);
                  if (priceResponse.ok) {
                    const priceData = await priceResponse.json();
                    price = priceData[coinId]?.usd || null;
                  }
                } catch (error) {
                  logger.debug(`[CdpTransactionManager] Failed to get price for ${coinId}`);
                }
                
                return {
                  id: coinId,
                  symbol: coinItem?.symbol?.toUpperCase() || detailData.symbol?.toUpperCase() || 'UNKNOWN',
                  name: coinItem?.name || detailData.name || 'Unknown Token',
                  contractAddress,
                  chain: chain.toLowerCase(),
                  icon: coinItem?.large || coinItem?.thumb || detailData.image?.large || detailData.image?.thumb || null,
                  price,
                  decimals,
                };
              }
            }
          } catch (error) {
            logger.debug(`[CdpTransactionManager] Failed to get trending token details for ${coinId}: ${error instanceof Error ? error.message : String(error)}`);
          }
          return null;
        });

        const trendingDetails = await Promise.allSettled(trendingDetailPromises);
        
        for (const result of trendingDetails) {
          if (result.status === 'fulfilled' && result.value) {
            trendingTokens.push(result.value);
          }
        }
      }
    } catch (error) {
      logger.warn(`[CdpTransactionManager] Failed to fetch trending tokens: ${error instanceof Error ? error.message : String(error)}`);
    }

    return { topTokens, trendingTokens };
  }
}


