import { XAxis, YAxis, CartesianGrid, Area, AreaChart } from 'recharts';
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '../ui/chart';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PriceDataPoint {
  timestamp: number;
  price: number;
  date: string;
}

interface PriceChartData {
  token_identifier: string;
  token_symbol: string | null;
  chain: string;
  timeframe: string;
  current_price: number | null;
  data_points: PriceDataPoint[];
  data_points_count: number;
  price_change?: {
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
} satisfies ChartConfig;

export function ChatPriceChart({ data }: ChatPriceChartProps) {
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

  const getEvenlySpacedTimeTicks = (dataPoints: PriceDataPoint[], count: number): number[] => {
    if (dataPoints.length === 0) return [];
    const min = dataPoints[0].timestamp;
    const max = dataPoints[dataPoints.length - 1].timestamp;
    if (count <= 1 || min === max) return [min];
    const step = (max - min) / (count - 1);
    return Array.from({ length: count }, (_, i) => Math.round(min + i * step));
  };

  const priceChange = data.price_change;
  const isPositive = priceChange ? priceChange.value >= 0 : false;

  return (
    <div className="space-y-3 w-full">
      {/* Header with token info and price change */}
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-semibold">
            {data.token_symbol || data.token_identifier}
          </h4>
          <p className="text-xs text-muted-foreground">
            {data.timeframe.toUpperCase()} Chart
          </p>
        </div>
        {priceChange && priceChange.percentage !== null && priceChange.percentage !== undefined && (
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
      </div>

      {/* Current Price */}
      {data.current_price && (
        <div className="text-2xl font-bold">
          ${formatPrice(data.current_price)}
        </div>
      )}

      {/* Chart */}
      <div className="bg-accent rounded-lg p-3">
        {data.data_points.length > 0 ? (
          <ChartContainer config={chartConfig} className="aspect-auto h-[200px] w-full">
            <AreaChart
              accessibilityLayer
              data={data.data_points}
              margin={{
                left: -12,
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
                tick={{ fontSize: 10 }}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tickMargin={0}
                tickCount={6}
                className="text-xs fill-muted-foreground"
                tickFormatter={formatYAxisValue}
                domain={[0, "dataMax"]}
              />
              <ChartTooltip
                cursor={false}
                content={
                  <ChartTooltipContent
                    indicator="dot"
                    className="min-w-[200px] px-4 py-3"
                    labelFormatter={(_, items) => {
                      const first = Array.isArray(items) && items.length > 0 ? (items[0] as any) : undefined;
                      const p = first && typeof first === 'object' ? (first.payload as PriceDataPoint | undefined) : undefined;
                      return p ? p.date : '';
                    }}
                    formatter={(value) => `$${typeof value === 'number' ? formatPrice(value) : value}`}
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
        ) : (
          <div className="flex items-center justify-center h-[200px] text-muted-foreground text-sm">
            No price data available
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

