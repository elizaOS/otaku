import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '../../ui/button';
import { X, ArrowDownUp, Loader2 } from 'lucide-react';
import { useLoadingPanel } from '../../../contexts/LoadingPanelContext';
import { elizaClient } from '../../../lib/elizaClient';
import { getTokenIconBySymbol, getTxExplorerUrl } from '../../../constants/chains';

interface Token {
  symbol: string;
  name: string;
  balance: string;
  balanceFormatted: string;
  usdValue?: number | null;
  usdPrice?: number | null;
  contractAddress?: string | null;
  chain: string;
  decimals: number;
  icon?: string;
  isExternal?: boolean; // Flag for CoinGecko tokens not in wallet
}

interface SwapModalProps {
  isOpen: boolean;
  onClose: () => void;
  tokens: Token[];
  userId: string;
  onSuccess: () => void;
}

export function SwapModal({ isOpen, onClose, tokens, userId, onSuccess }: SwapModalProps) {
  const { showLoading, showSuccess, showError } = useLoadingPanel();
  const modalId = 'swap-modal';
  
  const [fromToken, setFromToken] = useState<Token | null>(null);
  const [toToken, setToToken] = useState<Token | null>(null);
  const [fromAmount, setFromAmount] = useState('');
  const [toAmount, setToAmount] = useState('');
  const [slippage, setSlippage] = useState('1'); // 1% default
  const [isLoadingPrice, setIsLoadingPrice] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const [isFromDropdownOpen, setIsFromDropdownOpen] = useState(false);
  const [isToDropdownOpen, setIsToDropdownOpen] = useState(false);
  const [fromSearchQuery, setFromSearchQuery] = useState('');
  const [toSearchQuery, setToSearchQuery] = useState('');
  const [toCoinGeckoResults, setToCoinGeckoResults] = useState<Token[]>([]);
  const [isSearchingTo, setIsSearchingTo] = useState(false);
  const fromDropdownRef = useRef<HTMLDivElement>(null);
  const toDropdownRef = useRef<HTMLDivElement>(null);
  const fromSearchInputRef = useRef<HTMLInputElement>(null);
  const toSearchInputRef = useRef<HTMLInputElement>(null);

  // Filter tokens for swap (CDP networks + 1inch supported networks)
  const SWAP_SUPPORTED_NETWORKS = ['base', 'ethereum', 'polygon', 'arbitrum', 'optimism'];
  const swapSupportedTokens = tokens.filter(t => 
    SWAP_SUPPORTED_NETWORKS.includes(t.chain)
  );

  // Filter tokens based on search query
  const filterTokens = (tokenList: Token[], query: string): Token[] => {
    if (!query.trim()) return tokenList;
    
    const lowerQuery = query.toLowerCase().trim();
    
    return tokenList.filter(token => {
      // Search by symbol
      if (token.symbol.toLowerCase().includes(lowerQuery)) return true;
      // Search by name
      if (token.name.toLowerCase().includes(lowerQuery)) return true;
      // Search by contract address
      if (token.contractAddress && token.contractAddress.toLowerCase().includes(lowerQuery)) return true;
      return false;
    });
  };

  // Merge wallet tokens with CoinGecko results (deduplicate by contract address)
  const mergeTokens = (walletTokens: Token[], coingeckoTokens: Token[]): Token[] => {
    const merged = [...walletTokens];
    const existingAddresses = new Set(
      walletTokens
        .filter(t => t.contractAddress)
        .map(t => t.contractAddress!.toLowerCase())
    );

    // Add CoinGecko tokens that aren't already in wallet
    for (const token of coingeckoTokens) {
      if (token.contractAddress && !existingAddresses.has(token.contractAddress.toLowerCase())) {
        merged.push(token);
      }
    }

    return merged;
  };

  // Helper function to convert amount to base units without scientific notation
  const convertToBaseUnits = (amount: string, decimals: number): string => {
    // Remove any existing decimals and convert to integer string
    const [intPart, decPart = ''] = amount.split('.');
    const paddedDecPart = decPart.padEnd(decimals, '0').slice(0, decimals);
    const result = intPart + paddedDecPart;
    // Remove leading zeros but keep at least one digit
    return result.replace(/^0+/, '') || '0';
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (fromDropdownRef.current && !fromDropdownRef.current.contains(event.target as Node)) {
        setIsFromDropdownOpen(false);
        setFromSearchQuery('');
      }
      if (toDropdownRef.current && !toDropdownRef.current.contains(event.target as Node)) {
        setIsToDropdownOpen(false);
        setToSearchQuery('');
      }
    };

    if (isFromDropdownOpen || isToDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isFromDropdownOpen, isToDropdownOpen]);

  // Reset state when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      setFromToken(null);
      setToToken(null);
      setFromAmount('');
      setToAmount('');
      setSlippage('1');
      setWarning(null);
      setIsFromDropdownOpen(false);
      setIsToDropdownOpen(false);
      setFromSearchQuery('');
      setToSearchQuery('');
    }
  }, [isOpen]);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (isFromDropdownOpen && fromSearchInputRef.current) {
      fromSearchInputRef.current.focus();
    }
  }, [isFromDropdownOpen]);

  useEffect(() => {
    if (isToDropdownOpen && toSearchInputRef.current) {
      toSearchInputRef.current.focus();
    }
  }, [isToDropdownOpen]);

  // Debounced CoinGecko search for "To" token (all supported chains)
  useEffect(() => {
    if (!toSearchQuery || toSearchQuery.length < 2) {
      setToCoinGeckoResults([]);
      return;
    }

    const searchCoinGecko = async () => {
      setIsSearchingTo(true);
      try {
        const response = await (elizaClient.cdp as any).searchTokens({
          query: toSearchQuery,
          // Don't filter by chain - allow any supported chain
        });

        // Convert CoinGecko tokens to our Token interface
        const externalTokens: Token[] = response.tokens
          .filter((t: any) => t.contractAddress && t.chain && SWAP_SUPPORTED_NETWORKS.includes(t.chain))
          .map((t: any) => ({
            symbol: t.symbol,
            name: t.name,
            balance: '0',
            balanceFormatted: '0',
            usdValue: null,
            usdPrice: t.price,
            contractAddress: t.contractAddress,
            chain: t.chain!,
            decimals: 18, // Default, will need to fetch actual decimals if needed
            icon: t.icon || undefined,
            isExternal: true,
          }));

        setToCoinGeckoResults(externalTokens);
      } catch (error) {
        console.error('Failed to search CoinGecko tokens:', error);
        setToCoinGeckoResults([]);
      } finally {
        setIsSearchingTo(false);
      }
    };

    const timeoutId = setTimeout(searchCoinGecko, 500);
    return () => clearTimeout(timeoutId);
  }, [toSearchQuery]);

  // Debounced price estimation
  useEffect(() => {
    if (!fromToken || !toToken || !fromAmount || parseFloat(fromAmount) <= 0) {
      setToAmount('');
      return;
    }

    const timeoutId = setTimeout(async () => {
      await estimateSwapPrice();
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [fromToken, toToken, fromAmount]);

  const estimateSwapPrice = async () => {
    if (!fromToken || !toToken || !fromAmount || parseFloat(fromAmount) <= 0) {
      return;
    }

    // Check if tokens are on the same chain
    if (fromToken.chain !== toToken.chain) {
      setToAmount('');
      setWarning('Cross-chain swaps not supported. Please select tokens on the same chain.');
      return;
    }

    setIsLoadingPrice(true);
    setWarning(null);

    try {
      // Convert amount to base units (with decimals) - avoid scientific notation
      const amountInBaseUnits = convertToBaseUnits(fromAmount, fromToken.decimals);

      // Send token address or 'eth' for native token - server will normalize it
      const fromTokenAddress = fromToken.contractAddress || 'eth';
      const toTokenAddress = toToken.contractAddress || 'eth';

      const result = await elizaClient.cdp.getSwapPrice({
        network: fromToken.chain,
        fromToken: fromTokenAddress,
        toToken: toTokenAddress,
        fromAmount: amountInBaseUnits,
      });

      const CDP_NETWORKS = ['base', 'ethereum'];
      const isNonCdpNetwork = !CDP_NETWORKS.includes(fromToken.chain);

      if (result.liquidityAvailable) {
        // Convert toAmount from base units to readable format
        const toAmountFormatted = parseFloat(result.toAmount) / Math.pow(10, toToken.decimals);
        setToAmount(toAmountFormatted.toFixed(6).replace(/\.?0+$/, ''));
      } else if (isNonCdpNetwork) {
        // Non-CDP networks: price estimation not available, but swap is still possible
        setToAmount('Market rate');
        setWarning('Price estimation not available. Swap will execute at market rate via Uniswap V3.');
      } else {
        // CDP network but no liquidity
        setToAmount('');
        setWarning('Insufficient liquidity for this swap');
      }
    } catch (err) {
      console.error('Error estimating swap price:', err);
      setToAmount('');
      setWarning('Failed to get swap price. Please try again.');
    } finally {
      setIsLoadingPrice(false);
    }
  };

  const handleSwap = async () => {
    if (!fromToken || !toToken || !fromAmount || parseFloat(fromAmount) <= 0) {
      showError('Validation Error', 'Please enter a valid amount', modalId);
      return;
    }

    // Check if tokens are on the same chain
    if (fromToken.chain !== toToken.chain) {
      showError('Validation Error', 'Cross-chain swaps not supported. Please select tokens on the same chain.', modalId);
      return;
    }

    const amount = parseFloat(fromAmount);
    const balance = parseFloat(fromToken.balanceFormatted);

    if (amount > balance) {
      showError('Insufficient Balance', `Insufficient ${fromToken.symbol} balance`, modalId);
      return;
    }

    try {
      showLoading('Swapping Tokens', 'Please wait while we process your swap...', modalId);
      
      // Convert amount to base units - avoid scientific notation
      const amountInBaseUnits = convertToBaseUnits(fromAmount, fromToken.decimals);
      
      // Convert slippage to basis points (1% = 100 bps)
      const slippageBps = Math.round(parseFloat(slippage) * 100);

      // Send token address or 'eth' for native token - server will normalize it
      const fromTokenAddress = fromToken.contractAddress || 'eth';
      const toTokenAddress = toToken.contractAddress || 'eth';

      const result = await elizaClient.cdp.swap({
        network: fromToken.chain,
        fromToken: fromTokenAddress,
        toToken: toTokenAddress,
        fromAmount: amountInBaseUnits,
        slippageBps,
      });

      console.log('✅ Swap successful:', result);
      
      // Show success
      showSuccess(
        'Swap Successful!',
        `Successfully swapped ${fromAmount} ${fromToken.symbol} to ${toToken.symbol}`,
        modalId,
        false // Don't auto-close
      );
      
      // Reset form
      setFromToken(null);
      setToToken(null);
      setFromAmount('');
      setToAmount('');
      
      // Trigger wallet refresh
      onSuccess();
      
    } catch (err: any) {
      console.error('Error executing swap:', err);
      showError('Swap Failed', err?.message || 'Failed to execute swap. Please try again.', modalId);
    }
  };

  const handleSwitchTokens = () => {
    // Don't switch if toToken is an external token (user doesn't own it)
    if (toToken?.isExternal) {
      showError('Cannot Switch', 'You do not own the destination token', modalId);
      return;
    }
    
    const temp = fromToken;
    setFromToken(toToken);
    setToToken(temp);
    setFromAmount('');
    setToAmount('');
    setIsLoadingPrice(false); // Stop any ongoing price calculation
    setWarning(null);
  };

  const handleSetMaxAmount = () => {
    if (fromToken) {
      setFromAmount(fromToken.balanceFormatted);
    }
  };

  // Get token icon (with fallback for native tokens)
  const getTokenIcon = (token: Token) => {
    if (token.icon) {
      return token.icon;
    }
    
    // Try to get from constants by symbol
    const iconPath = getTokenIconBySymbol(token.symbol);
    if (iconPath) {
      return iconPath;
    }
    
    return null;
  };

  if (!isOpen) return null;

  return createPortal(
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div 
        className="bg-background rounded-lg max-w-md w-full my-auto p-1.5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-pop rounded-lg p-4 sm:p-6 space-y-4 flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between flex-shrink-0">
            <h3 className="text-lg font-semibold">Swap Tokens</h3>
            <Button
              onClick={onClose}
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex-1 overflow-visible space-y-4 min-h-0">

              {/* From Token */}
              <div className="space-y-2">
                <label className="text-xs text-muted-foreground">From</label>
                <div className="space-y-2" style={{ overflow: 'visible' }}>
                  {/* Custom Dropdown */}
                  <div className="relative" ref={fromDropdownRef} style={{ zIndex: 60 }}>
                    <button
                      type="button"
                      onClick={() => setIsFromDropdownOpen(!isFromDropdownOpen)}
                      className="w-full p-3 border border-border rounded-lg flex items-center justify-between hover:bg-accent/50 transition-colors"
                    >
                      {fromToken ? (
                        <>
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center overflow-hidden">
                              {getTokenIcon(fromToken) ? (
                                <img src={getTokenIcon(fromToken)!} alt={fromToken.symbol} className="w-full h-full object-cover" />
                              ) : (
                                <span className="text-sm font-bold text-muted-foreground uppercase">{fromToken.symbol.charAt(0)}</span>
                              )}
                            </div>
                            <div className="text-left">
                              <p className="text-sm font-medium">{fromToken.symbol}</p>
                              <p className="text-xs text-muted-foreground">{fromToken.chain.toUpperCase()}</p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-mono">{parseFloat(fromToken.balanceFormatted).toFixed(6)}</p>
                            <p className="text-xs text-muted-foreground">${fromToken.usdValue?.toFixed(2) || '0.00'}</p>
                          </div>
                        </>
                      ) : (
                        <span className="text-muted-foreground">Select a token...</span>
                      )}
                    </button>

                    {/* Dropdown Menu */}
                    {isFromDropdownOpen && (
                      <div className="absolute z-50 w-full mt-1 bg-popover border border-border rounded-lg shadow-lg overflow-hidden">
                        {/* Search Input */}
                        <div className="p-2 border-b border-border sticky top-0 bg-popover">
                          <input
                            ref={fromSearchInputRef}
                            type="text"
                            value={fromSearchQuery}
                            onChange={(e) => setFromSearchQuery(e.target.value)}
                            placeholder="Search your tokens..."
                            className="w-full bg-muted border border-border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                            onClick={(e) => e.stopPropagation()}
                          />
                        </div>
                        
                        {/* Token List */}
                        <div className="max-h-64 overflow-y-auto">
                          {filterTokens(swapSupportedTokens, fromSearchQuery)
                            .filter(token => {
                              // Hide the exact same token as toToken (same chain and same address/symbol)
                              if (!toToken) return true;
                              return !(token.chain === toToken.chain && (token.contractAddress || token.symbol) === (toToken.contractAddress || toToken.symbol));
                            })
                            .map((token, index) => {
                            return (
                              <button
                                key={`${token.chain}-${token.contractAddress || token.symbol}-${index}`}
                                type="button"
                                onClick={() => {
                                  setFromToken(token);
                                  setFromAmount('');
                                  setToAmount('');
                                  // Reset toToken if it's on a different chain
                                  if (toToken && toToken.chain !== token.chain) {
                                    setToToken(null);
                                  }
                                  setFromSearchQuery('');
                                  setIsFromDropdownOpen(false);
                                }}
                                className={`w-full p-3 flex items-center justify-between hover:bg-accent transition-colors ${
                                  fromToken === token ? 'bg-accent' : ''
                                }`}
                              >
                                <div className="flex items-center gap-2">
                                  <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center overflow-hidden">
                                    {getTokenIcon(token) ? (
                                      <img src={getTokenIcon(token)!} alt={token.symbol} className="w-full h-full object-cover" />
                                    ) : (
                                      <span className="text-sm font-bold text-muted-foreground uppercase">{token.symbol.charAt(0)}</span>
                                    )}
                                  </div>
                                  <div className="text-left">
                                    <p className="text-sm font-medium">{token.symbol}</p>
                                    <p className="text-xs text-muted-foreground">{token.chain.toUpperCase()}</p>
                                  </div>
                                </div>
                                <div className="text-right">
                                  <p className="text-sm font-mono">{parseFloat(token.balanceFormatted).toFixed(6)}</p>
                                  <p className="text-xs text-muted-foreground">${token.usdValue?.toFixed(2) || '0.00'}</p>
                                </div>
                              </button>
                            );
                          })}
                          
                          {/* No results message */}
                          {filterTokens(swapSupportedTokens, fromSearchQuery)
                            .filter(token => {
                              if (!toToken) return true;
                              return !(token.chain === toToken.chain && (token.contractAddress || token.symbol) === (toToken.contractAddress || toToken.symbol));
                            }).length === 0 && (
                            <div className="p-4 text-center text-sm text-muted-foreground">
                              No tokens found
                            </div>
                          )}
                      </div>
                    </div>
                  )}
                  </div>

                  {/* Amount Input - Always visible */}
                    <div className="relative">
                      <input
                        type="number"
                        value={fromAmount}
                        onChange={(e) => setFromAmount(e.target.value)}
                        placeholder="0.0"
                        step="any"
                        min="0"
                      disabled={!fromToken}
                      className={`w-full bg-muted border border-border rounded-lg p-3 pr-16 text-sm focus:outline-none focus:ring-2 focus:ring-primary ${
                        !fromToken ? 'opacity-50 cursor-not-allowed' : ''
                      }`}
                      />
                      <Button
                        onClick={handleSetMaxAmount}
                        variant="ghost"
                        size="sm"
                      disabled={!fromToken}
                        className="absolute right-2 top-1/2 -translate-y-1/2 h-7 text-xs"
                      >
                        MAX
                      </Button>
                    </div>
                </div>
              </div>

              {/* Switch Button */}
              <div className="flex justify-center">
                <Button
                  onClick={handleSwitchTokens}
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0 rounded-full"
                  disabled={!fromToken && !toToken || toToken?.isExternal}
                  title={toToken?.isExternal ? 'Cannot switch: You do not own the destination token' : 'Switch tokens'}
                >
                  <ArrowDownUp className="h-4 w-4" />
                </Button>
              </div>

              {/* To Token */}
              <div className="space-y-2">
                <label className="text-xs text-muted-foreground">To</label>
                <div className="space-y-2" style={{ overflow: 'visible' }}>
                  {/* Custom Dropdown */}
                  <div className="relative" ref={toDropdownRef} style={{ zIndex: 50 }}>
                    <button
                      type="button"
                      onClick={() => setIsToDropdownOpen(!isToDropdownOpen)}
                      className="w-full p-3 border border-border rounded-lg flex items-center justify-between transition-colors hover:bg-accent/50"
                    >
                      {toToken ? (
                        <>
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center overflow-hidden">
                              {getTokenIcon(toToken) ? (
                                <img src={getTokenIcon(toToken)!} alt={toToken.symbol} className="w-full h-full object-cover" />
                              ) : (
                                <span className="text-sm font-bold text-muted-foreground uppercase">{toToken.symbol.charAt(0)}</span>
                              )}
                            </div>
                            <div className="text-left">
                              <p className="text-sm font-medium">
                                {toToken.symbol}
                                {toToken.isExternal && <span className="ml-1 text-xs text-blue-500">🌐</span>}
                              </p>
                              <p className="text-xs text-muted-foreground">{toToken.chain.toUpperCase()}</p>
                            </div>
                          </div>
                          <div className="text-right">
                            {toToken.isExternal ? (
                              <p className="text-xs text-muted-foreground">
                                {toToken.usdPrice ? `$${toToken.usdPrice.toFixed(4)}` : 'External'}
                              </p>
                            ) : (
                              <>
                                <p className="text-sm font-mono">{parseFloat(toToken.balanceFormatted).toFixed(6)}</p>
                                <p className="text-xs text-muted-foreground">${toToken.usdValue?.toFixed(2) || '0.00'}</p>
                              </>
                            )}
                          </div>
                        </>
                      ) : (
                        <span className="text-muted-foreground">Select a token...</span>
                      )}
                    </button>

                    {/* Dropdown Menu */}
                    {isToDropdownOpen && (
                      <div className="absolute z-50 w-full mt-1 bg-popover border border-border rounded-lg shadow-lg overflow-hidden">
                        {/* Search Input */}
                        <div className="p-2 border-b border-border sticky top-0 bg-popover">
                          <input
                            ref={toSearchInputRef}
                            type="text"
                            value={toSearchQuery}
                            onChange={(e) => setToSearchQuery(e.target.value)}
                            placeholder="Search any token (name, symbol, address)..."
                            className="w-full bg-muted border border-border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                            onClick={(e) => e.stopPropagation()}
                          />
                      </div>
                        
                        {/* Token List */}
                        <div className="max-h-64 overflow-y-auto">
                          {/* Show loading indicator */}
                          {isSearchingTo && toSearchQuery.length >= 2 && (
                            <div className="p-3 flex items-center justify-center text-sm text-muted-foreground">
                              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                              Searching Tokens...
                    </div>
                  )}

                          {mergeTokens(
                            filterTokens(swapSupportedTokens, toSearchQuery),
                            toCoinGeckoResults
                          )
                            .filter(t => {
                              // Hide the exact same token as fromToken (same chain and same address/symbol)
                              if (!fromToken) return true;
                              return !(t.chain === fromToken.chain && (t.contractAddress || t.symbol) === (fromToken.contractAddress || fromToken.symbol));
                            })
                            .map((token, index) => {
                            return (
                              <button
                                key={`${token.chain}-${token.contractAddress || token.symbol}-${index}`}
                                type="button"
                                onClick={() => {
                                  // If this is an external token, check if user owns it in their wallet
                                  let selectedToken = token;
                                  if (token.isExternal && token.contractAddress) {
                                    // Find the wallet version of this token
                                    const walletVersion = swapSupportedTokens.find(
                                      t => t.chain === token.chain && 
                                      t.contractAddress?.toLowerCase() === token.contractAddress?.toLowerCase()
                                    );
                                    if (walletVersion) {
                                      selectedToken = walletVersion; // Use wallet version with balance
                                    }
                                  }
                                  
                                  setToToken(selectedToken);
                                  setToAmount('');
                                  setToSearchQuery('');
                                  // Reset fromToken if different chain selected
                                  if (fromToken && fromToken.chain !== selectedToken.chain) {
                                    setFromToken(null);
                                    setFromAmount('');
                                  }
                                  setIsToDropdownOpen(false);
                                }}
                                className={`w-full p-3 flex items-center justify-between hover:bg-accent transition-colors ${
                                  toToken === token ? 'bg-accent' : ''
                                }`}
                              >
                                <div className="flex items-center gap-2">
                                  <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center overflow-hidden">
                                    {getTokenIcon(token) ? (
                                      <img src={getTokenIcon(token)!} alt={token.symbol} className="w-full h-full object-cover" />
                                    ) : (
                                      <span className="text-sm font-bold text-muted-foreground uppercase">{token.symbol.charAt(0)}</span>
                                    )}
                                  </div>
                                  <div className="text-left">
                                    <p className="text-sm font-medium">
                                      {token.symbol}
                                      {token.isExternal && <span className="ml-1 text-xs text-blue-500">🌐</span>}
                                    </p>
                                    <p className="text-xs text-muted-foreground">{token.chain.toUpperCase()}</p>
                                  </div>
                                </div>
                                <div className="text-right">
                                  {token.isExternal ? (
                                    <>
                                      <p className="text-xs text-muted-foreground">
                                        {token.usdPrice ? `$${token.usdPrice.toFixed(4)}` : 'External'}
                                      </p>
                                      {/* Check if user actually owns this token */}
                                      {swapSupportedTokens.find(
                                        t => t.chain === token.chain && 
                                        t.contractAddress?.toLowerCase() === token.contractAddress?.toLowerCase()
                                      ) && (
                                        <p className="text-xs text-green-500">✓ Owned</p>
                                      )}
                                    </>
                                  ) : (
                                    <>
                                      <p className="text-sm font-mono">{parseFloat(token.balanceFormatted).toFixed(6)}</p>
                                      <p className="text-xs text-muted-foreground">${token.usdValue?.toFixed(2) || '0.00'}</p>
                                    </>
                                  )}
                                </div>
                              </button>
                            );
                          })}
                          
                          {/* No results message */}
                          {!isSearchingTo && mergeTokens(filterTokens(swapSupportedTokens, toSearchQuery), toCoinGeckoResults)
                            .filter(t => {
                              if (!fromToken) return true;
                              return !(t.chain === fromToken.chain && (t.contractAddress || t.symbol) === (fromToken.contractAddress || fromToken.symbol));
                            })
                            .length === 0 && (
                            <div className="p-4 text-center text-sm text-muted-foreground">
                              No tokens found
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Estimated Amount - Always visible */}
                    <div className="relative">
                      <input
                        type="text"
                        value={isLoadingPrice ? 'Calculating...' : toAmount}
                        readOnly
                        placeholder="0.0"
                      disabled={!toToken}
                      className={`w-full bg-muted border border-border rounded-lg p-3 text-sm focus:outline-none cursor-not-allowed ${
                        !toToken ? 'opacity-50' : ''
                      }`}
                      />
                      {isLoadingPrice && (
                        <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
                      )}
                    </div>
                </div>
              </div>

              {/* Slippage Tolerance */}
              <div className="space-y-2 mt-2">
                <label className="text-xs text-muted-foreground">Slippage Tolerance (%)</label>
                <div className="flex gap-2">
                  {['0.5', '1', '2'].map((value) => (
                    <Button
                      key={value}
                      onClick={() => setSlippage(value)}
                      variant={slippage === value ? 'default' : 'outline'}
                      size="sm"
                      className="flex-1"
                    >
                      {value}%
                    </Button>
                  ))}
                  <input
                    type="number"
                    value={slippage}
                    onChange={(e) => setSlippage(e.target.value)}
                    step="0.1"
                    min="0"
                    max="50"
                    className="w-20 bg-muted border border-border rounded-lg px-2 py-1 text-sm text-center focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              </div>

              {/* Warning Message */}
              {warning && (
                <div className="text-xs text-yellow-500 bg-yellow-500/10 p-2 rounded border border-yellow-500/20">
                  ⚠️ {warning}
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex gap-2 pt-2 flex-shrink-0">
                <Button
                  onClick={onClose}
                  variant="outline"
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleSwap}
                  className="flex-1"
                  disabled={
                    !fromToken || 
                    !toToken || 
                    !fromAmount || 
                    !toAmount || 
                    parseFloat(fromAmount) <= 0 ||
                    isLoadingPrice
                  }
                >
                  {isLoadingPrice ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Calculating...
                    </>
                  ) : (
                    'Swap'
                  )}
                </Button>
              </div>
            </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

