# Polymarket Discovery Plugin Roadmap

Generated: 2025-12-29
Based on: https://docs.polymarket.com/llms.txt

## Current Status

### Phase 1: Market Discovery ✅ COMPLETE
**PR**: #109 (merged)
**Status**: Production

| Action | Description | API Endpoint |
|--------|-------------|--------------|
| `GET_ACTIVE_POLYMARKETS` | Browse trending/active markets | `/markets` (Gamma) |
| `SEARCH_POLYMARKETS` | Search by keyword/category | `/markets` (Gamma) |
| `GET_POLYMARKET_DETAIL` | Detailed market information | `/markets` (Gamma) |
| `GET_POLYMARKET_PRICE` | Real-time YES/NO prices | `/price` (CLOB) |
| `GET_POLYMARKET_CATEGORIES` | List available categories | `/markets` (Gamma) |
| `GET_POLYMARKET_PRICE_HISTORY` | Historical price charts | `/prices-history` (CLOB) |

### Phase 2: Portfolio Tracking ✅ COMPLETE
**PR**: #110 (current)
**Status**: Under review

| Action | Description | API Endpoint |
|--------|-------------|--------------|
| `GET_POLYMARKET_POSITIONS` | View user positions | `/core/current-positions` (Data API) |
| `GET_POLYMARKET_BALANCE` | Check portfolio value & P&L | `/core/total-value-positions` (Data API) |
| `GET_POLYMARKET_TRADE_HISTORY` | View trade history | `/core/trades` (Data API) |

**Features**:
- Dual address support (EOA + proxy)
- Automatic proxy wallet derivation
- LRU caching (60s positions, 30s trades)
- Address validation via viem

---

## Phase 3: Market Intelligence & Orderbooks

**Goal**: Add orderbook depth and market-wide analytics for better trading insights.

### 3A: Orderbook Actions (Priority: HIGH)

| Action | Description | API Endpoint | Use Case |
|--------|-------------|--------------|----------|
| `GET_POLYMARKET_ORDERBOOK` | Single token orderbook summary | `GET /book` | View bid/ask depth, best prices |
| `GET_POLYMARKET_ORDERBOOKS` | Multiple token orderbooks | `POST /books` | Compare liquidity across markets |

**Implementation Details**:
- **Endpoint**: `GET /book?token_id={token_id}&side={BUY|SELL}`
- **Response**: Bids, asks, market, asset_id, hash, timestamp
- **Caching**: 10-15s TTL (orderbooks change frequently)
- **Batch endpoint**: `POST /books` with `{token_ids: string[]}`

**Example Parameters**:
```typescript
interface GetOrderbookParams {
  token_id: string;        // ERC1155 conditional token ID
  side?: "BUY" | "SELL";  // Optional: filter to one side
}

interface GetOrderbooksParams {
  token_ids: string[];     // Array of token IDs (max 100)
}
```

**Action Schema**:
```typescript
parameters: {
  token_id: {
    type: "string",
    description: "ERC1155 conditional token ID for YES or NO outcome",
    required: true
  },
  side: {
    type: "string",
    description: "Filter to BUY or SELL side (optional)",
    required: false,
    enum: ["BUY", "SELL"]
  }
}
```

### 3B: Market Analytics (Priority: MEDIUM)

| Action | Description | API Endpoint | Use Case |
|--------|-------------|--------------|----------|
| `GET_POLYMARKET_OPEN_INTEREST` | Market-wide exposure metrics | `GET /misc/open-interest` | See total $ locked in markets |
| `GET_POLYMARKET_LIVE_VOLUME` | Real-time trading volume | `GET /misc/live-volume` | Track market activity |
| `GET_POLYMARKET_SPREADS` | Bid-ask spread analysis | `GET /spreads` | Assess liquidity quality |

**Implementation Details**:
- **Open Interest**: Total value of all outstanding positions
- **Live Volume**: 24h rolling volume by market
- **Spreads**: (ask - bid) / midpoint for each market
- **Caching**: 30s TTL (analytics change less frequently)

**Use Cases**:
- "What's the total money in Polymarket right now?" → Open interest
- "Which markets are most actively traded today?" → Live volume
- "Where can I get the best execution?" → Spreads analysis

---

## Phase 4: Events & Discovery Enhancements

**Goal**: Better navigation and categorization beyond individual markets.

### 4A: Events API (Priority: MEDIUM)

| Action | Description | API Endpoint | Use Case |
|--------|-------------|--------------|----------|
| `GET_POLYMARKET_EVENTS` | Browse prediction events | `GET /events` | Find event-based markets |
| `GET_POLYMARKET_EVENT_DETAIL` | Event-specific data | `GET /events/{id}` | View all markets for an event |

**Implementation Details**:
- **Events**: Higher-level groupings (e.g., "2024 US Election" contains multiple markets)
- **Filtering**: By active status, date range, tags
- **Response**: Event metadata + array of associated markets
- **Caching**: 60s TTL (event data stable)

**Example**:
- User: "What markets are available for the election?"
- Action: `GET_POLYMARKET_EVENTS` with tag filter "politics"
- Response: List of election-related events, each with multiple markets

### 4B: Global Search (Priority: LOW)

| Action | Description | API Endpoint | Use Case |
|--------|-------------|--------------|----------|
| `GET_POLYMARKET_GLOBAL_SEARCH` | Multi-dimensional search | `GET /search` | Search markets, events, profiles |

**Implementation Details**:
- **Search Scope**: Markets, events, user profiles
- **Query Types**: Keyword, category, date range
- **Response**: Unified results with type discriminators
- **Caching**: No cache (search queries too diverse)

---

## Phase 5: Portfolio Enhancements

**Goal**: Complete portfolio tracking with historical and on-chain data.

### 5A: Extended Portfolio (Priority: MEDIUM)

| Action | Description | API Endpoint | Use Case |
|--------|-------------|--------------|----------|
| `GET_POLYMARKET_CLOSED_POSITIONS` | Historical resolved positions | `GET /core/closed-positions` | View past trades & outcomes |
| `GET_POLYMARKET_USER_ACTIVITY` | On-chain activity log | `GET /core/user-activity` | Audit trail of all actions |
| `GET_POLYMARKET_TOP_HOLDERS` | Major participants in market | `GET /core/top-holders` | See whale positions |

**Implementation Details**:
- **Closed Positions**: Includes win/loss, settlement price, payout
- **User Activity**: Deposits, withdrawals, trades, redemptions
- **Top Holders**: Anonymized or public based on user settings
- **Caching**: 60s TTL (historical data stable)

---

## Phase 6: Leaderboards & Social

**Goal**: Community insights and trader rankings.

### 6A: Leaderboards (Priority: LOW)

| Action | Description | API Endpoint | Use Case |
|--------|-------------|--------------|----------|
| `GET_POLYMARKET_TRADER_LEADERBOARD` | Top traders by P&L | `GET /core/trader-leaderboard` | Find successful traders |
| `GET_POLYMARKET_VOLUME_TRENDS` | Volume timeseries | `GET /builders/daily-volume-timeseries` | Track platform growth |

**Implementation Details**:
- **Leaderboard Filters**: Time period (24h, 7d, 30d, all-time), category
- **Metrics**: P&L, volume, win rate, number of trades
- **Volume Trends**: Daily aggregated volume across all markets
- **Caching**: 5min TTL (leaderboards change slowly)

**Use Cases**:
- "Who are the top traders this week?" → Leaderboard
- "Is Polymarket volume growing?" → Volume trends

---

## Implementation Priority Matrix

### High Priority (Phase 3A) - Immediate Value
- ✅ Orderbook actions - Essential for understanding market depth before Phase 7 trading
- **Effort**: 1-2 days
- **Dependencies**: None (CLOB API already integrated)

### Medium Priority (Phases 3B, 4A, 5A) - Enhanced Discovery
- ✅ Market analytics - Better insights into liquidity and activity
- ✅ Events API - Improved navigation and categorization
- ✅ Extended portfolio - Complete historical view
- **Effort**: 3-5 days total
- **Dependencies**: Requires Data API integration (already done in Phase 2)

### Low Priority (Phases 4B, 6A) - Nice-to-Have
- ✅ Global search - Redundant with existing search (Phase 1)
- ✅ Leaderboards - More social than functional
- **Effort**: 2-3 days
- **Dependencies**: None

---

## API Coverage Summary

### Gamma API (Metadata)
- ✅ Markets listing & search
- ✅ Categories
- ⏳ Events (Phase 4A)
- ⏳ Event tags (Phase 4A)

### CLOB API (Trading Data)
- ✅ Prices (current)
- ✅ Price history
- ⏳ Orderbooks (Phase 3A) ← **Next priority**
- ⏳ Spreads (Phase 3B)

### Data API (User Data)
- ✅ Current positions
- ✅ Total value
- ✅ Trade history
- ⏳ Closed positions (Phase 5A)
- ⏳ User activity (Phase 5A)
- ⏳ Top holders (Phase 5A)

### Misc API (Analytics)
- ⏳ Open interest (Phase 3B)
- ⏳ Live volume (Phase 3B)
- ⏳ Leaderboards (Phase 6A)
- ⏳ Volume trends (Phase 6A)

---

## Recommended Next Steps

### Immediate (Current PR)
1. ✅ Merge Phase 2 PR #110 (portfolio tracking)
2. ✅ Address any review feedback
3. ✅ Verify build passes

### Short-term (Next PR - Phase 3A)
1. **Add orderbook actions** (highest value for discovery)
   - `GET_POLYMARKET_ORDERBOOK` - Single market depth
   - `GET_POLYMARKET_ORDERBOOKS` - Batch orderbook query
2. **Estimated effort**: 1-2 days
3. **Dependencies**: None (CLOB API already integrated)

### Medium-term (Phases 3B-5A)
1. Add market analytics (open interest, volume, spreads)
2. Add events API for better categorization
3. Complete portfolio tracking with closed positions

### Long-term (Phase 6+)
1. Consider leaderboards if user demand exists
2. Defer global search (existing search sufficient)

---

## Technical Considerations

### API Rate Limits (per 10 seconds)
- Gamma general: 4000 requests
- Gamma markets: 300 requests
- **CLOB book**: 1500 requests ← Relevant for orderbooks
- CLOB prices: 500 requests
- Data API: (not documented, assume similar)

### Caching Strategy by Data Type
| Data Type | TTL | Rationale |
|-----------|-----|-----------|
| Markets metadata | 60s | Changes infrequently |
| Prices | 15s | Changes frequently |
| **Orderbooks** | **10-15s** | **High volatility** |
| Price history | 5min | Historical data stable |
| User positions | 60s | User-specific, moderate updates |
| Closed positions | 5min | Historical, immutable |
| Analytics | 30s | Aggregated, slower to change |
| Leaderboards | 5min | Updates slowly |

### Service Architecture

```typescript
// Existing: PolymarketService
class PolymarketService extends Service {
  // Phase 1: Discovery
  async getActiveMarkets() {...}
  async searchMarkets() {...}
  async getMarketDetail() {...}
  async getMarketPrice() {...}
  async getMarketCategories() {...}
  async getMarketPriceHistory() {...}

  // Phase 2: Portfolio
  async getUserPositions(address) {...}
  async getUserBalance(address) {...}
  async getUserTrades(address) {...}

  // Phase 3A: Orderbooks (NEW)
  async getOrderbook(tokenId, side?) {...}
  async getOrderbooks(tokenIds) {...}

  // Phase 3B: Market Analytics (NEW)
  async getOpenInterest() {...}
  async getLiveVolume() {...}
  async getSpreads() {...}

  // Phase 4A: Events (NEW)
  async getEvents(filters?) {...}
  async getEventDetail(eventId) {...}

  // Phase 5A: Extended Portfolio (NEW)
  async getClosedPositions(address) {...}
  async getUserActivity(address) {...}
  async getTopHolders(marketId) {...}

  // Phase 6A: Leaderboards (NEW)
  async getTraderLeaderboard(category?, period?) {...}
  async getVolumeTrends(days?) {...}
}
```

---

## Success Metrics

### Phase 3A (Orderbooks)
- Users can view bid/ask depth before trading
- Reduced user confusion about "best price"
- Foundation for Phase 7 trading implementation

### Phases 3B-6A (Analytics & Social)
- Increased user engagement with market discovery
- Better understanding of market quality (spreads, liquidity)
- Historical context for trading decisions

---

## Related Documentation

- [Polymarket Integration Requirements](./polymarket-integration-requirements.md) - Original research
- [CDP Wallet Compatibility](./polymarket-cdp-wallet-compatibility.md) - Phase 7 trading prep
- [Phase 1 Handoff](../../thoughts/shared/handoffs/polymarket-phase1/2025-12-29_17-28-06_polymarket-discovery-plugin.md)
- [Polymarket API Docs](https://docs.polymarket.com)
- [Polymarket LLM Guide](https://docs.polymarket.com/llms.txt)

---

## Open Questions

1. **Orderbook granularity**: Should we return full orderbook or just best 5 levels? (Suggest: configurable depth)
2. **Events vs Markets**: Is events API redundant with market categories? (Need user testing)
3. **Leaderboard privacy**: Should we filter anonymized addresses? (Check API response format)
4. **Volume trends**: What time granularity? Daily, hourly? (Suggest: daily for consistency)
5. **MCP integration**: Should any of these become MCP tools for other agents? (Defer to Phase 7+)
