import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Copy, Check, TrendingUp, TrendingDown } from 'lucide-react';
import { Button } from '../../ui/button';
import { getTokenIconBySymbol } from '../../../constants/chains';
import { XAxis, YAxis, CartesianGrid, Area, AreaChart } from 'recharts';
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '../../ui/chart';

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
  icon?: string;
}

type ChainNetwork = 'base' | 'ethereum' | 'polygon';

interface TokenDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  token: Token;
}

type TimeFrame = '1h' | '24h' | '7d' | '30d' | '1y';

interface PriceDataPoint {
  timestamp: number;
  price: number;
  date: string;
}

const chartConfig = {
  price: {
    label: "Price",
    color: "var(--chart-2)",
  },
} satisfies ChartConfig;

export function TokenDetailModal({ isOpen, onClose, token }: TokenDetailModalProps) {
  const [isCopied, setIsCopied] = useState(false);
  const [activeTimeFrame, setActiveTimeFrame] = useState<TimeFrame>('24h');
  const [priceData, setPriceData] = useState<PriceDataPoint[]>([]);
  const [isLoadingChart, setIsLoadingChart] = useState(false);
  const [priceChange, setPriceChange] = useState<{ value: number; percentage: number } | null>(null);

  // Calculate current price from usdPrice
  const currentPrice = token.usdPrice || 0;

  const handleCopyAddress = async () => {
    if (!token.contractAddress) return;
    await navigator.clipboard.writeText(token.contractAddress);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  // Fetch price history from CoinGecko
  useEffect(() => {
    const fetchPriceHistory = async () => {
      setIsLoadingChart(true);
      try {
        const apiKey = import.meta.env.COINGECKO_API_KEY;
        const baseUrl = apiKey ? 'https://pro-api.coingecko.com/api/v3' : 'https://api.coingecko.com/api/v3';
        
        // Get days for timeframe
        const daysMap: Record<TimeFrame, string> = {
          '1h': '1',
          '24h': '1',
          '7d': '7',
          '30d': '30',
          '1y': '365',
        };
        const days = daysMap[activeTimeFrame];

        let url: string;

        if (!token.contractAddress) {
          // Native tokens - use CoinGecko coin ID
          const nativeTokenIds: Record<string, string> = {
            'ETH-ethereum': 'ethereum',
            'ETH-base': 'ethereum',
            'MATIC-polygon': 'matic-network',
            'POL-polygon': 'matic-network',
          };
          const tokenKey = `${token.symbol}-${token.chain}`;
          const coinId = nativeTokenIds[tokenKey];

          if (!coinId) {
            console.warn('No CoinGecko ID found for native token:', tokenKey);
            setPriceData([]);
            setPriceChange(null);
            setIsLoadingChart(false);
            return;
          }

          // Fetch market chart data using coin ID
          url = `${baseUrl}/coins/${coinId}/market_chart?vs_currency=usd&days=${days}`;
        } else {
          // ERC20 tokens - use contract address
          const platformMap: Record<string, string> = {
            base: 'base',
            ethereum: 'ethereum',
            polygon: 'polygon-pos',
          };
          const platform = platformMap[token.chain as ChainNetwork] || token.chain;
          url = `${baseUrl}/coins/${platform}/contract/${token.contractAddress}/market_chart?vs_currency=usd&days=${days}`;
        }

        const response = await fetch(url, {
          headers: {
            'Accept': 'application/json',
            ...(apiKey ? { 'x-cg-pro-api-key': apiKey } : {}),
          },
        });

        if (response.ok) {
          const data = await response.json();
          const prices = data.prices || [];
          
          // Filter data based on timeframe
          let filteredPrices = prices;
          if (activeTimeFrame === '1h') {
            // Last hour - get last 60 data points
            filteredPrices = prices.slice(-60);
          }

          const formattedData: PriceDataPoint[] = filteredPrices.map(([timestamp, price]: [number, number]) => ({
            timestamp,
            price,
            date: formatDateForTimeframe(timestamp, activeTimeFrame),
          }));

          setPriceData(formattedData);

          // Calculate price change
          if (formattedData.length > 0) {
            const firstPrice = formattedData[0].price;
            const lastPrice = formattedData[formattedData.length - 1].price;
            const change = lastPrice - firstPrice;
            const changePercent = (change / firstPrice) * 100;
            setPriceChange({ value: change, percentage: changePercent });
          }
        } else {
          console.warn('Failed to fetch price history');
          setPriceData([]);
          setPriceChange(null);
        }
      } catch (error) {
        console.error('Error fetching price history:', error);
        setPriceData([]);
        setPriceChange(null);
      } finally {
        setIsLoadingChart(false);
      }
    };

    if (isOpen) {
      fetchPriceHistory();
    }
  }, [token, activeTimeFrame, isOpen]);

  const formatDateForTimeframe = (timestamp: number, timeframe: TimeFrame): string => {
    const date = new Date(timestamp);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    
    switch (timeframe) {
      case '1h':
        // Format: HH:MM
        return `${hours}:${minutes}`;
      case '24h':
        // Format: HH:MM
        return `${hours}:${minutes}`;
      case '7d':
        // Format: DD/MM (like monky: 06/07, 07/07)
        return `${day}/${month}`;
      case '30d':
        // Format: DD/MM
        return `${day}/${month}`;
      case '1y':
        // Format: MM/YY
        const year = String(date.getFullYear()).slice(-2);
        return `${month}/${year}`;
      default:
        return `${day}/${month}`;
    }
  };

  const formatPrice = (price: number): string => {
    if (price < 0.01) return price.toExponential(2);
    if (price < 1) return price.toFixed(6).replace(/\.?0+$/, '');
    return price.toFixed(2);
  };

  const formatYAxisValue = (value: number): string => {
    if (value === 0) return '';
    if (value >= 1000000) return `$${(value / 1000000).toFixed(0)}M`;
    if (value >= 1000) return `$${(value / 1000).toFixed(0)}K`;
    if (value < 0.01) return `$${value.toExponential(0)}`;
    return `$${value.toFixed(2)}`;
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-background rounded-lg max-w-2xl w-full mx-4 shadow-xl max-h-[90vh] overflow-hidden p-1.5" onClick={(e) => e.stopPropagation()}>
        <div className="bg-pop rounded-lg h-full overflow-y-auto">
          {/* Header */}
          <div className="sticky top-0 bg-background border-b border-border p-4 flex items-center justify-between z-10">
            <div className="flex items-center gap-3">
              {(() => {
                // Check if token has icon from CoinGecko
                if (token.icon && token.icon.startsWith('http')) {
                  return <img src={token.icon} alt={token.symbol} className="w-10 h-10 rounded-full" />;
                }
                
                // Try to get icon from constants
                const iconPath = getTokenIconBySymbol(token.symbol);
                if (iconPath) {
                  return <img src={iconPath} alt={token.symbol} className="w-10 h-10 rounded-full" />;
                }
                
                // Fallback: gray circle with first letter
                return (
                  <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center text-lg font-bold">
                    {token.symbol[0]}
                  </div>
                );
              })()}
              <div>
                <h2 className="text-xl font-semibold">{token.symbol}</h2>
                <p className="text-sm text-muted-foreground">{token.name}</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="w-6 h-6" />
            </button>
          </div>

          {/* Content */}
          <div className="p-4 space-y-6">
            {/* Price Info */}
            <div className="space-y-2">
              <div className="flex items-baseline gap-3">
                <span className="text-3xl font-bold">${formatPrice(currentPrice)}</span>
                {priceChange && (
                  <div className={`flex items-center gap-1 text-sm font-medium ${
                    priceChange.value >= 0 ? 'text-green-500' : 'text-red-500'
                  }`}>
                    {priceChange.value >= 0 ? (
                      <TrendingUp className="w-4 h-4" />
                    ) : (
                      <TrendingDown className="w-4 h-4" />
                    )}
                    <span>
                      {priceChange.value >= 0 ? '+' : ''}{priceChange.percentage.toFixed(2)}%
                    </span>
                  </div>
                )}
              </div>
              <div className="text-sm text-muted-foreground">
                Balance: {parseFloat(token.balanceFormatted).toFixed(6)} {token.symbol} (${token.usdValue?.toFixed(2) || '0.00'})
              </div>
            </div>

            {/* Contract Address */}
            {token.contractAddress && (
              <div className="bg-muted rounded-lg p-3 space-y-2">
                <div className="text-xs text-muted-foreground uppercase font-medium">Contract Address</div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-sm bg-background p-2 rounded border border-border overflow-x-auto scrollbar-thin">
                    {token.contractAddress}
                  </code>
                  <Button
                    onClick={handleCopyAddress}
                    variant="ghost"
                    size="sm"
                    className="flex-shrink-0"
                  >
                    {isCopied ? (
                      <Check className="w-4 h-4 text-green-500" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </Button>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground">Chain:</span>
                  <span className="px-2 py-0.5 rounded bg-background text-foreground uppercase font-mono">
                    {token.chain}
                  </span>
                </div>
              </div>
            )}

            {/* Price Chart */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">Price Chart</h3>
                <div className="inline-flex h-8 items-center justify-center rounded-md bg-muted p-1 text-muted-foreground">
                  <button
                    onClick={() => setActiveTimeFrame('1h')}
                    className={`inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1 text-xs font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 ${
                      activeTimeFrame === '1h' ? 'bg-background text-foreground shadow-sm' : ''
                    }`}
                  >
                    1H
                  </button>
                  <button
                    onClick={() => setActiveTimeFrame('24h')}
                    className={`inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1 text-xs font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 ${
                      activeTimeFrame === '24h' ? 'bg-background text-foreground shadow-sm' : ''
                    }`}
                  >
                    24H
                  </button>
                  <button
                    onClick={() => setActiveTimeFrame('7d')}
                    className={`inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1 text-xs font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 ${
                      activeTimeFrame === '7d' ? 'bg-background text-foreground shadow-sm' : ''
                    }`}
                  >
                    7D
                  </button>
                  <button
                    onClick={() => setActiveTimeFrame('30d')}
                    className={`inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1 text-xs font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 ${
                      activeTimeFrame === '30d' ? 'bg-background text-foreground shadow-sm' : ''
                    }`}
                  >
                    30D
                  </button>
                  <button
                    onClick={() => setActiveTimeFrame('1y')}
                    className={`inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1 text-xs font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 ${
                      activeTimeFrame === '1y' ? 'bg-background text-foreground shadow-sm' : ''
                    }`}
                  >
                    1Y
                  </button>
                </div>
              </div>

              <div className="bg-accent rounded-lg p-3">
                {isLoadingChart ? (
                  <div className="flex items-center justify-center h-[300px]">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                  </div>
                ) : priceData.length > 0 ? (
                  <ChartContainer config={chartConfig} className="md:aspect-[3/1] w-full">
                    <AreaChart
                      accessibilityLayer
                      data={priceData}
                      margin={{
                        left: -12,
                        right: 12,
                        top: 12,
                        bottom: 12,
                      }}
                    >
                      <defs>
                        <linearGradient id="fillPrice" x1="0" y1="0" x2="0" y2="1">
                          <stop
                            offset="5%"
                            stopColor="var(--color-price)"
                            stopOpacity={0.8}
                          />
                          <stop
                            offset="95%"
                            stopColor="var(--color-price)"
                            stopOpacity={0.1}
                          />
                        </linearGradient>
                      </defs>
                      <CartesianGrid
                        horizontal={false}
                        strokeDasharray="8 8"
                        strokeWidth={2}
                        stroke="var(--muted-foreground)"
                        opacity={0.3}
                      />
                      <XAxis
                        dataKey="date"
                        tickLine={false}
                        tickMargin={12}
                        strokeWidth={1.5}
                        tick={{ fontSize: 0 }}
                        className="uppercase text-sm fill-muted-foreground"
                      />
                      <YAxis
                        tickLine={false}
                        axisLine={false}
                        tickMargin={0}
                        tickCount={6}
                        className="text-sm fill-muted-foreground"
                        tickFormatter={formatYAxisValue}
                        domain={[0, "dataMax"]}
                      />
                      <ChartTooltip
                        cursor={false}
                        content={
                          <ChartTooltipContent
                            indicator="dot"
                            className="min-w-[200px] px-4 py-3"
                            formatter={(value) => `$${typeof value === 'number' ? formatPrice(value) : value}`}
                          />
                        }
                      />
                      <Area
                        dataKey="price"
                        type="linear"
                        fill="url(#fillPrice)"
                        fillOpacity={0.4}
                        stroke="var(--color-price)"
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4 }}
                      />
                    </AreaChart>
                  </ChartContainer>
                ) : (
                  <div className="flex items-center justify-center h-[300px] text-muted-foreground">
                    No price data available
                  </div>
                )}
              </div>
            </div>

            {/* Additional Info */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-muted rounded-lg p-3">
                <div className="text-xs text-muted-foreground mb-1">Network</div>
                <div className="text-sm font-medium uppercase">{token.chain}</div>
              </div>
              {token.decimals && (
                <div className="bg-muted rounded-lg p-3">
                  <div className="text-xs text-muted-foreground mb-1">Decimals</div>
                  <div className="text-sm font-medium">{token.decimals}</div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
