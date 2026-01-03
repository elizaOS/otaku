import { useState, useEffect, forwardRef, useImperativeHandle } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/frontend/components/ui/card';
import { Button } from '@/frontend/components/ui/button';
import { Bullet } from '@/frontend/components/ui/bullet';
import { Copy, Check } from 'lucide-react';
import { SendModalContent } from './SendModal';
import { SwapModalContent } from './SwapModal';
import { TokenDetailModalContent } from './TokenDetailModal';
import { NFTDetailModalContent } from './NFTDetailModal';
import { FundModalContent } from './FundModal';
import { elizaClient } from '@/frontend/lib/elizaClient';
import { formatTokenBalance } from '@/frontend/lib/number-format';
import { getTokenIconBySymbol, SUPPORTED_CHAINS, CHAIN_UI_CONFIGS, getChainWalletIcon } from '@/frontend/constants/chains';
import { useModal } from '@/frontend/contexts/ModalContext';

interface Token {
  symbol: string;
  name: string;
  balance: string;
  balanceFormatted: string;
  usdValue: number | null;
  usdPrice: number | null;
  contractAddress: string | null;
  chain: string;
  decimals: number;
  icon?: string; // Token icon URL from CoinGecko
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
  balance?: string; // For ERC1155
  attributes?: Array<{
    trait_type: string;
    value: string | number;
  }>; // NFT traits/attributes
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

interface CDPWalletCardProps {
  userId: string;
  walletAddress?: string;
  onBalanceChange?: (balance: number) => void;
  onActionClick?: () => void; // Optional callback to close parent container (Sheet/Sidebar)
}

// Expose refresh methods via ref
export interface CDPWalletCardRef {
  refreshTokens: () => Promise<void>;
  refreshNFTs: () => Promise<void>;
  refreshAll: () => Promise<void>;
}

export const CDPWalletCard = forwardRef<CDPWalletCardRef, CDPWalletCardProps>(
  ({ userId, walletAddress, onBalanceChange, onActionClick }, ref) => {
  const { showModal } = useModal();
  
  // Format address for display (shortened)
  const shortAddress = walletAddress ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}` : '';
  const [isCopied, setIsCopied] = useState(false);
  const [copiedChain, setCopiedChain] = useState<string | null>(null);
  const [showAddressPopup, setShowAddressPopup] = useState(false);
  const [hidePopupTimeout, setHidePopupTimeout] = useState<NodeJS.Timeout | null>(null);
  const [activeTab, setActiveTab] = useState<'tokens' | 'collections' | 'history'>('tokens');
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  // Tokens state
  const [tokens, setTokens] = useState<Token[]>([]);
  const [totalUsdValue, setTotalUsdValue] = useState(0);
  const [isLoadingTokens, setIsLoadingTokens] = useState(true);
  const [tokensError, setTokensError] = useState<string | null>(null);
  
  // NFTs state
  const [nfts, setNfts] = useState<NFT[]>([]);
  const [isLoadingNfts, setIsLoadingNfts] = useState(false);
  const [nftsError, setNftsError] = useState<string | null>(null);
  
  // Transaction history state
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const getChainSortOrder = (chain: string): number => {
    const index = SUPPORTED_CHAINS.indexOf(chain as (typeof SUPPORTED_CHAINS)[number]);
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
  };

  // Helper: Sort tokens by USD value (highest first), fallback to chain order then symbol
  const sortTokensByUsdValueDesc = (tokensToSort: Token[]): Token[] => {
    return [...tokensToSort].sort((a, b) => {
      const valueA = a.usdValue ?? 0;
      const valueB = b.usdValue ?? 0;

      if (valueB !== valueA) {
        return valueB - valueA;
      }

      const chainOrderA = getChainSortOrder(a.chain);
      const chainOrderB = getChainSortOrder(b.chain);
      if (chainOrderA !== chainOrderB) {
        return chainOrderA - chainOrderB;
      }

      return a.symbol.localeCompare(b.symbol);
    });
  };

  // Helper: Sort NFTs by chain order (matches SUPPORTED_CHAINS order)
  const sortNftsByChainOrder = (nftsToSort: NFT[]): NFT[] => {
    return nftsToSort.sort((a, b) => {
      const aIndex = SUPPORTED_CHAINS.indexOf(a.chain as any);
      const bIndex = SUPPORTED_CHAINS.indexOf(b.chain as any);
      // If chain not found, put it at the end
      const aOrder = aIndex === -1 ? 999 : aIndex;
      const bOrder = bIndex === -1 ? 999 : bIndex;
      return aOrder - bOrder;
    });
  };

  // Expose refresh methods via ref
  useImperativeHandle(ref, () => ({
    refreshTokens: async () => {
      console.log(' Refreshing tokens via ref...');
      await syncTokens();
    },
    refreshNFTs: async () => {
      console.log(' Refreshing NFTs via ref...');
      await syncNfts();
    },
    refreshAll: async () => {
      console.log(' Refreshing all wallet data via ref...');
      await Promise.all([syncTokens(), syncNfts()]);
    },
  }));

  // Calculate total USD value whenever tokens change
  useEffect(() => {
    const total = tokens.reduce((sum, token) => sum + (token.usdValue || 0), 0);
    setTotalUsdValue(total);
  }, [tokens]);

  // Sync tokens (force refresh) concurrently across all chains with progressive updates
  const syncTokens = async () => {
    if (!userId) return;
    
    setIsLoadingTokens(true);
    setTokensError(null);
    
    try {
      // Fetch all chains concurrently with sync and update as each completes
      const chainPromises = SUPPORTED_CHAINS.map(async (chain) => {
        try {
          const data = await elizaClient.cdp.syncTokens(chain);
          
          // Update UI immediately when this chain returns
          if (data && data.tokens) {
            setTokens(prevTokens => {
              // Remove old tokens from this chain
              const otherChainTokens = prevTokens.filter(token => token.chain !== chain);
              // Add new tokens from this chain
              const mergedTokens = [...otherChainTokens, ...data.tokens];
              return sortTokensByUsdValueDesc(mergedTokens);
            });
          }
          
          return data;
        } catch (err) {
          console.error(`Error syncing tokens for ${chain}:`, err);
          return null;
        }
      });

      // Wait for all chain syncs to complete
      await Promise.all(chainPromises);
    } catch (error) {
      console.error('Error syncing tokens:', error);
      setTokensError('Failed to sync tokens');
      setTokens([]);
    } finally {
      setIsLoadingTokens(false);
    }
  };

  // Sync NFTs (force refresh) concurrently across all chains with progressive updates
  const syncNfts = async () => {
    if (!userId) return;
    
    setIsLoadingNfts(true);
    setNftsError(null);
    
    try {
      // Fetch all chains concurrently with sync and update as each completes
      const chainPromises = SUPPORTED_CHAINS.map(async (chain) => {
        try {
          const data = await elizaClient.cdp.syncNFTs(chain);
          
          // Update UI immediately when this chain returns
          if (data && data.nfts) {
            // Replace only this chain's NFTs, keep others intact
            setNfts(prevNfts => {
              // Remove old NFTs from this chain
              const otherChainNfts = prevNfts.filter(nft => nft.chain !== chain);
              // Add new NFTs from this chain
              const mergedNfts = [...otherChainNfts, ...data.nfts];
              // Sort by chain order to maintain consistent display
              return sortNftsByChainOrder(mergedNfts);
            });
          }
          
          return data;
        } catch (err) {
          console.error(`Error syncing NFTs for ${chain}:`, err);
          return null;
        }
      });

      // Wait for all chain syncs to complete
      await Promise.all(chainPromises);
    } catch (error) {
      console.error('Error syncing NFTs:', error);
      setNftsError('Failed to sync NFTs');
      setNfts([]);
    } finally {
      setIsLoadingNfts(false);
    }
  };

  // Fetch tokens concurrently across all chains with progressive chain-by-chain updates
  const fetchTokens = async () => {
    if (!userId) return;
    
    setIsLoadingTokens(true);
    setTokensError(null);
    
    try {
      // Fetch all chains concurrently and update UI as each chain completes
      const chainPromises = SUPPORTED_CHAINS.map(async (chain) => {
        try {
          const data = await elizaClient.cdp.getTokens(chain);
          
          // Update UI immediately when this chain returns
          if (data && data.tokens) {
            setTokens(prevTokens => {
              // Remove old tokens from this chain
              const otherChainTokens = prevTokens.filter(token => token.chain !== chain);
              // Add new tokens from this chain
              const mergedTokens = [...otherChainTokens, ...data.tokens];
              return sortTokensByUsdValueDesc(mergedTokens);
            });
          }
          
          return data;
        } catch (err) {
          console.error(`Error fetching tokens for ${chain}:`, err);
          return null;
        }
      });

      // Wait for all chains to complete (but UI already updated progressively)
      await Promise.all(chainPromises);
    } catch (error) {
      console.error('Error fetching tokens:', error);
      setTokensError('Failed to fetch tokens');
      setTokens([]);
    } finally {
      setIsLoadingTokens(false);
    }
  };

  // Fetch NFTs concurrently across all chains with progressive chain-by-chain updates
  const fetchNfts = async () => {
    if (!userId) return;
    
    setIsLoadingNfts(true);
    setNftsError(null);
    
    try {
      // Fetch all chains concurrently and update UI as each chain completes
      const chainPromises = SUPPORTED_CHAINS.map(async (chain) => {
        try {
          const data = await elizaClient.cdp.getNFTs(chain);
          
          // Update UI immediately when this chain returns
          if (data && data.nfts) {
            // Replace only this chain's NFTs, keep others intact
            setNfts(prevNfts => {
              // Remove old NFTs from this chain
              const otherChainNfts = prevNfts.filter(nft => nft.chain !== chain);
              // Add new NFTs from this chain
              const mergedNfts = [...otherChainNfts, ...data.nfts];
              // Sort by chain order to maintain consistent display
              return sortNftsByChainOrder(mergedNfts);
            });
          }
          
          return data;
        } catch (err) {
          console.error(`Error fetching NFTs for ${chain}:`, err);
          return null;
        }
      });

      // Wait for all chains to complete (but UI already updated progressively)
      await Promise.all(chainPromises);
    } catch (error) {
      console.error('Error fetching NFTs:', error);
      setNftsError('Failed to fetch NFTs');
      setNfts([]);
    } finally {
      setIsLoadingNfts(false);
    }
  };

  // Fetch transaction history
  const fetchHistory = async () => {
    if (!userId) return;
    
    setIsLoadingHistory(true);
    setHistoryError(null);
    
    try {
      const data = await elizaClient.cdp.getHistory();
      setTransactions(data.transactions || []);
    } catch (error) {
      console.error('Error fetching history:', error);
      setHistoryError('Failed to fetch transaction history');
      setTransactions([]);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  // Notify parent of balance changes
  useEffect(() => {
    if (onBalanceChange) {
      onBalanceChange(totalUsdValue);
    }
  }, [totalUsdValue, onBalanceChange]);

  // Initial load
  useEffect(() => {
    fetchTokens();
  }, [userId]);

  // Load data based on active tab
  useEffect(() => {
    if (activeTab === 'collections' && nfts.length === 0 && !isLoadingNfts && !nftsError) {
      fetchNfts();
    } else if (activeTab === 'history' && transactions.length === 0 && !isLoadingHistory && !historyError) {
      fetchHistory();
    }
  }, [activeTab]);

  // Refresh all data using sync APIs with concurrent chain-by-chain updates
  const handleManualRefresh = async () => {
    if (!userId) return;
    
    setIsRefreshing(true);
    try {
      if (activeTab === 'tokens') {
        await syncTokens();
      } else if (activeTab === 'collections') {
        await syncNfts();
      } else if (activeTab === 'history') {
        await fetchHistory();
      }
    } catch (error) {
      console.error('Error syncing data:', error);
    } finally {
      setIsRefreshing(false);
    }
  };

  // Format date
  const formatDate = (timestamp: number): string => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: '2-digit', 
      year: 'numeric' 
    });
  };

  // Handle copy address for a specific chain
  const handleCopyChainAddress = async (chain: string) => {
    if (!walletAddress) return;
    
    try {
      await navigator.clipboard.writeText(walletAddress);
      setCopiedChain(chain);
      setTimeout(() => setCopiedChain(null), 2000);
    } catch (err) {
      console.error('Failed to copy address:', err);
    }
  };

  // Handle showing address popup
  const handleShowPopup = () => {
    if (hidePopupTimeout) {
      clearTimeout(hidePopupTimeout);
      setHidePopupTimeout(null);
    }
    setShowAddressPopup(true);
  };

  // Handle hiding address popup with delay
  const handleHidePopup = () => {
    const timeout = setTimeout(() => {
      setShowAddressPopup(false);
    }, 200); // 200ms delay
    setHidePopupTimeout(timeout);
  };

  // Group transactions by date (sorted by most recent first)
  const groupedTransactions = transactions.reduce<Record<string, Transaction[]>>((groups, tx) => {
    const dateKey = formatDate(tx.timestamp);
    if (!groups[dateKey]) {
      groups[dateKey] = [];
    }
    groups[dateKey].push(tx);
    return groups;
  }, {});

  // Preserve the date order (most recent first)
  const orderedDates = Object.keys(groupedTransactions).sort((a, b) => {
    // Get the first transaction's timestamp from each group to determine order
    const aTime = groupedTransactions[a][0]?.timestamp || 0;
    const bTime = groupedTransactions[b][0]?.timestamp || 0;
    return bTime - aTime;
  });

  // Get token icon - returns JSX element
  const getTokenIcon = (token: Token) => {
    // If token has icon from API, use it
    if (token.icon) {
      return (
        <img 
          src={token.icon} 
          alt={token.symbol} 
          className="w-full h-full object-contain p-0.5"
          onError={(e) => {
            // Fallback to circle with first letter if image fails to load
            const parent = e.currentTarget.parentElement;
            if (parent) {
              parent.innerHTML = `<span class="text-xs sm:text-sm font-bold text-muted-foreground uppercase">${token.symbol.charAt(0)}</span>`;
            }
          }}
        />
      );
    }

    // Try to get icon from constants
    const iconPath = getTokenIconBySymbol(token.symbol);
    if (iconPath) {
      return (
        <img 
          src={iconPath} 
          alt={token.symbol} 
          className="w-full h-full object-contain p-0.5"
        />
      );
    }

    // Fallback: gray circle with first letter
    return (
      <span className="text-xs sm:text-sm font-bold text-muted-foreground uppercase">
        {token.symbol.charAt(0)}
      </span>
    );
  };

  // Get transaction icon - returns JSX element
  const getTransactionIcon = (tx: Transaction) => {
    // If transaction has icon from API, use it
    if (tx.icon) {
      return (
        <img 
          src={tx.icon} 
          alt={tx.asset} 
          className="w-full h-full object-contain p-0.5"
          onError={(e) => {
            // Fallback to circle with first letter if image fails to load
            const parent = e.currentTarget.parentElement;
            if (parent) {
              parent.innerHTML = `<span class="text-xs sm:text-sm font-bold text-muted-foreground uppercase">${tx.asset.charAt(0)}</span>`;
            }
          }}
        />
      );
    }

    // Try to get icon from constants based on asset symbol
    const iconPath = getTokenIconBySymbol(tx.asset);
    if (iconPath) {
      return (
        <img 
          src={iconPath} 
          alt={tx.asset} 
          className="w-full h-full object-contain p-0.5"
        />
      );
    }

    // Fallback: gray circle with first letter
    return (
      <span className="text-xs sm:text-sm font-bold text-muted-foreground uppercase">
        {tx.asset.charAt(0)}
      </span>
    );
  };

  return (
    <>
      {/* Preload chain icons to prevent flash on hover */}
      <div className="hidden">
        {SUPPORTED_CHAINS.map((chain) => {
          const chainWalletIcon = getChainWalletIcon(chain);
          return chainWalletIcon ? (
            <img key={chain} src={chainWalletIcon} alt="" />
          ) : null;
        })}
      </div>

      <Card className="max-h-[calc(100vh-2rem)] w-full flex flex-col">
        <CardHeader className="flex items-center justify-between pl-3 pr-1 relative z-10">
          <CardTitle className="flex items-center gap-2.5 text-sm font-medium uppercase">
            <Bullet />
            <div className="flex items-center gap-1">
              Wallet
              {/* Copy Address Popup */}
              <div 
                className="relative inline-flex z-50"
                onMouseEnter={handleShowPopup}
                onMouseLeave={handleHidePopup}
              >
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 text-muted-foreground hover:bg-muted"
                >
                  <Copy className="w-3 h-3" />
                </Button>
              
              {/* Popup with all chain addresses */}
              {showAddressPopup && walletAddress && (
                <div 
                  className="absolute -left-16 top-full mt-1 bg-popover border border-border rounded-lg shadow-lg p-2 z-50 w-[230px] max-w-[230px] md:w-[calc(25vw-2rem)]"
                  onMouseEnter={handleShowPopup}
                  onMouseLeave={handleHidePopup}
                >
                  <div className="space-y-0.5 max-h-[300px] overflow-y-auto scrollbar-thin scrollbar-thumb-muted scrollbar-track-transparent">
                    {SUPPORTED_CHAINS.map((chain) => {
                      const config = CHAIN_UI_CONFIGS[chain];
                      const chainWalletIcon = getChainWalletIcon(chain);
                      return (
                        <div
                          key={chain}
                          className="flex items-center justify-between gap-0.5 p-1 rounded hover:bg-muted/50 transition-colors group"
                        >
                          {/* First Group: Icon & Name */}
                          <div className="flex items-center gap-1.5 shrink-0">
                            <div className="w-5 h-5 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center overflow-hidden bg-white">
                              {chainWalletIcon ? (
                                <img 
                                  src={chainWalletIcon} 
                                  alt={config.name}
                                  className="w-full h-full object-contain"
                                />
                              ) : (
                                <span className="text-[10px] font-bold text-muted-foreground uppercase">
                                  {chain.charAt(0)}
                                </span>
                              )}
                            </div>
                            <span className="text-[10px] sm:text-[11px]">{config.displayName}</span>
                          </div>
                          
                          {/* Second Group: Address & Copy Button */}
                          <div className="flex items-center gap-1 min-w-0" onClick={() => handleCopyChainAddress(chain)}>
                            <span className="text-[9px] text-muted-foreground font-mono cursor-pointer">
                              {`${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`}
                            </span>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-5 w-5 p-0 shrink-0 text-muted-foreground hover:text-foreground"
                            >
                              {copiedChain === chain ? (
                                <Check className="w-2.5 h-2.5 text-green-500" />
                              ) : (
                                <Copy className="w-2.5 h-2.5" />
                              )}
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </CardTitle>
        <Button
          onClick={handleManualRefresh}
          disabled={isRefreshing || !userId || isLoadingTokens}
          variant="ghost"
          size="sm"
          className="text-xs uppercase tracking-wider text-muted-foreground hover:text-foreground"
        >
          {isLoadingHistory || isLoadingNfts || isLoadingTokens ? 'Loading...' : isRefreshing ? 'Refreshing...' : 'Refresh'}
        </Button>
      </CardHeader>
      <CardContent className="bg-accent p-2 flex-1 flex-col overflow-auto relative w-full">
        <div className="space-y-4 bg-background rounded-lg p-3 sm:p-4 border border-border/30 w-full overflow-hidden">
          {/* Error message */}
          {tokensError && (
            <div className="text-xs text-red-500 bg-red-500/10 p-2 rounded border border-red-500/20">
              {tokensError}
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
                <span className="text-3xl font-mono font-bold">
                  ${totalUsdValue.toFixed(2)}
                </span>
              </div>
            )}
          </div>
          {/* Action Buttons - Before tabs */}
          <div className="grid grid-cols-3 gap-2">
            <Button 
              onClick={() => {
                // Close parent container (Sheet/Sidebar) if callback provided
                onActionClick?.();
                
                showModal(
                  <FundModalContent 
                    walletAddress={walletAddress}
                    shortAddress={shortAddress}
                  />,
                  'fund-modal',
                  { closeOnBackdropClick: true, className: 'max-w-md' }
                );
              }}
              className="flex-1"
              variant="default"
              size="sm"
            >
              Fund
            </Button>
            <Button 
              onClick={() => {
                // Close parent container (Sheet/Sidebar) if callback provided
                onActionClick?.();
                
                showModal(
                  <SendModalContent
                    tokens={tokens as any}
                    userId={userId}
                    onSuccess={() => {
                      fetchTokens();
                    }}
                  />,
                  'send-modal',
                  { closeOnBackdropClick: true, className: 'max-w-xl' }
                );
              }}
              className="flex-1"
              variant="outline"
              size="sm"
              disabled={tokens.length === 0 || isLoadingTokens}
            >
              Send
            </Button>
            <Button 
              onClick={() => {
                // Close parent container (Sheet/Sidebar) if callback provided
                onActionClick?.();
                
                showModal(
                  <SwapModalContent
                    tokens={tokens}
                    userId={userId}
                    onSuccess={() => {
                      fetchTokens();
                    }}
                  />,
                  'swap-modal',
                  { closeOnBackdropClick: true, className: 'max-w-lg' }
                );
              }}
              className="flex-1"
              variant="outline"
              size="sm"
              disabled={tokens.length === 0 || isLoadingTokens}
            >
              Swap
            </Button>
          </div>
        </div>

        <div className="mt-2 space-y-4 bg-background rounded-lg p-3 sm:p-4 border border-border/30 w-full overflow-hidden">
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
                  <button
                    key={`${token.chain}-${token.contractAddress || token.symbol}-${index}`}
                    onClick={() => {
                      onActionClick?.();
                      showModal(
                        <TokenDetailModalContent token={token as any} />,
                        'token-detail-modal',
                        { closeOnBackdropClick: true, className: 'max-w-2xl' }
                      );
                    }}
                    className="w-full flex items-center justify-between p-2 rounded hover:bg-muted/50 transition-colors min-w-0 cursor-pointer text-left"
                  >
                    <div className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0">
                      <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-muted flex items-center justify-center overflow-hidden shrink-0">
                        {getTokenIcon(token)}
                      </div>
                      <div className="flex flex-col min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                          <span className="text-xs sm:text-sm font-medium truncate">{token.symbol}</span>
                          <span className="text-[9px] sm:text-[10px] px-1 sm:px-1.5 py-0.5 rounded bg-muted text-muted-foreground uppercase font-mono whitespace-nowrap">
                            {token.chain}
                          </span>
                        </div>
                        <span className="text-xs text-muted-foreground truncate">
                          {formatTokenBalance(token.balanceFormatted)}
                        </span>
                      </div>
                    </div>
                    <span className="text-xs sm:text-sm font-mono shrink-0 ml-2">
                      ${token.usdValue?.toFixed(2) ?? '0.00'}
                    </span>
                  </button>
                ))
              )
            ) : activeTab === 'collections' ? (
              // NFT List
              isLoadingNfts ? (
                // Loading state
                <div className="flex items-center justify-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                </div>
              ) : nfts.length === 0 ? (
                <div className="text-center py-8 text-sm text-muted-foreground">
                  No NFTs found
                </div>
              ) : (
                // NFT list
                nfts.map((nft, index) => (
                  <button
                    key={`${nft.chain}-${nft.contractAddress}-${nft.tokenId}-${index}`}
                    onClick={() => {
                      onActionClick?.();
                      showModal(
                        <NFTDetailModalContent
                          nft={nft}
                          userId={userId}
                          onSuccess={() => {
                            fetchNfts();
                          }}
                        />,
                        'nft-detail-modal',
                        { 
                          closeOnBackdropClick: true, 
                          className: 'max-w-2xl mx-4 shadow-xl',
                          showCloseButton: false  // NFT modal has its own close button in header
                        }
                      );
                    }}
                    className="w-full flex items-center gap-2 sm:gap-3 p-2 rounded hover:bg-muted/50 transition-colors min-w-0 cursor-pointer text-left"
                  >
                    <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-lg bg-muted flex items-center justify-center overflow-hidden shrink-0 border border-border/30">
                      {nft.image ? (
                        <img 
                          src={nft.image} 
                          alt={nft.name}
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            // Fallback to emoji if image fails to load
                            const parent = e.currentTarget.parentElement;
                            if (parent) {
                              parent.innerHTML = `<span class="text-2xl"></span>`;
                            }
                          }}
                        />
                      ) : (
                        <span className="text-2xl"></span>
                      )}
                    </div>
                    <div className="flex flex-col min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
                        <span className="text-xs sm:text-sm font-medium truncate flex-1 min-w-0">{nft.name}</span>
                        <span className="text-[9px] sm:text-[10px] px-1 sm:px-1.5 py-0.5 rounded bg-muted text-muted-foreground uppercase font-mono whitespace-nowrap shrink-0">
                          {nft.chain}
                        </span>
                      </div>
                      <span className="text-xs text-muted-foreground truncate">
                        {nft.contractName}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-muted-foreground/70 font-mono">
                          #{nft.tokenId}
                        </span>
                        {nft.balance && nft.tokenType === 'ERC1155' && (
                          <>
                            <span className="text-[10px] text-muted-foreground/70">•</span>
                            <span className="text-[10px] text-muted-foreground/70">
                              x{nft.balance}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </button>
                ))
              )
            ) : (
              // Transaction History
              isLoadingHistory ? (
                <div className="flex items-center justify-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                </div>
              ) : transactions.length === 0 ? (
                <div className="text-center py-8 text-sm text-muted-foreground">
                  No transaction history
                </div>
              ) : (
                <div className="space-y-3">
                  {orderedDates.map((date) => {
                    const txs = groupedTransactions[date];
                    return (
                      <div key={date}>
                        <div className="sticky top-0 bg-background/95  text-[10px] font-mono text-muted-foreground mb-1.5 uppercase tracking-wider border-b border-border/50 pb-1">
                          {date}
                        </div>
                        <div className="space-y-1">
                          {txs.map((tx, index) => {
                            const isReceived = tx.direction === 'received';
                            const amount = parseFloat(tx.value || '0');
                            
                            // Format amount with truncation
                            let amountStr = amount.toFixed(4);
                            if (amountStr.length > 10) {
                              amountStr = amount.toFixed(2);
                            }

                            return (
                              <a
                                key={`${tx.hash}-${index}`}
                                href={tx.explorerUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="w-full flex items-center justify-between p-2 rounded hover:bg-muted/50 transition-colors text-left cursor-pointer"
                              >
                                <div className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0">
                                  <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-muted flex items-center justify-center overflow-hidden shrink-0">
                                    {getTransactionIcon(tx)}
                                  </div>
                                  <div className="flex flex-col min-w-0 flex-1">
                                    <div className="flex items-center gap-1.5 sm:gap-2">
                                      <span className="text-xs sm:text-sm font-medium truncate">
                                        {isReceived ? 'Received' : 'Sent'}
                                      </span>
                                      <span className="text-[9px] sm:text-[10px] px-1 sm:px-1.5 py-0.5 rounded bg-muted text-muted-foreground uppercase font-mono whitespace-nowrap shrink-0">
                                        {tx.chain}
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
                                <div className="flex flex-col items-end shrink-0 ml-2" style={{ maxWidth: '35%', minWidth: 0 }}>
                                  <span className={`text-xs sm:text-sm font-mono font-medium overflow-hidden text-ellipsis whitespace-nowrap w-full text-right ${
                                    isReceived ? 'text-green-500' : 'text-red-500'
                                  }`} title={`${isReceived ? '+' : '-'}${amount.toFixed(8)} ${tx.asset}`}>
                                    {isReceived ? '+' : '-'}{amountStr}
                                  </span>
                                  <span className="text-[10px] sm:text-xs text-muted-foreground overflow-hidden text-ellipsis whitespace-nowrap w-full text-right" title={tx.asset}>
                                    {tx.asset}
                                  </span>
                                </div>
                              </a>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )
            )}
          </div>
        </div>
      </CardContent>
    </Card>
    </>
  );
});

// Add display name for debugging
CDPWalletCard.displayName = 'CDPWalletCard';
