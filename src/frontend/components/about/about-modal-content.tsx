import { Badge } from '@/frontend/components/ui/badge';
import { Bullet } from '@/frontend/components/ui/bullet';
import { Button } from '@/frontend/components/ui/button';
import { Sparkles, X } from 'lucide-react';

interface AboutModalContentProps {
  onClose: () => void;
}

interface CapabilityItem {
  title: string;
  description: string;
  emphasis?: string;
}

interface PluginItem {
  name: string;
  category: string;
  summary: string;
  points: string[];
  example: string;
}

const capabilityItems: CapabilityItem[] = [
  {
    title: 'Token Analysis & Comparisons',
    description:
      'Stack assets side-by-side, inspect liquidity depth, and surface anomalies before they move the market.',
  },
  {
    title: 'Yield Strategy Discovery',
    description:
      'Scan yield farms, lending desks, and structured products to spot the strongest risk-adjusted returns.',
  },
  {
    title: 'Cross-Chain Execution',
    description:
      'Bridge, swap, and route liquidity across networks without leaving the conversation.',
  },
  {
    title: 'Wallet Operations',
    description:
      'Manage balances, send tokens, and automate approvals through a secure non-custodial wallet.',
  },
  {
    title: 'Portfolio Risk Monitoring',
    description:
      'Stress-test exposures, track drawdowns, and receive proactive warnings on concentration or volatility shifts.',
  },
  {
    title: 'Market Intelligence',
    description:
      'Digest macro narratives, protocol updates, and on-chain flows into actionable summaries.',
  },
  {
    title: 'DeFi Education',
    description:
      'Translate complex mechanisms—perps, restaking, vaults—into clear playbooks tailored to your experience level.',
  },
];

const pluginItems: PluginItem[] = [
  {
    name: 'CoinGecko',
    category: 'Market Data',
    summary: 'Live token prices, market caps, volume trends, and relative strength comparisons.',
    points: [
      'Call up intraday performance and liquidity snapshots on demand.',
      'Benchmark tokens to uncover outperformers or laggards in seconds.',
    ],
    example: '“What’s the 24h volume for AAVE and LINK?”',
  },
  {
    name: 'DeFiLlama',
    category: 'Analytics',
    summary: 'Total value locked, ecosystem growth, and category-level flows across chains.',
    points: [
      'Identify which sectors are expanding fastest by TVL shift.',
      'Spot emerging protocols before capital concentration peaks.',
    ],
    example: '"Show me the top 5 lending protocols by TVL this week."',
  },
  {
    name: 'Powered by ElizaOS',
    category: 'AI Engine',
    summary: 'Advanced language understanding, strategy synthesis, and scenario planning.',
    points: [
      'Break down complex DeFi concepts into executable steps.',
      'Draft hedging or farming strategies tailored to your wallet profile.',
    ],
    example: '"Explain the risks of staking ETH on Lido vs. RocketPool."',
  },
  {
    name: 'Coinbase CDP',
    category: 'Execution',
    summary: 'Secure non-custodial smart wallets, balance checks, and seamless transaction signing.',
    points: [
      'Spin up smart wallets linked to your session for trustless execution.',
      'Sign and broadcast transfers without leaving chat.',
    ],
    example: '"Send 0.1 ETH to my friend on Base."',
  },
  {
    name: 'Morpho',
    category: 'Yield Markets',
    summary: 'Access Morpho Blue lending and borrowing with real-time rate intelligence.',
    points: [
      'Compare supply and borrow APRs across markets before entering.',
      'Manage open positions and rebalance collateral in-line.',
    ],
    example: '“Compare ETH lending yields on Morpho and Aave.”',
  },
  {
    name: 'Clanker',
    category: 'Launchpad',
    summary: 'Deploy ERC-20 tokens, configure liquidity pools, and manage launches end-to-end.',
    points: [
      'Spin up memecoins or utility tokens with sensible defaults.',
      'Seed liquidity pools and monitor launch health in real time.',
    ],
    example: '"Deploy a new token on Base with 1 ETH of liquidity."',
  },
  {
    name: 'Web Search',
    category: 'News',
    summary: 'Latest news, governance proposals, and on-chain narratives pulled from trusted sources.',
    points: [
      'Stay ahead of catalysts with real-time sentiment scans.',
      'Cross-check on-chain moves against breaking headlines.',
    ],
    example: '"What is the latest on EigenLayer restaking yields?"',
  },
  {
    name: 'SQL',
    category: 'Database',
    summary: "Query Otaku's structured DeFi dataset for trades, logs, and historical insights.",
    points: [
      'Pull portfolio summaries or transaction histories instantly.',
      'Validate trade ideas with custom metrics or cohort analysis.',
    ],
    example: '"Summarize my recent swaps and profits."',
  },
  {
    name: 'Bootstrap',
    category: 'Memory',
    summary: 'Persistent reasoning, memory recall, and adaptive response logic across sessions.',
    points: [
      'Otaku remembers preferences, risk tolerances, and previous moves.',
      'Plans multi-step workflows without losing context mid-task.',
    ],
    example: 'Otaku adjusts recommendations based on your past trades and risk appetite.',
  },
];

export function AboutModalContent({ onClose }: AboutModalContentProps) {
  return (
    <div className="flex flex-col h-full w-full">
      <div className="flex justify-end w-full">
        <Button
            variant="ghost"
            size="icon-sm"
            className="z-30 text-muted-foreground hover:text-foreground"
            onClick={onClose}
            aria-label="Close about modal"
          >
            <X className="size-4" />
          </Button>
        </div>
      <div className="relative flex flex-col text-foreground max-h-[60vh] overflow-x-hidden overflow-y-auto sm:h-[80vh] sm:max-h-[700px] sm:overflow-visible my-4">
        {/* Fixed Header */}
        <header className="flex shrink-0 flex-col gap-6 border-b border-border/60 pb-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-4">
            <div className="flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              <Bullet className="size-2.5" />
              About Otaku
            </div>
            <div className="space-y-3">
              <h2 className="text-3xl font-display leading-none sm:text-4xl">
                DeFi intelligence, on demand.
              </h2>
              <p className="max-w-2xl text-sm text-muted-foreground sm:text-base">
                Otaku is your autonomous DeFi trading and intelligence agent. She connects deep on-chain
                data with secure execution tools so you can research, plan, and act inside a single conversation.
              </p>
              <div className="flex flex-wrap items-center gap-2 text-xs uppercase text-muted-foreground/80">
                <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background px-3 py-1 font-medium tracking-wider">
                  <Sparkles className="size-3" />
                  Autonomous Agent
                </span>
                <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background px-3 py-1 font-medium tracking-wider">
                  Full-Stack DeFi Ops
                </span>
                <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background px-3 py-1 font-medium tracking-wider">
                  Natural Language Control
                </span>
              </div>
            </div>
              {/* ElizaOS Attribution Badge */}
            <div className="flex justify-start">
              <img 
                src="/assets/elizaos_badge.svg" 
                alt="Powered by ElizaOS" 
                className="h-16"
              />
            </div>
          </div>
        
        </header>

        {/* Scrollable Content Area (desktop only). On mobile, the whole modal scrolls */}
        <div className="flex-1 space-y-8 py-6 sm:overflow-y-auto">

        <section className="space-y-4">
        
          <div className="flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.25em] text-muted-foreground">
            <Bullet className="size-2.5" />
            Capabilities
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {capabilityItems.map((item) => (
              <div
                key={item.title}
                className="group rounded-lg border border-border/60 bg-background/80 p-4 transition-colors hover:bg-accent/30"
              >
                <div className="flex items-start gap-3">
                  <Bullet className="mt-1 size-2.5 shrink-0" />
                  <div className="space-y-1">
                    <h3 className="font-semibold uppercase tracking-wide text-xs text-muted-foreground">
                      {item.title}
                    </h3>
                    <p className="text-sm text-foreground/90">
                      {item.description}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-4">
          <div className="flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.25em] text-muted-foreground">
            <Bullet className="size-2.5" />
            Core Plugins
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {pluginItems.map((plugin) => (
              <div
                key={plugin.name}
                className="flex h-full flex-col rounded-lg border border-border/60 bg-background/60 p-4"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                    <Bullet className="size-2.5" />
                    {plugin.category}
                  </div>
                  <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/80">
                    {plugin.name}
                  </span>
                </div>
                <p className="mt-3 text-sm text-muted-foreground">{plugin.summary}</p>
                <ul className="mt-3 space-y-2 text-sm text-foreground/90">
                  {plugin.points.map((point) => (
                    <li key={point} className="flex gap-2">
                      <span className="mt-1 inline-block size-1.5 rounded-full bg-primary/80" />
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-4 text-xs font-mono uppercase tracking-widest text-muted-foreground">
                  Example: <span className="text-muted-foreground">{plugin.example}</span>
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-4">
          <div className="flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.25em] text-muted-foreground">
            <Bullet className="size-2.5" />
            Pro Tip
          </div>
          <div className="rounded-lg border border-border/60 bg-background/80 p-4">
            <p className="text-sm text-foreground/90">
              Ask Otaku to build multi-step playbooks—she remembers previous trades, adapts to your risk
              settings, and can execute when you are ready.
            </p>
          </div>
        </section>
        </div>
      </div>
    </div>
    
  );
}

