import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Card, CardHeader, CardTitle, CardContent } from '../../ui/card';
import { Button } from '../../ui/button';
import { Bullet } from '../../ui/bullet';
import { Copy, Check, RefreshCw, Send } from 'lucide-react';
import { SendModal } from './SendModal';
import { TokenDetailModal } from './TokenDetailModal';
import { NFTDetailModal } from './NFTDetailModal';
import { elizaClient } from '../../../lib/elizaClient';

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
}

interface CDPWalletCardProps {
  userId: string;
  walletAddress?: string;
  onBalanceChange?: (balance: number) => void;
}

export function CDPWalletCard({ userId, walletAddress, onBalanceChange }: CDPWalletCardProps) {
  // Format address for display (shortened)
  const shortAddress = walletAddress ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}` : '';
  const [isCopied, setIsCopied] = useState(false);
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
  
  // Modal states
  const [isSendModalOpen, setIsSendModalOpen] = useState(false);
  const [isFundModalOpen, setIsFundModalOpen] = useState(false);
  const [selectedToken, setSelectedToken] = useState<Token | null>(null);
  const [selectedNft, setSelectedNft] = useState<NFT | null>(null);

  // Fetch tokens
  const fetchTokens = async () => {
    if (!userId) return;
    
    setIsLoadingTokens(true);
    setTokensError(null);
    
    try {
      const data = await elizaClient.cdp.getTokens(userId);
      setTokens(data.tokens || []);
      setTotalUsdValue(data.totalUsdValue || 0);
    } catch (error) {
      console.error('Error fetching tokens:', error);
      setTokensError('Failed to fetch tokens');
      setTokens([]);
      setTotalUsdValue(0);
    } finally {
      setIsLoadingTokens(false);
    }
  };

  // Fetch NFTs
  const fetchNfts = async () => {
    if (!userId) return;
    
    setIsLoadingNfts(true);
    setNftsError(null);
    
    try {
      const data = await elizaClient.cdp.getNFTs(userId);
      setNfts(data.nfts || []);
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
      const data = await elizaClient.cdp.getHistory(userId);
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

  // Refresh all data
  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([
        fetchTokens(),
        activeTab === 'collections' ? fetchNfts() : Promise.resolve(),
        activeTab === 'history' ? fetchHistory() : Promise.resolve(),
      ]);
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

  // Handle copy address
  const handleCopyAddress = async () => {
    if (!walletAddress) return;
    
    try {
      await navigator.clipboard.writeText(walletAddress);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy address:', err);
    }
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

    // Native tokens - use local SVGs
    const nativeTokens: Record<string, string> = {
      'ETH': 'assets/eth.svg',
      'MATIC': 'assets/polygon.svg',
      'POL': 'assets/polygon.svg',
    };

    if (nativeTokens[token.symbol]) {
      return (
        <img 
          src={nativeTokens[token.symbol]} 
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
          <div className="flex gap-2">
            <Button 
              onClick={() => setIsFundModalOpen(true)}
              className="flex-1"
              variant="default"
              size="sm"
            >
              Fund
            </Button>
            <Button 
              onClick={() => setIsSendModalOpen(true)}
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
                  <button
                    key={`${token.chain}-${token.contractAddress || token.symbol}-${index}`}
                    onClick={() => setSelectedToken(token)}
                    className="w-full flex items-center justify-between p-2 rounded hover:bg-muted/50 transition-colors min-w-0 cursor-pointer text-left"
                  >
                    <div className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0">
                      <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-muted flex items-center justify-center overflow-hidden flex-shrink-0">
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
                          {parseFloat(token.balanceFormatted) < 0.0001 
                            ? parseFloat(token.balanceFormatted).toExponential(2)
                            : parseFloat(token.balanceFormatted).toFixed(6).replace(/\.?0+$/, '')
                          }
                        </span>
                      </div>
                    </div>
                    <span className="text-xs sm:text-sm font-mono flex-shrink-0 ml-2">
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
                    onClick={() => setSelectedNft(nft)}
                    className="w-full flex items-center gap-2 sm:gap-3 p-2 rounded hover:bg-muted/50 transition-colors min-w-0 cursor-pointer text-left"
                  >
                    <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-lg bg-muted flex items-center justify-center overflow-hidden flex-shrink-0 border border-border/30">
                      {nft.image ? (
                        <img 
                          src={nft.image} 
                          alt={nft.name}
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            // Fallback to emoji if image fails to load
                            const parent = e.currentTarget.parentElement;
                            if (parent) {
                              parent.innerHTML = `<span class="text-2xl">🖼️</span>`;
                            }
                          }}
                        />
                      ) : (
                        <span className="text-2xl">🖼️</span>
                      )}
                    </div>
                    <div className="flex flex-col min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
                        <span className="text-xs sm:text-sm font-medium truncate flex-1 min-w-0">{nft.name}</span>
                        <span className="text-[9px] sm:text-[10px] px-1 sm:px-1.5 py-0.5 rounded bg-muted text-muted-foreground uppercase font-mono whitespace-nowrap flex-shrink-0">
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
                        <div className="sticky top-0 bg-background/95 backdrop-blur-sm text-[10px] font-mono text-muted-foreground mb-1.5 uppercase tracking-wider border-b border-border/50 pb-1">
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
                                <div className="flex flex-col items-end flex-shrink-0 ml-2" style={{ maxWidth: '35%', minWidth: 0 }}>
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

      {/* Modals */}
      <SendModal
        isOpen={isSendModalOpen}
        onClose={() => setIsSendModalOpen(false)}
        tokens={tokens as any}
        userId={userId}
        onSuccess={() => {
          setIsSendModalOpen(false);
          fetchTokens();
        }}
      />

      {selectedToken && (
        <TokenDetailModal
          isOpen={!!selectedToken}
          onClose={() => setSelectedToken(null)}
          token={selectedToken as any}
        />
      )}

      {selectedNft && (
        <NFTDetailModal
          isOpen={!!selectedNft}
          onClose={() => setSelectedNft(null)}
          nft={selectedNft}
          userId={userId}
          onSuccess={() => {
            setSelectedNft(null);
            fetchNfts();
          }}
        />
      )}

      {/* Fund Modal */}
      {isFundModalOpen && createPortal(
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
          onClick={() => setIsFundModalOpen(false)}
        >
          <div 
            className="bg-background rounded-lg max-w-md w-full max-h-[90vh] overflow-hidden p-1.5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-pop rounded-lg p-4 sm:p-6 space-y-4 max-h-[calc(90vh-0.75rem)] overflow-y-auto">
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
                onClick={() => setIsFundModalOpen(false)}
                variant="ghost"
                className="w-full"
              >
                Close
              </Button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </Card>
  );
}
