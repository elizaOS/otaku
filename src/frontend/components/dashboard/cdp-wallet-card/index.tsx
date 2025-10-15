import { useState, useEffect, useCallback, useRef } from 'react';
import { useCDPWallet } from '@/hooks/useCDPWallet';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Bullet } from '@/components/ui/bullet';
import { Copy, Check, TrendingUp, RefreshCw, Send } from 'lucide-react';
import { formatUnits, createPublicClient, http } from 'viem';
import { base, mainnet, polygon } from 'viem/chains';
import { SendModal } from './SendModal';

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
  decimals?: number;
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
  const [showSendModal, setShowSendModal] = useState(false);
  const [activeTab, setActiveTab] = useState<'tokens' | 'collections' | 'history'>('tokens');
  const [loadedChains, setLoadedChains] = useState<ChainNetwork[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  
  // Ref to store the auto-refresh interval
  const refreshIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Helper function to get token icon based on symbol
    // Get token icon - returns SVG path for native tokens, null for others (will use circle fallback)
  const getTokenIconPath = (symbol: string): string | null => {
    if (symbol === 'ETH' || symbol === 'WETH') return '/assets/eth.svg';
    if (symbol === 'MATIC' || symbol === 'POL') return '/assets/polygon.svg';
    return null; // Use circle with first letter fallback
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
        
        // Get native token price from CoinGecko Pro API
        let price = 0;
        try {
          const apiKey = import.meta.env.COINGECKO_API_KEY;
          const priceResponse = await fetch(
            `https://pro-api.coingecko.com/api/v3/simple/price?ids=${chainConfig.nativeToken.coingeckoId}&vs_currencies=usd`,
            {
              headers: apiKey ? {
                'x-cg-pro-api-key': apiKey,
              } : {},
            }
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
          icon: getTokenIconPath(chainConfig.nativeToken.symbol) || chainConfig.nativeToken.symbol,
          chain,
          decimals: 18, // Native tokens are always 18 decimals
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
              icon: info.icon || getTokenIconPath(info.symbol) || info.symbol,
              contractAddress,
              chain,
              decimals: info.decimals,
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
      
      // Sort by timestamp (most recent first)
      allTransactions.sort((a, b) => {
        const timeA = a.metadata?.blockTimestamp ? new Date(a.metadata.blockTimestamp).getTime() : 0;
        const timeB = b.metadata?.blockTimestamp ? new Date(b.metadata.blockTimestamp).getTime() : 0;
        return timeB - timeA; // Most recent first
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
        <CardContent className="pt-6">
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
      <Card className="max-h-[calc(100vh-2rem)] w-full overflow-hidden flex flex-col">
        <CardHeader className="flex items-center justify-between pl-3 pr-1">
          <CardTitle className="flex items-center gap-2.5 text-sm font-medium uppercase">
            <Bullet />
            Wallet
          </CardTitle>
          <Button
            onClick={handleManualRefresh}
            disabled={isRefreshing}
            variant="ghost"
            size="sm"
            className="text-xs uppercase tracking-wider text-muted-foreground hover:text-foreground"
          >
            {isRefreshing ? 'Refreshing...' : 'Refresh'}
          </Button>
        </CardHeader>
        <CardContent className="bg-accent p-1.5 flex-1 overflow-auto relative w-full">
          <div className="space-y-4 bg-background rounded-lg p-3 sm:p-4 border border-border/30 w-full overflow-hidden">
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
              onClick={() => setShowSendModal(true)}
              className="flex-1"
              variant="outline"
              size="sm"
              disabled={tokens.length === 0 || isLoadingTokens}
            >
              <Send className="w-4 h-4 mr-2" />
              Send
            </Button>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 border-b border-border overflow-x-auto scrollbar-hide">
            <button
              onClick={() => setActiveTab('tokens')}
              className={`px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium transition-colors whitespace-nowrap ${
                activeTab === 'tokens'
                  ? 'text-foreground border-b-2 border-primary'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Tokens
            </button>
            <button
              onClick={() => setActiveTab('collections')}
              className={`px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium transition-colors whitespace-nowrap ${
                activeTab === 'collections'
                  ? 'text-foreground border-b-2 border-primary'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Collections
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={`px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium transition-colors whitespace-nowrap ${
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
                    className="flex items-center justify-between p-2 rounded hover:bg-muted/50 transition-colors min-w-0"
                  >
                    <div className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0">
                      <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-muted flex items-center justify-center overflow-hidden flex-shrink-0">
                        {token.icon.startsWith('http') || token.icon.startsWith('/assets/') ? (
                          <img 
                            src={token.icon} 
                            alt={token.symbol}
                            className="w-full h-full object-contain p-0.5"
                            onError={(e) => {
                              // Fallback to circle with first letter if SVG/image fails to load
                              const parent = e.currentTarget.parentElement;
                              if (parent) {
                                parent.innerHTML = `<span class="text-xs sm:text-sm font-bold text-muted-foreground uppercase">${token.symbol.charAt(0)}</span>`;
                              }
                            }}
                          />
                        ) : (
                          <span className="text-xs sm:text-sm font-bold text-muted-foreground uppercase">{token.icon.charAt(0)}</span>
                        )}
                      </div>
                      <div className="flex flex-col min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                          <span className="text-xs sm:text-sm font-medium truncate">{token.symbol}</span>
                          <span className="text-[9px] sm:text-[10px] px-1 sm:px-1.5 py-0.5 rounded bg-muted text-muted-foreground uppercase font-mono whitespace-nowrap">
                            {token.chain}
                          </span>
                        </div>
                        <span className="text-xs text-muted-foreground truncate">
                          {parseFloat(token.balanceFormatted) < 0.0001 
                            ? parseFloat(token.balanceFormatted).toExponential(2)
                            : parseFloat(token.balanceFormatted).toFixed(6).replace(/\.?0+$/, '')
                          }
                        </span>
                      </div>
                    </div>
                    <span className="text-xs sm:text-sm font-mono flex-shrink-0 ml-2">
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
                // Transaction list with date grouping
                (() => {
                  // Helper function to get date label
                  const getDateLabel = (timestamp: string) => {
                    const date = new Date(timestamp);
                    const today = new Date();
                    const yesterday = new Date(today);
                    yesterday.setDate(yesterday.getDate() - 1);
                    
                    // Reset time for comparison
                    const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());
                    const todayOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());
                    const yesterdayOnly = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate());
                    
                    if (dateOnly.getTime() === todayOnly.getTime()) {
                      return 'Today';
                    } else if (dateOnly.getTime() === yesterdayOnly.getTime()) {
                      return 'Yesterday';
                    } else {
                      return date.toLocaleDateString('en-US', {
                        month: 'short',
                        day: '2-digit',
                        year: 'numeric'
                      });
                    }
                  };

                  // Group transactions by date
                  const groupedTxs: { [key: string]: any[] } = {};
                  transactions.forEach((tx) => {
                    if (tx.metadata?.blockTimestamp) {
                      const label = getDateLabel(tx.metadata.blockTimestamp);
                      if (!groupedTxs[label]) {
                        groupedTxs[label] = [];
                      }
                      groupedTxs[label].push(tx);
                    }
                  });

                  return Object.entries(groupedTxs).map(([dateLabel, txs]) => (
                    <div key={dateLabel}>
                      {/* Date header */}
                      <div className="sticky top-0 bg-background/95 backdrop-blur-sm px-2 py-1 text-[10px] sm:text-xs font-medium text-muted-foreground uppercase tracking-wider border-b border-border/50 mb-1">
                        {dateLabel}
                      </div>
                      
                      {/* Transactions for this date */}
                      {txs.map((tx, index) => {
                        const isReceived = tx.direction === 'received';
                        const amount = parseFloat(tx.value || '0');
                        const asset = tx.asset || 'ETH';
                        
                        // Format amount with truncation
                        let amountStr = amount.toFixed(4);
                        if (amountStr.length > 10) {
                          amountStr = amount.toFixed(2);
                        }
                        
                        // Get explorer URL for the transaction
                        const getExplorerUrl = (hash: string, chain: string) => {
                          const explorers: Record<string, string> = {
                            Base: 'https://basescan.org',
                            Ethereum: 'https://etherscan.io',
                            Polygon: 'https://polygonscan.com',
                          };
                          return `${explorers[chain] || explorers.Base}/tx/${hash}`;
                        };

                        return (
                          <a
                            key={`${tx.hash}-${index}`}
                            href={getExplorerUrl(tx.hash, tx.chainName)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center justify-between p-2 rounded hover:bg-muted/50 transition-colors min-w-0 cursor-pointer"
                          >
                            <div className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0">
                              <div className={`w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                                isReceived ? 'bg-green-500/10' : 'bg-red-500/10'
                              }`}>
                                <span className="text-base sm:text-lg">
                                  {isReceived ? '↓' : '↑'}
                                </span>
                              </div>
                              <div className="flex flex-col min-w-0 flex-1">
                                <div className="flex items-center gap-1.5 sm:gap-2">
                                  <span className="text-xs sm:text-sm font-medium truncate">
                                    {isReceived ? 'Received' : 'Sent'}
                                  </span>
                                  <span className="text-[9px] sm:text-[10px] px-1 sm:px-1.5 py-0.5 rounded bg-muted text-muted-foreground uppercase font-mono whitespace-nowrap flex-shrink-0">
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
                            <div className="flex flex-col items-end flex-shrink-0 ml-2" style={{ maxWidth: '35%', minWidth: 0 }}>
                              <span className={`text-xs sm:text-sm font-mono font-medium overflow-hidden text-ellipsis whitespace-nowrap w-full text-right ${
                                isReceived ? 'text-green-500' : 'text-red-500'
                              }`} title={`${isReceived ? '+' : '-'}${amount.toFixed(8)} ${asset}`}>
                                {isReceived ? '+' : '-'}{amountStr}
                              </span>
                              <span className="text-[10px] sm:text-xs text-muted-foreground overflow-hidden text-ellipsis whitespace-nowrap w-full text-right" title={asset}>
                                {asset}
                              </span>
                            </div>
                          </a>
                        );
                      })}
                    </div>
                  ));
                })()
              )
            )}
          </div>


          {/* Simple Fund Modal */}
          {showFundModal && (
            <div 
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
              onClick={() => setShowFundModal(false)}
            >
              <div 
                className="bg-background border border-border rounded-lg p-4 sm:p-6 max-w-md w-full space-y-4 max-h-[90vh] overflow-y-auto"
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

          {/* Send Modal */}
          {showSendModal && (
            <SendModal
              tokens={tokens}
              onClose={() => setShowSendModal(false)}
              onSuccess={() => {
                setShowSendModal(false);
                // Refresh balances after successful send
                fetchTokenBalances(true);
              }}
            />
          )}
          </div>
        </CardContent>
      </Card>
    );
  }

  // If not signed in, don't show anything (sign-in is handled by modal)
  return null;
}

