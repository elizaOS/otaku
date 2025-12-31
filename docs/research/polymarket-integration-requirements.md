# Research Report: Polymarket Plugin for Otaku

Generated: 2025-12-29

## Executive Summary

Polymarket is a decentralized prediction market on Polygon using USDC, with $3.2B+ traded in 2024. Two existing ElizaOS plugins provide comprehensive implementations with 13-16 actions covering market data, trading, and portfolio management. For Otaku, a phased implementation starting with read-only market discovery (Essential tier) before adding trading capabilities is recommended due to regulatory considerations and safety requirements. CDP wallet integration is technically feasible via an adapter layer that bridges ethers.js v5 interfaces to CDP's viem-compatible signing.

## Research Question

What should a Polymarket plugin do for Otaku, a DeFi-focused AI agent built on ElizaOS? This includes platform overview, existing plugin analysis, recommended actions, API/SDK details, and integration considerations.

---

## 1. Polymarket Platform Overview

### What is Polymarket?

Polymarket is a decentralized prediction market platform headquartered in Manhattan, New York, launched in 2020. Users trade shares representing the probability of future events (political outcomes, economic indicators, sports, weather, awards).

**Key Statistics (2024):**
- Over $3.2 billion traded during 2024 US presidential election
- Recognized for accurate election outcome predictions
- World's largest prediction market platform

### Blockchain Infrastructure

| Attribute | Value |
|-----------|-------|
| Network | Polygon (Layer 2) |
| Chain ID | 137 |
| Trading Token | USDC (stablecoin, 1:1 USD peg) |
| Settlement | On-chain via smart contracts |
| Order Book | Hybrid-decentralized (off-chain matching, on-chain settlement) |

### How Trading Works

1. **Share Pricing**: Prices range from $0.01 to $1.00, representing probability (e.g., $0.70 = 70% chance)
2. **Outcomes**: Users buy "Yes" or "No" shares
3. **Settlement**: Winning shares pay $1.00 USDC; losing shares expire worthless
4. **Peer-to-Peer**: Trades occur directly between users, not against a house

**Source**: [CoinGecko - What is Polymarket](https://www.coingecko.com/learn/what-is-polymarket-decentralized-prediction-markets-guide), [Polymarket Documentation](https://docs.polymarket.com)

---

## 2. Existing ElizaOS Polymarket Plugins

### Plugin A: Okay-Bet/plugin-polymarket

**Repository**: https://github.com/Okay-Bet/plugin-polymarket

**Architecture:**
```
src/
  actions/           # Individual action implementations
  services/          # MarketSyncService, MarketDetailService
  providers/         # Data providers
  utils/             # CLOB client, LLM helpers
  templates.ts       # Prompt templates
  plugin.ts          # Main plugin configuration
```

**Actions Implemented (12):**

| Category | Actions |
|----------|---------|
| Trading | `PLACE_ORDER`, `SELL_ORDER`, `REDEEM_WINNINGS` |
| Market Discovery | `SEARCH_MARKETS`, `EXPLAIN_MARKET`, `GET_MARKET_PRICE`, `SHOW_FAVORITE_MARKETS` |
| Portfolio | `GET_PORTFOLIO_POSITIONS`, `GET_WALLET_BALANCE`, `APPROVE_USDC`, `SETUP_TRADING` |
| Data | Order book depth, historical pricing |

**Key Services:**
- `MarketSyncService`: Updates local market data every 24 hours
- `MarketDetailService`: Provides market analysis

**Configuration:**
```
WALLET_PRIVATE_KEY (required)
CLOB_API_URL (optional, default: https://clob.polymarket.com)
CLOB_API_KEY (optional)
```

### Plugin B: elizaos-plugins/plugin-polymarket

**Repository**: https://github.com/elizaos-plugins/plugin-polymarket

**Actions Implemented (16):**

| Category | Actions |
|----------|---------|
| Market Data | `GET_ALL_MARKETS`, `GET_SIMPLIFIED_MARKETS`, `GET_CLOB_MARKETS`, `GET_OPEN_MARKETS` |
| Analysis | `GET_MARKET_DETAILS`, `GET_PRICE_HISTORY`, `GET_ORDER_BOOK_SUMMARY`, `GET_ORDER_BOOK_DEPTH` |
| Pricing | `GET_BEST_PRICE`, `GET_MIDPOINT_PRICE`, `GET_SPREAD` |
| Trading | `PLACE_ORDER` |
| API Keys | `CREATE_API_KEY`, `REVOKE_API_KEY`, `GET_ALL_API_KEYS` |

**Dependencies:**
```json
{
  "@polymarket/clob-client": "^4.16.0",
  "ethers": "^6.13.1",
  "ws": "^8.17.0",
  "zod": "^3.25.32"
}
```

**Configuration:**
```
CLOB_API_URL (default: https://clob.polymarket.com)
CLOB_API_KEY (optional for read operations)
POLYMARKET_PRIVATE_KEY (for order placement)
CLOB_API_SECRET (for API key retrieval)
CLOB_API_PASSPHRASE (for API key retrieval)
```

### Plugin Comparison

| Feature | Okay-Bet | elizaos-plugins |
|---------|----------|-----------------|
| Actions Count | 12 | 16 |
| Market Sync | Yes (24h) | No |
| USDC Deposits | Yes | No |
| Sell Orders | Yes | No (explicit) |
| Redeem Winnings | Yes | No |
| API Key Management | No | Yes |
| Order Book Depth | Yes | Yes (bulk) |
| Price History | Yes | Yes |
| Primary SDK | CLOB Client | @polymarket/clob-client |

**Recommendation**: The elizaos-plugins version is more data-rich but Okay-Bet has better trading lifecycle support. A production plugin should combine both approaches.

---

## 3. Polymarket API & SDK Analysis

### API Endpoints

| Endpoint | Purpose |
|----------|---------|
| `https://clob.polymarket.com/` | REST API (markets, orders, prices) |
| `https://data-api.polymarket.com/` | User data, holdings, on-chain activities |
| `wss://ws-subscriptions-clob.polymarket.com/ws/` | WebSocket subscriptions |
| `wss://ws-live-data.polymarket.com` | Real-time data streaming |

### REST API Categories

**Order Book:**
- `GET /book` - Order book for specific token
- `POST /books` - Multiple order books

**Pricing:**
- `GET /price` - Market price for token
- `GET /prices` - Multiple prices
- `GET /midpoint` - Midpoint price
- `GET /prices-history` - Historical data

**Orders:**
- `POST /order` - Place order
- `GET /orders` - Get active orders
- `DELETE /order` - Cancel order

**Trades:**
- `GET /trades` - Trade history

### Authentication Levels

| Level | Requirements | Capabilities |
|-------|-------------|--------------|
| Public | None | Market data, orderbooks, prices |
| L1 | Private key (wallet signer) | Create/derive API keys |
| L2 | Signer + API credentials | Place orders, manage positions |
| Builder | Builder API credentials | Order attribution, builder trades |

### Official SDKs

1. **Python**: `py-clob-client` - Full-featured, supports all auth types
2. **Rust**: `rs-clob-client` - Strongly typed, alloy support
3. **TypeScript**: Available, used in ElizaOS plugins

### TypeScript SDK Usage (from @polymarket/clob-client)

```typescript
import { ClobClient } from '@polymarket/clob-client';

// Initialize client
const client = new ClobClient(
  'https://clob.polymarket.com',
  137, // Polygon chain ID
  wallet // ethers.Wallet instance
);

// Public methods (no auth)
const markets = await client.getMarkets();
const orderBook = await client.getOrderBook(tokenId);
const price = await client.getPrice(tokenId, 'buy');

// L2 methods (requires API creds)
await client.setApiCreds(await client.createOrDeriveApiCreds());
const order = await client.createOrder({...});
await client.postOrder(order);
```

### Order Parameters

```typescript
interface Order {
  salt: string;           // Random uniqueness value
  maker: string;          // Funder address
  signer: string;         // Signing address
  taker: string;          // Operator address
  tokenId: string;        // ERC1155 conditional token ID
  makerAmount: string;    // Max spend
  takerAmount: string;    // Min return
  expiration: number;     // Unix timestamp
  nonce: number;          // Exchange nonce
  feeRateBps: number;     // Fee rate in basis points
  side: 'buy' | 'sell';
  signatureType: number;  // Auth type
  signature: string;      // Hex-encoded
}
```

### Fee Structure

Current fee rate: **0 bps** (0%) for all volume levels.

Fee formula:
- Selling: `feeQuote = baseRate x min(price, 1-price) x size`
- Buying: `feeBase = baseRate x min(price, 1-price) x (size/price)`

**Source**: [CLOB Introduction](https://docs.polymarket.com/developers/CLOB/introduction), [Methods Overview](https://docs.polymarket.com/developers/CLOB/clients/methods-overview)

---

## 4. Recommended Actions for Otaku

### Tier 1: Essential (Market Discovery) - MVP

| Action | Description | Auth Level |
|--------|-------------|------------|
| `POLYMARKET_SEARCH_MARKETS` | Search markets by keyword, category | Public |
| `POLYMARKET_GET_MARKET` | Get specific market details by ID | Public |
| `POLYMARKET_GET_TRENDING` | Show trending/active markets | Public |
| `POLYMARKET_GET_PRICE` | Get current price for a market outcome | Public |

**Why Essential**: Zero risk, read-only, provides immediate value for users researching prediction markets without any compliance concerns.

### Tier 2: Portfolio Tracking - Phase 2

| Action | Description | Auth Level |
|--------|-------------|------------|
| `POLYMARKET_GET_POSITIONS` | View user's current positions | L2 |
| `POLYMARKET_GET_BALANCE` | Check USDC balance on Polymarket | L2 |
| `POLYMARKET_GET_TRADE_HISTORY` | Historical trades for user | L2 |
| `POLYMARKET_GET_PNL` | Profit/loss summary | L2 |

**Why Phase 2**: Requires user authentication but still read-only, low risk.

### Tier 3: Trading - Phase 3 (With Safety Controls)

| Action | Description | Auth Level |
|--------|-------------|------------|
| `POLYMARKET_BUY_SHARES` | Buy Yes/No shares | L2 |
| `POLYMARKET_SELL_SHARES` | Sell existing positions | L2 |
| `POLYMARKET_REDEEM` | Redeem winning shares for USDC | L2 |
| `POLYMARKET_SET_LIMIT_ORDER` | Place limit order | L2 |
| `POLYMARKET_CANCEL_ORDER` | Cancel pending order | L2 |

**Safety Requirements (aligned with Otaku's character):**

```typescript
// Required confirmation flow for trading actions
const TRADING_CONFIRMATION_TEMPLATE = `
**Polymarket Trade Summary:**
- Market: [market question]
- Position: [Yes/No] at $[price] ([probability]% implied)
- Amount: [shares] shares
- Cost: $[usdc_amount] USDC
- Max Loss: $[usdc_amount] (if wrong)
- Max Gain: $[potential_gain] (if correct)

WARNING: Prediction markets carry significant risk. Your position could lose 100% of its value.

Type "confirm" to proceed.
`;
```

### Action Schema Examples

**POLYMARKET_SEARCH_MARKETS:**
```typescript
parameters: {
  query: {
    type: "string",
    description: "Search term (e.g., 'bitcoin', 'election', 'sports')",
    required: true,
  },
  category: {
    type: "string",
    description: "Filter by category: politics, crypto, sports, entertainment",
    required: false,
  },
  active_only: {
    type: "boolean",
    description: "Only show markets still open for trading",
    required: false,
  },
  limit: {
    type: "number",
    description: "Max results to return (default: 10)",
    required: false,
  }
}
```

**POLYMARKET_BUY_SHARES:**
```typescript
parameters: {
  market_id: {
    type: "string",
    description: "Polymarket condition ID for the market",
    required: true,
  },
  outcome: {
    type: "string",
    description: "'yes' or 'no' - which outcome to buy",
    required: true,
  },
  amount: {
    type: "number",
    description: "USDC amount to spend",
    required: true,
  },
  limit_price: {
    type: "number",
    description: "Optional max price per share (0.01-0.99)",
    required: false,
  }
}
```

---

## 5. Integration with Otaku

### Plugin Structure

```
src/plugins/plugin-polymarket/
  package.json
  build.ts
  src/
    index.ts              # Plugin export
    types.ts              # TypeScript interfaces
    constants.ts          # API URLs, chain config
    adapters/
      cdp-signer-adapter.ts  # Bridge CDP to ethers.js interface
    services/
      polymarket.service.ts    # Core CLOB client wrapper
    providers/
      marketState.ts           # State provider for positions
    actions/
      search-markets.ts        # POLYMARKET_SEARCH_MARKETS
      get-market.ts            # POLYMARKET_GET_MARKET
      get-price.ts             # POLYMARKET_GET_PRICE
      get-trending.ts          # POLYMARKET_GET_TRENDING
      get-positions.ts         # POLYMARKET_GET_POSITIONS (Phase 2)
      buy-shares.ts            # POLYMARKET_BUY_SHARES (Phase 3)
      sell-shares.ts           # POLYMARKET_SELL_SHARES (Phase 3)
      redeem.ts                # POLYMARKET_REDEEM (Phase 3)
```

### Environment Variables

```bash
# .env additions
# Polymarket CLOB API (all users)
POLYMARKET_CLOB_URL="https://clob.polymarket.com"

# For trading (Phase 2+)
POLYMARKET_PRIVATE_KEY="0x..."  # Polygon wallet key for trading
POLYMARKET_API_KEY="..."        # L2 API key
POLYMARKET_API_SECRET="..."     # L2 API secret
POLYMARKET_API_PASSPHRASE="..." # L2 API passphrase
```

### CDP Wallet Integration

**Key Finding**: CDP wallets can be used with Polymarket via an adapter layer.

The CLOB client expects ethers.js v5 signers with `_signTypedData()`, while CDP uses viem's `signTypedData()`. The adapter pattern:

```typescript
// src/plugins/plugin-polymarket/adapters/cdp-signer-adapter.ts
class CdpSignerAdapter {
  private cdpAccount: EvmServerAccount;

  constructor(cdpAccount: EvmServerAccount) {
    this.cdpAccount = cdpAccount;
  }

  get address(): string {
    return this.cdpAccount.address;
  }

  async getAddress(): Promise<string> {
    return this.cdpAccount.address;
  }

  // Bridge ethers v5 _signTypedData to CDP signTypedData
  async _signTypedData(
    domain: TypedDataDomain,
    types: Record<string, TypedDataField[]>,
    value: Record<string, any>
  ): Promise<string> {
    const primaryType = Object.keys(types).find(t => t !== 'EIP712Domain')!;
    return this.cdpAccount.signTypedData({
      domain,
      types,
      primaryType,
      message: value,
    });
  }
}
```

**Benefits of CDP integration:**
- No private key exposure
- MPC signing in Trusted Execution Environments
- Same wallet for DeFi ops and prediction markets
- Polygon already supported in CDP

### Character Configuration Updates

Add to `src/character.ts`:

```typescript
system: `...existing...

**Polymarket Prediction Markets:**
- For market discovery queries, use POLYMARKET_SEARCH_MARKETS - read-only, safe
- For price checks, use POLYMARKET_GET_PRICE to show implied probability
- NEVER execute trades based on questions - questions = guidance only
- Trading requires explicit confirmation with risk acknowledgment
- Display probabilities as percentages (not raw prices)
- Always note that prediction market positions can lose 100% of value
- Remind users of Polymarket's US restrictions when relevant

**Polymarket Network:**
- Operates on Polygon (chain ID 137)
- All trades denominated in USDC
- Settlement is on-chain via Polymarket Exchange contract
`,

messageExamples: [
  [
    {
      name: '{{name1}}',
      content: { text: 'What are the odds of BTC hitting 100k this year?' }
    },
    {
      name: 'Otaku',
      content: {
        text: 'Let me check Polymarket for Bitcoin prediction markets... [POLYMARKET_SEARCH_MARKETS] Found 3 active markets. "BTC above $100k by Dec 31" is trading at $0.45 YES/$0.55 NO, implying a 45% probability according to traders. Want details on any specific market?'
      }
    }
  ],
  [
    {
      name: '{{name1}}',
      content: { text: 'Buy $50 of YES on the Bitcoin 100k market' }
    },
    {
      name: 'Otaku',
      content: {
        text: '**Polymarket Trade Summary:**\n- Market: Will BTC exceed $100k by Dec 31?\n- Position: YES at $0.45 (45% implied probability)\n- Amount: ~111 shares\n- Cost: $50.00 USDC\n- Max Loss: $50.00 (if BTC stays below 100k)\n- Max Gain: $61.11 (if BTC exceeds 100k)\n\nWARNING: Prediction markets carry significant risk. Your position could lose 100% of its value.\n\nType "confirm" to proceed.'
      }
    }
  ]
]
```

### Service Implementation Pattern

Following Otaku's existing CDP service pattern:

```typescript
// src/plugins/plugin-polymarket/services/polymarket.service.ts
import { Service, type ServiceType, logger } from '@elizaos/core';
import { ClobClient } from '@polymarket/clob-client';

export class PolymarketService extends Service {
  static serviceType: ServiceType = 'polymarket' as ServiceType;

  private client: ClobClient | null = null;
  private authenticatedClient: ClobClient | null = null;

  async initialize(): Promise<void> {
    const apiUrl = process.env.POLYMARKET_CLOB_URL || 'https://clob.polymarket.com';

    // Public client (no auth needed)
    this.client = new ClobClient(apiUrl, 137);

    // Authenticated client (if CDP wallet available)
    // Uses CdpSignerAdapter for signing
    logger.info('[PolymarketService] Initialized');
  }

  // Public methods
  async searchMarkets(query: string, options?: SearchOptions) {...}
  async getMarket(conditionId: string) {...}
  async getPrice(tokenId: string) {...}

  // Authenticated methods
  async getPositions() {...}
  async placeOrder(params: OrderParams) {...}
}
```

---

## 6. Legal & Compliance Considerations

### US Restrictions

- **Status**: US users are geoblocked since January 2022 settlement with CFTC ($1.4M fine)
- **VPN Usage**: Violates Terms of Service; accounts may be terminated with loss of funds
- **Recent Development**: DOJ investigation in November 2024 (FBI raid on founder)
- **Future**: Polymarket received "green light to go live in the USA" with CFTC approval (2024)

### Recommendations for Otaku

1. **Geographic Awareness**: Add IP/location check or disclaimer in system prompt
2. **Terms of Service Link**: Include in any trading action responses
3. **Risk Warnings**: Required for all trade confirmations
4. **Read-Only Default**: Start with market discovery only (Phase 1)
5. **Gradual Rollout**: Add trading only after regulatory clarity improves

```typescript
// Example disclaimer in action responses
const US_DISCLAIMER = `
Note: Polymarket is not available to US residents. Trading while circumventing geographic restrictions violates their Terms of Service and may result in account termination and loss of funds.
`;
```

**Sources**: [CoinDesk - Polymarket Probe](https://www.coindesk.com/policy/2024/11/14/polymarkets-probe-highlights-challenges-of-blocking-us-users-and-their-vpns), [Polymarket Geographic Restrictions](https://docs.polymarket.com/polymarket-learn/FAQ/geoblocking)

---

## 7. Integration with Existing Plugins

### Synergies

| Existing Plugin | Integration Opportunity |
|-----------------|------------------------|
| plugin-coingecko | Cross-reference crypto prediction market tokens with prices |
| plugin-web-search | Research context for prediction markets |
| plugin-cdp | Same wallet can hold USDC for Polymarket on Polygon |
| plugin-relay | Bridge USDC to Polygon for Polymarket deposits |

### Wallet Considerations

- Otaku uses CDP (Coinbase Developer Platform) wallets
- Polymarket requires a Polygon wallet with USDC
- **Recommended**: Use CDP wallet via adapter (Polygon already supported)
- **Alternative**: Read-only mode (no wallet needed for market data)

---

## 8. Implementation Recommendations

### Phase 1 (MVP) - 2 weeks

**Goal**: Read-only market discovery

**Actions:**
- `POLYMARKET_SEARCH_MARKETS`
- `POLYMARKET_GET_MARKET`
- `POLYMARKET_GET_PRICE`
- `POLYMARKET_GET_TRENDING`

**No wallet required. Zero compliance risk.**

### Phase 2 - 1 week

**Goal**: Portfolio viewing

**Actions:**
- `POLYMARKET_GET_POSITIONS`
- `POLYMARKET_GET_BALANCE`
- `POLYMARKET_GET_TRADE_HISTORY`

**Requires API credentials but still read-only.**

### Phase 3 - 2 weeks

**Goal**: Trading with safety controls

**Actions:**
- `POLYMARKET_BUY_SHARES`
- `POLYMARKET_SELL_SHARES`
- `POLYMARKET_REDEEM`

**Full confirmation flow matching Otaku's existing transfer safety pattern.**

### Dependencies to Add

```json
{
  "@polymarket/clob-client": "^4.16.0",
  "ethers": "^6.13.1",
  "ws": "^8.17.0"
}
```

---

## Sources

### Official Documentation
- [Polymarket Documentation](https://docs.polymarket.com)
- [CLOB API Introduction](https://docs.polymarket.com/developers/CLOB/introduction)
- [Methods Overview](https://docs.polymarket.com/developers/CLOB/clients/methods-overview)
- [Geographic Restrictions](https://docs.polymarket.com/polymarket-learn/FAQ/geoblocking)

### SDKs & Code
- [Python CLOB Client](https://github.com/Polymarket/py-clob-client)
- [Rust CLOB Client](https://github.com/Polymarket/rs-clob-client)
- [ElizaOS Plugin (elizaos-plugins)](https://github.com/elizaos-plugins/plugin-polymarket)
- [ElizaOS Plugin (Okay-Bet)](https://github.com/Okay-Bet/plugin-polymarket)

### Articles & Analysis
- [CoinGecko - What is Polymarket](https://www.coingecko.com/learn/what-is-polymarket-decentralized-prediction-markets-guide)
- [CoinDesk - Polymarket Probe](https://www.coindesk.com/policy/2024/11/14/polymarkets-probe-highlights-challenges-of-blocking-us-users-and-their-vpns)
- [Yahoo Finance - Polymarket US Relaunch](https://finance.yahoo.com/news/polymarket-back-crypto-prediction-giant-225745866.html)

---

## Open Questions

1. **CDP API Key Derivation**: Will `createOrDeriveApiKey()` work with CDP signer adapter? May need testing.

2. **USDC Bridging**: Should plugin include automatic USDC bridging from other chains to Polygon via Relay?

3. **WebSocket Support**: Is real-time price streaming via WebSocket needed, or is polling sufficient?

4. **Market Caching**: Should we implement local market caching like Okay-Bet's MarketSyncService?

5. **US Launch Timeline**: When will Polymarket's compliant US platform launch, and will API differ?

6. **MCP Integration**: Should Polymarket be exposed as an MCP server for other agents to use?

7. **Rate Limiting**: What are CDP API signing rate limits for high-frequency trading scenarios?

---

## See Also

- [Polymarket Discovery Roadmap](./polymarket-discovery-roadmap.md) - Detailed phased implementation plan for all read-only discovery actions based on https://docs.polymarket.com/llms.txt
