import { useState, useEffect, useCallback, useRef } from 'react';
import { useCDPWallet } from '@/hooks/useCDPWallet';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Bullet } from '@/components/ui/bullet';
import { Copy, Check, TrendingUp, RefreshCw, Send } from 'lucide-react';
import { formatUnits, createPublicClient, http } from 'viem';
import { base, mainnet, polygon } from 'viem/chains';

// Supported chains
type ChainNetwork = 'base' | 'ethereum' | 'polygon';

interface ChainConfig {
  name: string;
  rpcUrl: string;
  nativeToken: {
    symbol: string;
    name: string;
    coingeckoId: string;
  };
  coingeckoPlatform: string;
}

const CHAIN_CONFIGS: Record<ChainNetwork, ChainConfig> = {
  base: {
    name: 'Base',
    rpcUrl: 'BASE_RPC_URL',
    nativeToken: { symbol: 'ETH', name: 'Ethereum', coingeckoId: 'ethereum' },
    coingeckoPlatform: 'base',
  },
  ethereum: {
    name: 'Ethereum',
    rpcUrl: 'ETHEREUM_RPC_URL',
    nativeToken: { symbol: 'ETH', name: 'Ethereum', coingeckoId: 'ethereum' },
    coingeckoPlatform: 'ethereum',
  },
  polygon: {
    name: 'Polygon',
    rpcUrl: 'POLYGON_RPC_URL',
    nativeToken: { symbol: 'MATIC', name: 'Polygon', coingeckoId: 'matic-network' },
    coingeckoPlatform: 'polygon-pos',
  },
};

// Viem chain mapping
const VIEM_CHAINS = {
  base,
  ethereum: mainnet,
  polygon,
};

// ERC20 ABI for token metadata
const ERC20_METADATA_ABI = [
  {
    name: 'symbol',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    name: 'decimals',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
  {
    name: 'name',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
] as const;

// Token balance interface
interface TokenBalance {
  symbol: string;
  name: string;
  balance: string;
  balanceFormatted: string;
  usdValue: number;
  icon: string;
  contractAddress?: string;
  chain: ChainNetwork;
}

// Token info from CoinGecko
interface TokenInfo {
  symbol: string;
  name: string;
  decimals: number;
  price?: number;
  icon?: string;
}

/**
 * CDP Wallet Card Component
 * 
 * Displays CDP wallet information with balance, funding options, and sign out.
 * 
 * Features:
 * - Real-time ETH balance display
 * - Copy wallet address
 * - Fund wallet with Coinbase Pay
 * - Sign out functionality
 */
export function CDPWalletCard() {
  // Use custom CDP wallet hook for centralized wallet state
  const { isInitialized, isSignedIn, evmAddress, signOut } = useCDPWallet();

  // Local state
  const [error, setError] = useState('');
  const [tokens, setTokens] = useState<TokenBalance[]>([]);
  const [isLoadingTokens, setIsLoadingTokens] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [showFundModal, setShowFundModal] = useState(false);
  const [activeTab, setActiveTab] = useState<'tokens' | 'collections' | 'history'>('tokens');
  const [loadedChains, setLoadedChains] = useState<ChainNetwork[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  
  // Ref to store the auto-refresh interval
  const refreshIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Helper function to get token icon based on symbol
  const getTokenIcon = (symbol: string): string => {
    if (symbol === 'ETH' || symbol === 'WETH') return '⟠';
    if (symbol === 'MATIC') return '🟣';
    if (symbol === 'USDC' || symbol === 'USDbC' || symbol === 'USDT') return '💵';
    if (symbol === 'DAI') return '💰';
    if (symbol === 'WBTC' || symbol === 'BTC') return '₿';
    return '🪙';
  };

  // Fetch token data from DexScreener (fallback for tokens not on CoinGecko)
  const fetchDexScreenerData = useCallback(async (tokenAddress: string): Promise<{
    priceUsd: number;
    liquidityUsd: number;
    volumeUsd24h: number;
    marketCap: number;
  } | null> => {
    try {
      const url = `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`;
      const response = await fetch(url);

      if (!response.ok) {
        console.warn(`DEX Screener request failed: ${response.status}`);
        return null;
      }

      const data: any = await response.json();
      const firstPair = data?.pairs?.[0];

      if (!firstPair) return null;

      return {
        priceUsd: parseFloat(firstPair.priceUsd || "0"),
        liquidityUsd: parseFloat(firstPair.liquidity?.usd || "0"),
        volumeUsd24h: parseFloat(firstPair.volume?.h24 || "0"),
        marketCap: parseFloat(firstPair.fdv || "0"),
      };
    } catch (error) {
      console.warn(
        "Failed to fetch from DEX Screener:",
        error instanceof Error ? error.message : String(error),
      );
      return null;
    }
  }, []);

  // Get token info from CoinGecko Pro API, fallback to DexScreener if not found
  const getTokenInfo = useCallback(async (contractAddress: string, chain: ChainNetwork): Promise<TokenInfo | null> => {
    const apiKey = import.meta.env.COINGECKO_API_KEY;
    
    // Try CoinGecko first if API key is available
    if (apiKey) {
      try {
        const platform = CHAIN_CONFIGS[chain].coingeckoPlatform;
        const baseUrl = 'https://pro-api.coingecko.com/api/v3';
        const url = `${baseUrl}/coins/${platform}/contract/${contractAddress}`;
        
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
            'x-cg-pro-api-key': apiKey,
            'User-Agent': 'OtakuFE-Wallet/1.0',
          },
          signal: controller.signal,
        });
        
        clearTimeout(timeout);

        if (response.ok) {
          const data = await response.json();
          
          return {
            symbol: (data.symbol || '').toUpperCase(),
            name: data.name || 'Unknown Token',
            decimals: data.detail_platforms?.[platform]?.decimal_place || 18,
            price: data.market_data?.current_price?.usd || 0,
            icon: data.image?.small || undefined,
          };
        } else {
          console.warn(`⚠️ CoinGecko failed for ${contractAddress} on ${chain}: ${response.status}, trying DexScreener...`);
        }
      } catch (err) {
        console.warn(`⚠️ CoinGecko error for ${contractAddress}:`, err instanceof Error ? err.message : String(err));
      }
    }

    // Fallback to DexScreener if CoinGecko fails or no API key
    console.log(`🔄 Fetching ${contractAddress} from DexScreener...`);
    try {
      const dexData = await fetchDexScreenerData(contractAddress);
      
      if (dexData && dexData.priceUsd > 0) {
        // Fetch token metadata from blockchain
        try {
          const viemChain = VIEM_CHAINS[chain];
          const publicClient = createPublicClient({
            chain: viemChain,
            transport: http(),
          });

          const [symbol, name, decimals] = await Promise.all([
            publicClient.readContract({
              address: contractAddress as `0x${string}`,
              abi: ERC20_METADATA_ABI,
              functionName: 'symbol',
            }),
            publicClient.readContract({
              address: contractAddress as `0x${string}`,
              abi: ERC20_METADATA_ABI,
              functionName: 'name',
            }),
            publicClient.readContract({
              address: contractAddress as `0x${string}`,
              abi: ERC20_METADATA_ABI,
              functionName: 'decimals',
            }),
          ]);

          return {
            symbol: (symbol || 'UNKNOWN').toUpperCase(),
            name: name || 'Unknown Token',
            decimals: decimals || 18,
            price: dexData.priceUsd,
            icon: undefined, // DexScreener doesn't provide images
          };
        } catch (onChainErr) {
          console.warn(`⚠️ Failed to fetch on-chain metadata for ${contractAddress}:`, onChainErr);
          // Return with defaults if on-chain fetch fails
          return {
            symbol: 'UNKNOWN',
            name: 'Unknown Token',
            decimals: 18,
            price: dexData.priceUsd,
            icon: undefined,
          };
        }
      }
    } catch (err) {
      console.warn(`⚠️ DexScreener error for ${contractAddress}:`, err instanceof Error ? err.message : String(err));
    }

    return null;
  }, [fetchDexScreenerData]);

  // Fetch token balances for a specific chain
  const fetchChainBalances = useCallback(async (chain: ChainNetwork): Promise<{ success: boolean; balances: TokenBalance[] }> => {
    const chainConfig = CHAIN_CONFIGS[chain];
    const rpcUrl = import.meta.env[chainConfig.rpcUrl];
    
    if (!rpcUrl) {
      console.warn(`⚠️ ${chainConfig.rpcUrl} not configured, skipping ${chain}`);
      return { success: false, balances: [] };
    }

    try {
      // Step 1: Fetch ERC20 token balances from Alchemy
      const tokensResponse = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'alchemy_getTokenBalances',
          params: [evmAddress],
        }),
      });

      // Check for HTTP errors (403, 401, etc.)
      if (!tokensResponse.ok) {
        console.warn(`⚠️ ${chain} chain returned ${tokensResponse.status}: ${tokensResponse.statusText}`);
        if (tokensResponse.status === 403) {
          console.warn(`   Alchemy API key doesn't have access to ${chain}. Check your subscription.`);
        }
        return { success: false, balances: [] };
      }

      const tokensJson = await tokensResponse.json();
      
      // Check for JSON-RPC errors
      if (tokensJson.error) {
        console.warn(`⚠️ ${chain} RPC error:`, tokensJson.error);
        return { success: false, balances: [] };
      }

      const tokenBalances = tokensJson?.result?.tokenBalances || [];

      if (!Array.isArray(tokenBalances)) {
        console.warn(`⚠️ Unexpected response format from Alchemy for ${chain}`);
        return { success: false, balances: [] };
      }

      // Step 2: Fetch native token balance (ETH/MATIC)
      const nativeResponse = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'eth_getBalance',
          params: [evmAddress, 'latest'],
        }),
      });
      const nativeJson = await nativeResponse.json();
      const nativeBalance = BigInt(nativeJson.result || '0');

      const balances: TokenBalance[] = [];

      // Step 3: Add native token balance (ETH or MATIC) - only if balance > 0
      if (nativeBalance > 0n) {
        const amount = Number(formatUnits(nativeBalance, 18));
        
        // Get native token price from CoinGecko
        let price = 0;
        try {
          const priceResponse = await fetch(
            `https://api.coingecko.com/api/v3/simple/price?ids=${chainConfig.nativeToken.coingeckoId}&vs_currencies=usd`
          );
          const priceData = await priceResponse.json();
          price = priceData[chainConfig.nativeToken.coingeckoId]?.usd || 0;
        } catch (err) {
          console.error(`Failed to fetch ${chainConfig.nativeToken.symbol} price:`, err);
        }

        balances.push({
          symbol: chainConfig.nativeToken.symbol,
          name: chainConfig.nativeToken.name,
          balance: amount.toString(),
          balanceFormatted: amount.toFixed(6),
          usdValue: amount * price,
          icon: getTokenIcon(chainConfig.nativeToken.symbol),
          chain,
        });
      }

      // Step 4: Loop and enrich ERC20 token info using CoinGecko - only show tokens with balance > 0
      for (const { contractAddress, tokenBalance } of tokenBalances) {
        try {
          // Skip tokens with 0 balance
          if (BigInt(tokenBalance) === 0n) continue;

          const info = await getTokenInfo(contractAddress, chain);
          if (info) {
            const amount = Number(formatUnits(BigInt(tokenBalance), info.decimals));
            const usdValue = amount * (info.price || 0);

            balances.push({
              symbol: info.symbol,
              name: info.name,
              balance: amount.toString(),
              balanceFormatted: amount.toFixed(6),
              usdValue,
              icon: info.icon || getTokenIcon(info.symbol),
              contractAddress,
              chain,
            });
          }
        } catch (err) {
          console.warn(`⚠️ Skipping token ${contractAddress} on ${chain}:`, err instanceof Error ? err.message : String(err));
        }
      }

      return { success: true, balances };
    } catch (err: any) {
      console.error(`Failed to fetch balances for ${chain}:`, err);
      return { success: false, balances: [] };
    }
  }, [evmAddress, getTokenInfo]);

  // Fetch token balances across all supported chains
  const fetchTokenBalances = useCallback(async (isManualRefresh = false) => {
    if (!evmAddress) return;
    
    try {
      if (isManualRefresh) {
        setIsRefreshing(true);
      } else {
        setIsLoadingTokens(true);
      }
      
      // Fetch balances from all chains in parallel
      const chains: ChainNetwork[] = ['base', 'ethereum', 'polygon'];
      const results = await Promise.all(chains.map(chain => fetchChainBalances(chain)));
      
      // Track which chains successfully loaded (even if all balances are 0)
      const successfulChains = chains.filter((chain, index) => results[index].success);
      setLoadedChains(successfulChains);
      
      // Flatten and combine all balances from successful chains
      const allBalances = results.flatMap(result => result.balances);
      
      // Sort by USD value descending
      allBalances.sort((a, b) => b.usdValue - a.usdValue);
      
      setTokens(allBalances);
      console.log(`✅ Loaded ${allBalances.length} tokens across ${successfulChains.length}/${chains.length} chains:`, successfulChains);
    } catch (err: any) {
      console.error('Failed to fetch token balances:', err);
      setError('Failed to load token balances');
    } finally {
      setIsLoadingTokens(false);
      setIsRefreshing(false);
    }
  }, [evmAddress, fetchChainBalances]);

  // Fetch transaction history for the wallet
  const fetchTransactionHistory = useCallback(async () => {
    if (!evmAddress) return;
    
    setIsLoadingHistory(true);
    try {
      const chains: ChainNetwork[] = ['base', 'ethereum', 'polygon'];
      const allTransactions: any[] = [];
      
      for (const chain of chains) {
        const chainConfig = CHAIN_CONFIGS[chain];
        const rpcUrl = import.meta.env[chainConfig.rpcUrl];
        if (!rpcUrl) continue;
        
        try {
          // Fetch sent transactions (fromAddress)
          const sentResponse = await fetch(rpcUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              method: 'alchemy_getAssetTransfers',
              params: [{
                fromAddress: evmAddress,
                category: ['external', 'erc20', 'erc721', 'erc1155'],
                maxCount: '0x19', // 25 transactions
                withMetadata: true,
                excludeZeroValue: false,
              }],
            }),
          });
          
          // Fetch received transactions (toAddress)
          const receivedResponse = await fetch(rpcUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 2,
              method: 'alchemy_getAssetTransfers',
              params: [{
                toAddress: evmAddress,
                category: ['external', 'erc20', 'erc721', 'erc1155'],
                maxCount: '0x19', // 25 transactions
                withMetadata: true,
                excludeZeroValue: false,
              }],
            }),
          });
          
          if (sentResponse.ok) {
            const sentData = await sentResponse.json();
            if (sentData.error) {
              console.warn(`⚠️ ${chain} sent transactions error:`, sentData.error);
            } else {
              const sentTransfers = sentData?.result?.transfers || [];
              sentTransfers.forEach((tx: any) => {
                allTransactions.push({
                  ...tx,
                  chain,
                  chainName: chainConfig.name,
                  direction: 'sent',
                });
              });
            }
          } else {
            console.warn(`⚠️ ${chain} sent transactions: HTTP ${sentResponse.status}`);
          }
          
          if (receivedResponse.ok) {
            const receivedData = await receivedResponse.json();
            if (receivedData.error) {
              console.warn(`⚠️ ${chain} received transactions error:`, receivedData.error);
            } else {
              const receivedTransfers = receivedData?.result?.transfers || [];
              receivedTransfers.forEach((tx: any) => {
                allTransactions.push({
                  ...tx,
                  chain,
                  chainName: chainConfig.name,
                  direction: 'received',
                });
              });
            }
          } else {
            console.warn(`⚠️ ${chain} received transactions: HTTP ${receivedResponse.status}`);
          }
        } catch (err) {
          console.warn(`❌ Failed to fetch history for ${chain}:`, err);
        }
      }
      
      // Sort by block number (most recent first)
      allTransactions.sort((a, b) => {
        const blockA = parseInt(a.blockNum, 16) || 0;
        const blockB = parseInt(b.blockNum, 16) || 0;
        return blockB - blockA;
      });
      
      setTransactions(allTransactions);
      console.log(`📜 Loaded ${allTransactions.length} transactions`);
    } catch (err: any) {
      console.error('Failed to fetch transaction history:', err);
      setError('Failed to load transaction history');
    } finally {
      setIsLoadingHistory(false);
    }
  }, [evmAddress]);

  // Helper to start/restart the auto-refresh timer
  const startAutoRefresh = useCallback(() => {
    // Clear existing interval
    if (refreshIntervalRef.current) {
      clearInterval(refreshIntervalRef.current);
    }
    
    // Start new interval - auto-refresh every 2 minutes (120000ms)
    refreshIntervalRef.current = setInterval(() => {
      console.log('🔄 Auto-refreshing token balances...');
      fetchTokenBalances();
    }, 120000);
  }, [fetchTokenBalances]);

  // Fetch token balances when address is available
  useEffect(() => {
    if (!evmAddress) {
      // Clear interval if no address
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
        refreshIntervalRef.current = null;
      }
      return;
    }
    
    // Initial fetch
    setIsLoadingTokens(true);
    fetchTokenBalances();
    
    // Start auto-refresh timer
    startAutoRefresh();
    
    // Cleanup
    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
        refreshIntervalRef.current = null;
      }
    };
  }, [evmAddress, fetchTokenBalances, startAutoRefresh]);

  // Fetch transaction history when History tab is active
  useEffect(() => {
    if (activeTab === 'history' && evmAddress && transactions.length === 0) {
      fetchTransactionHistory();
    }
  }, [activeTab, evmAddress, fetchTransactionHistory, transactions.length]);

  // Manual refresh handler that resets the auto-refresh timer
  const handleManualRefresh = useCallback(() => {
    console.log('🔄 Manual refresh triggered, resetting timer...');
    fetchTokenBalances(true);
    if (activeTab === 'history') {
      fetchTransactionHistory();
    }
    // Reset the auto-refresh timer
    startAutoRefresh();
  }, [fetchTokenBalances, fetchTransactionHistory, activeTab, startAutoRefresh]);

  // Handle copy address
  const handleCopyAddress = async () => {
    if (!evmAddress) return;
    
    try {
      await navigator.clipboard.writeText(evmAddress);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (err: any) {
      console.error('Failed to copy address:', err);
      setError('Failed to copy address');
    }
  };

  // Show loading state while CDP is initializing
  if (!isInitialized) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2.5">
            <Bullet />
            CDP Wallet
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
              <p className="mt-2 text-xs text-muted-foreground">Initializing wallet...</p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Handle sign out with error handling
  const handleSignOut = async () => {
    try {
      await signOut();
      console.log("CDP wallet signed out successfully");
    } catch (err: any) {
      console.error("Sign out failed:", err);
      setError(err.message || 'Sign out failed');
    }
  };

  // Calculate total portfolio value in USD
  const totalUsdValue = tokens.reduce((sum, token) => sum + token.usdValue, 0);

  // Format address for display (shortened)
  const shortAddress = evmAddress ? `${evmAddress.slice(0, 6)}...${evmAddress.slice(-4)}` : '';

  // Show connected state with wallet info
  if (isSignedIn && evmAddress) {
    return (
      <Card className="max-h-[calc(100vh-2rem)] overflow-hidden flex flex-col">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium uppercase flex items-center gap-2">
            <Bullet />
            Wallet
          </CardTitle>
          <Button
            onClick={handleManualRefresh}
            disabled={isRefreshing}
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 opacity-50 hover:opacity-100"
            title="Refresh balances"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          </Button>
        </CardHeader>
        <CardContent className="bg-accent p-1.5 flex-1 overflow-auto">
          <div className="space-y-4 bg-background rounded-lg p-4 border border-border/30">
            {/* Error message */}
            {error && (
              <div className="text-xs text-red-500 bg-red-500/10 p-2 rounded border border-red-500/20">
                {error}
              </div>
            )}

            {/* Total Balance - Centered */}
            <div className="flex flex-col items-center gap-3 py-2">
              <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
                Total Balance
              </span>
              {isLoadingTokens && tokens.length === 0 ? (
                <div className="h-10 w-32 bg-muted animate-pulse rounded"></div>
              ) : (
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-6 h-6 text-muted-foreground" />
                  <span className="text-3xl font-mono font-bold">
                    ${totalUsdValue.toFixed(2)}
                  </span>
                </div>
              )}
              {loadedChains.length === 0 && (
                <span className="text-xs text-muted-foreground">Loading chains...</span>
              )}
            </div>

            {/* Action Buttons - Before tabs */}
            <div className="flex gap-2">
            <Button 
              onClick={() => setShowFundModal(true)}
              className="flex-1"
              variant="default"
              size="sm"
            >
              Fund
            </Button>
            <Button 
              onClick={() => {
                // TODO: Implement send functionality
                console.log('Send button clicked - to be implemented');
              }}
              className="flex-1"
              variant="outline"
              size="sm"
            >
              <Send className="w-4 h-4 mr-2" />
              Send
            </Button>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 border-b border-border">
            <button
              onClick={() => setActiveTab('tokens')}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === 'tokens'
                  ? 'text-foreground border-b-2 border-primary'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Tokens
            </button>
            <button
              onClick={() => setActiveTab('collections')}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === 'collections'
                  ? 'text-foreground border-b-2 border-primary'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Collections
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === 'history'
                  ? 'text-foreground border-b-2 border-primary'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              History
            </button>
          </div>

          {/* Tab Content - Fixed height with smooth scrolling */}
          <div className="space-y-2 h-[250px] overflow-y-auto scrollbar-thin scrollbar-thumb-muted scrollbar-track-transparent">
            {activeTab === 'tokens' ? (
              isLoadingTokens && tokens.length === 0 ? (
                // Loading skeletons
                Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="flex items-center justify-between p-2 rounded hover:bg-muted/50">
                    <div className="flex items-center gap-3 flex-1">
                      <div className="w-8 h-8 rounded-full bg-muted animate-pulse"></div>
                      <div className="flex flex-col gap-1">
                        <div className="h-4 w-16 bg-muted animate-pulse rounded"></div>
                        <div className="h-3 w-24 bg-muted animate-pulse rounded"></div>
                      </div>
                    </div>
                    <div className="h-4 w-16 bg-muted animate-pulse rounded"></div>
                  </div>
                ))
              ) : tokens.length === 0 ? (
                <div className="text-center py-8 text-sm text-muted-foreground">
                  No tokens found
                </div>
              ) : (
                // Token list
                tokens.map((token, index) => (
                  <div
                    key={`${token.chain}-${token.contractAddress || token.symbol}-${index}`}
                    className="flex items-center justify-between p-2 rounded hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center gap-3 flex-1">
                      <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center overflow-hidden">
                        {token.icon.startsWith('http') ? (
                          <img 
                            src={token.icon} 
                            alt={token.symbol}
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              // Fallback to emoji if image fails to load
                              e.currentTarget.style.display = 'none';
                              e.currentTarget.parentElement!.innerHTML = getTokenIcon(token.symbol);
                            }}
                          />
                        ) : (
                          <span className="text-lg">{token.icon}</span>
                        )}
                      </div>
                      <div className="flex flex-col">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{token.symbol}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground uppercase font-mono">
                            {token.chain}
                          </span>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {parseFloat(token.balanceFormatted).toFixed(4)}
                        </span>
                      </div>
                    </div>
                    <span className="text-sm font-mono">
                      ${token.usdValue.toFixed(2)}
                    </span>
                  </div>
                ))
              )
            ) : activeTab === 'collections' ? (
              // Collections placeholder
              <div className="text-center py-8 text-sm text-muted-foreground">
                NFT Collections coming soon
              </div>
            ) : (
              // Transaction History
              isLoadingHistory ? (
                // Loading state
                <div className="flex items-center justify-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                </div>
              ) : transactions.length === 0 ? (
                <div className="text-center py-8 text-sm text-muted-foreground">
                  No transactions found
                </div>
              ) : (
                // Transaction list
                transactions.map((tx, index) => {
                  const isReceived = tx.direction === 'received';
                  const amount = parseFloat(tx.value || '0').toFixed(4);
                  const asset = tx.asset || 'ETH';
                  
                  return (
                    <div
                      key={`${tx.hash}-${index}`}
                      className="flex items-center justify-between p-2 rounded hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                          isReceived ? 'bg-green-500/10' : 'bg-red-500/10'
                        }`}>
                          <span className="text-lg">
                            {isReceived ? '↓' : '↑'}
                          </span>
                        </div>
                        <div className="flex flex-col min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">
                              {isReceived ? 'Received' : 'Sent'}
                            </span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground uppercase font-mono">
                              {tx.chainName}
                            </span>
                          </div>
                          <span className="text-xs text-muted-foreground truncate">
                            {isReceived 
                              ? `From: ${tx.from?.slice(0, 6)}...${tx.from?.slice(-4)}`
                              : `To: ${tx.to?.slice(0, 6)}...${tx.to?.slice(-4)}`
                            }
                          </span>
                        </div>
                      </div>
                      <div className="flex flex-col items-end">
                        <span className={`text-sm font-mono font-medium ${
                          isReceived ? 'text-green-500' : 'text-red-500'
                        }`}>
                          {isReceived ? '+' : '-'}{amount} {asset}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          Block #{parseInt(tx.blockNum, 16)}
                        </span>
                      </div>
                    </div>
                  );
                })
              )
            )}
          </div>


          {/* Simple Fund Modal */}
          {showFundModal && (
            <div 
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
              onClick={() => setShowFundModal(false)}
            >
              <div 
                className="bg-background border border-border rounded-lg p-6 max-w-md w-full mx-4 space-y-4"
                onClick={(e) => e.stopPropagation()}
              >
                <h3 className="text-lg font-semibold">Fund Your Wallet</h3>
                <p className="text-sm text-muted-foreground">
                  Transfer ETH from another wallet or exchange
                </p>
                
                <div className="space-y-3">
                  {/* Copy Address */}
                  <div>
                    <p className="text-xs text-muted-foreground mb-2">
                      Wallet Address
                    </p>
                    <div className="flex items-center gap-2">
                      <code className="text-xs bg-muted p-2 rounded font-mono flex-1">
                        {shortAddress}
                      </code>
                      <Button
                        onClick={() => {
                          handleCopyAddress();
                        }}
                        variant="ghost"
                        size="sm"
                        className="shrink-0"
                        title="Copy full address"
                      >
                        {isCopied ? (
                          <Check className="w-4 h-4 text-green-500" />
                        ) : (
                          <Copy className="w-4 h-4" />
                        )}
                      </Button>
                    </div>
                    {isCopied && (
                      <p className="text-xs text-green-500 mt-1">
                        Address copied to clipboard!
                      </p>
                    )}
                  </div>
                </div>
                
                <Button
                  onClick={() => setShowFundModal(false)}
                  variant="ghost"
                  className="w-full"
                >
                  Close
                </Button>
              </div>
            </div>
          )}
          </div>
        </CardContent>
      </Card>
    );
  }

  // If not signed in, don't show anything (sign-in is handled by modal)
  return null;
}

