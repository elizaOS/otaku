import { useState } from 'react';
import { XAxis, YAxis, CartesianGrid, Area, AreaChart } from 'recharts';
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/frontend/components/ui/chart';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { cn } from '@/frontend/lib/utils';

interface PriceDataPoint {
  timestamp: number;
  price: number;
  date: string;
}

interface MarketCapDataPoint {
  timestamp: number;
  marketCap: number;
  date: string;
}

type ChartType = 'price' | 'marketcap';

interface PriceChartData {
  token_identifier: string;
  token_symbol: string | null;
  chain: string;
  timeframe: string;
  current_price: number | null;
  current_market_cap?: number | null;
  data_points: PriceDataPoint[];
  market_cap_data_points?: MarketCapDataPoint[];
  data_points_count: number;
  market_cap_data_points_count?: number;
  price_change?: {
    value: number;
    percentage: number;
  } | null;
  market_cap_change?: {
    value: number;
    percentage: number;
  } | null;
}

interface ChatPriceChartProps {
  data: PriceChartData;
}

const chartConfig = {
  price: {
    label: "Price",
    color: "var(--chart-2)",
  },
  marketCap: {
    label: "Market Cap",
    color: "var(--chart-1)",
  },
} satisfies ChartConfig;

export function ChatPriceChart({ data }: ChatPriceChartProps) {
  const [activeChartType, setActiveChartType] = useState<ChartType>('price');
  
  // Base formatting function used by graph values (Y-axis, tooltips)
  const formatValue = (value: number, includeSymbol: boolean = false): string => {
    const prefix = includeSymbol ? '$' : '';
    
    if (value === 0) return '';
    if (value >= 1000000000) return `${prefix}${(value / 1000000000).toFixed(2)}B`;
    if (value >= 1000000) return `${prefix}${(value / 1000000).toFixed(2)}M`;
    if (value >= 1000) return `${prefix}${(value / 1000).toFixed(2)}K`;
    if (value >= 1) return `${prefix}${value.toFixed(2)}`;
    if (value >= 0.01) return `${prefix}${value.toFixed(4)}`;
    if (value >= 0.0001) return `${prefix}${value.toFixed(6)}`;
    return `${prefix}${value.toFixed(8)}`;
  };

  // Header formatting function - only abbreviates for values >= 1M
  const formatHeaderValue = (value: number, includeSymbol: boolean = false): string => {
    const prefix = includeSymbol ? '$' : '';
    
    if (value === 0) return '';
    if (value >= 1000000000) return `${prefix}${(value / 1000000000).toFixed(2)}B`;
    if (value >= 1000000) return `${prefix}${(value / 1000000).toFixed(2)}M`;
    // For values < 1M, show precise value with comma separators
    if (value >= 1) return `${prefix}${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (value >= 0.01) return `${prefix}${value.toFixed(4)}`;
    if (value >= 0.0001) return `${prefix}${value.toFixed(6)}`;
    return `${prefix}${value.toFixed(8)}`;
  };

  const formatPrice = (price: number): string => formatHeaderValue(price, false);
  const formatYAxisValue = (value: number): string => formatValue(value, true);
  const formatMarketCap = (value: number): string => formatHeaderValue(value, true);

  const getEvenlySpacedTimeTicks = (dataPoints: PriceDataPoint[] | MarketCapDataPoint[], count: number): number[] => {
    if (dataPoints.length === 0) return [];
    const min = dataPoints[0].timestamp;
    const max = dataPoints[dataPoints.length - 1].timestamp;
    if (count <= 1 || min === max) return [min];
    const step = (max - min) / (count - 1);
    return Array.from({ length: count }, (_, i) => Math.round(min + i * step));
  };

  const priceChange = data.price_change;
  const marketCapChange = data.market_cap_change;
  const isPositive = activeChartType === 'price' 
    ? (priceChange ? priceChange.value >= 0 : false)
    : (marketCapChange ? marketCapChange.value >= 0 : false);

  const hasMarketCapData = data.market_cap_data_points && data.market_cap_data_points.length > 0;

  return (
    <div className="space-y-3 w-full">
      {/* Header with token info */}
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-semibold">
            {data.token_symbol || data.token_identifier}
          </h4>
          <p className="text-xs text-muted-foreground">
            {data.timeframe.toUpperCase()} Chart
          </p>
        </div>
      </div>

      {/* Chart Type Tabs + Current Value + Change % */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:justify-between">
       

        <div className='flex items-center gap-2'>
          {/* Current Price or Market Cap */}
          {activeChartType === 'price' && data.current_price && (
            <div className="text-2xl font-bold">
              ${formatPrice(data.current_price)}
            </div>
          )}
          {activeChartType === 'marketcap' && data.current_market_cap && (
            <div className="text-2xl font-bold">
              {formatMarketCap(data.current_market_cap)}
            </div>
          )}
          {/* Price/Market Cap Change */}
          {activeChartType === 'price' && priceChange && priceChange.percentage !== null && priceChange.percentage !== undefined && (
            <div className={cn(
              "flex items-center gap-1 text-sm font-medium",
              isPositive ? 'text-green-500' : 'text-red-500'
            )}>
              {isPositive ? (
                <TrendingUp className="w-4 h-4" />
              ) : (
                <TrendingDown className="w-4 h-4" />
              )}
              <span>
                {isPositive ? '+' : ''}{priceChange.percentage.toFixed(2)}%
              </span>
            </div>
          )}
          {activeChartType === 'marketcap' && marketCapChange && marketCapChange.percentage !== null && marketCapChange.percentage !== undefined && (
            <div className={cn(
              "flex items-center gap-1 text-sm font-medium",
              isPositive ? 'text-green-500' : 'text-red-500'
            )}>
              {isPositive ? (
                <TrendingUp className="w-4 h-4" />
              ) : (
                <TrendingDown className="w-4 h-4" />
              )}
              <span>
                {isPositive ? '+' : ''}{marketCapChange.percentage.toFixed(2)}%
              </span>
            </div>
          )}
        </div>
        

         {/* Chart Type Tabs - only show if we have market cap data */}
         {hasMarketCapData && (
          <div className="inline-flex h-8 items-center justify-center rounded-md bg-muted p-0.5 text-muted-foreground">
            <button
              onClick={() => setActiveChartType('price')}
              className={cn(
                "inline-flex items-center justify-center whitespace-nowrap rounded-sm px-2 py-1 text-xs font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
                activeChartType === 'price' ? 'bg-primary text-foreground shadow-sm' : ''
              )}
            >
              Price
            </button>
            <button
              onClick={() => setActiveChartType('marketcap')}
              className={cn(
                "inline-flex items-center justify-center whitespace-nowrap rounded-sm px-2 py-1 text-xs font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
                activeChartType === 'marketcap' ? 'bg-primary text-foreground shadow-sm' : ''
              )}
            >
              Market Cap
            </button>
          </div>
        )}

        
      </div>

      {/* Chart */}
      <div className="bg-accent rounded-lg p-3">
        {activeChartType === 'price' && data.data_points.length > 0 ? (
          <ChartContainer config={chartConfig} className="aspect-auto h-[200px] w-full">
            <AreaChart
              accessibilityLayer
              data={data.data_points}
              margin={{
                left: 12,
                right: 12,
                top: 12,
                bottom: 12,
              }}
            >
              <defs>
                <linearGradient id={`fillPrice-${data.token_identifier}`} x1="0" y1="0" x2="0" y2="1">
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
                dataKey="timestamp"
                type="number"
                scale="time"
                domain={['dataMin', 'dataMax']}
                ticks={getEvenlySpacedTimeTicks(data.data_points, 10)}
                tickFormatter={(ts) => data.data_points.find(d => d.timestamp === ts)?.date || ''}
                interval={0}
                tickLine={false}
                tickMargin={12}
                strokeWidth={1.5}
                tick={{ fontSize: 8 }}
              />
              <YAxis
                orientation="right"
                tickLine={false}
                axisLine={false}
                tickMargin={0}
                tickCount={6}
                className="text-[10px] fill-muted-foreground hidden sm:block"
                tickFormatter={formatYAxisValue}
                domain={['auto', 'auto']}
                hide={typeof window !== 'undefined' && window.innerWidth < 640}
              />
              <ChartTooltip
                cursor={false}
                content={
                  <ChartTooltipContent
                    indicator="dot"
                    className="min-w-[200px] px-3 py-2 text-xs"
                    labelFormatter={(_, items) => {
                      const first = Array.isArray(items) && items.length > 0 ? (items[0] as any) : undefined;
                      const p = first && typeof first === 'object' ? (first.payload as PriceDataPoint | undefined) : undefined;
                      return p ? p.date : '';
                    }}
                    formatter={(value) => {
                      if (typeof value !== 'number') return value;
                      return formatValue(value, true);
                    }}
                  />
                }
              />
              <Area
                dataKey="price"
                type="linear"
                fill={`url(#fillPrice-${data.token_identifier})`}
                fillOpacity={0.4}
                stroke="var(--color-price)"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
            </AreaChart>
          </ChartContainer>
        ) : activeChartType === 'marketcap' && hasMarketCapData ? (
          <ChartContainer config={chartConfig} className="aspect-auto h-[200px] w-full">
            <AreaChart
              accessibilityLayer
              data={data.market_cap_data_points}
              margin={{
                left: 12,
                right: 12,
                top: 12,
                bottom: 12,
              }}
            >
              <defs>
                <linearGradient id={`fillMarketCap-${data.token_identifier}`} x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="5%"
                    stopColor="var(--color-marketCap)"
                    stopOpacity={0.8}
                  />
                  <stop
                    offset="95%"
                    stopColor="var(--color-marketCap)"
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
                dataKey="timestamp"
                type="number"
                scale="time"
                domain={['dataMin', 'dataMax']}
                ticks={getEvenlySpacedTimeTicks(data.market_cap_data_points!, 10)}
                tickFormatter={(ts) => data.market_cap_data_points!.find(d => d.timestamp === ts)?.date || ''}
                interval={0}
                tickLine={false}
                tickMargin={12}
                strokeWidth={1.5}
                tick={{ fontSize: 8 }}
              />
              <YAxis
                orientation="right"
                tickLine={false}
                axisLine={false}
                tickMargin={0}
                tickCount={6}
                className="text-[10px] fill-muted-foreground hidden sm:block"
                tickFormatter={formatYAxisValue}
                domain={['auto', 'auto']}
                hide={typeof window !== 'undefined' && window.innerWidth < 640}
              />
              <ChartTooltip
                cursor={false}
                content={
                  <ChartTooltipContent
                    indicator="dot"
                    className="min-w-[200px] px-3 py-2 text-xs"
                    labelFormatter={(_, items) => {
                      const first = Array.isArray(items) && items.length > 0 ? (items[0] as any) : undefined;
                      const p = first && typeof first === 'object' ? (first.payload as MarketCapDataPoint | undefined) : undefined;
                      return p ? p.date : '';
                    }}
                    formatter={(value) => {
                      if (typeof value !== 'number') return value;
                      return formatValue(value, true);
                    }}
                  />
                }
              />
              <Area
                dataKey="marketCap"
                type="linear"
                fill={`url(#fillMarketCap-${data.token_identifier})`}
                fillOpacity={0.4}
                stroke="var(--color-marketCap)"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
            </AreaChart>
          </ChartContainer>
        ) : (
          <div className="flex items-center justify-center h-[200px] text-muted-foreground text-sm">
            No {activeChartType === 'price' ? 'price' : 'market cap'} data available
          </div>
        )}
      </div>

      {/* Data Info */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <div>
          Chain: <span className="font-medium uppercase">{data.chain}</span>
        </div>
      </div>
    </div>
  );
}

