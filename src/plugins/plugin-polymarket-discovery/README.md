# Polymarket Discovery Plugin

Read-only plugin for discovering and analyzing prediction markets on Polymarket.

## Features

### Phase 1: Market Discovery (Read-Only)

- **Browse Active Markets**: View trending and popular prediction markets
- **Search Markets**: Find markets by keyword or category
- **Market Details**: Get comprehensive information about specific markets
- **Real-Time Pricing**: Check current YES/NO odds and spreads
- **Category Listing**: Browse available market categories

## Actions

### GET_ACTIVE_POLYMARKETS
Fetch trending/active prediction markets with current odds.

**Parameters:**
- `limit` (optional): Number of markets to return (default: 10, max: 50)

**Example:**
```
User: "What are the trending polymarket predictions?"
Agent: Executes GET_ACTIVE_POLYMARKETS
```

### SEARCH_POLYMARKETS
Search for markets by keyword or category.

**Parameters:**
- `query` (optional): Search keywords (e.g., "bitcoin", "election")
- `category` (optional): Market category (e.g., "crypto", "politics")
- `limit` (optional): Max results (default: 10, max: 50)

**Example:**
```
User: "Search polymarket for bitcoin predictions"
Agent: Executes SEARCH_POLYMARKETS with query="bitcoin"
```

### GET_POLYMARKET_DETAIL
Get detailed information about a specific market.

**Parameters:**
- `conditionId` (required): Market condition ID (66-char hex string)

**Example:**
```
User: "Tell me more about market 0x1234..."
Agent: Executes GET_POLYMARKET_DETAIL with conditionId
```

### GET_POLYMARKET_PRICE
Get real-time pricing for a specific market.

**Parameters:**
- `conditionId` (required): Market condition ID

**Example:**
```
User: "What are the current odds for that market?"
Agent: Executes GET_POLYMARKET_PRICE with conditionId
```

### GET_POLYMARKET_CATEGORIES
List all available market categories.

**Example:**
```
User: "What categories are available on polymarket?"
Agent: Executes GET_POLYMARKET_CATEGORIES
```

## Architecture

### Service Layer
**PolymarketService** (`services/polymarket.service.ts`)
- Handles API communication with Gamma API (market data) and CLOB API (pricing)
- In-memory caching with configurable TTL
- Retry logic with exponential backoff
- AbortController for request timeouts
- No authentication required (read-only)

### Data Sources
- **Gamma API**: Market metadata, categories, search
- **CLOB API**: Real-time orderbook and pricing data

### Caching Strategy
- Market data: 60-second TTL (configurable)
- Price data: 15-second TTL (configurable)
- In-memory Map-based cache for fast lookups

### Error Handling
- Automatic retry with exponential backoff (1s, 2s, 4s)
- Request timeout protection (10s default)
- Graceful fallbacks for missing price data
- Detailed error logging with action name prefix

## Configuration

Optional environment variables:

```env
# API Endpoints (defaults provided)
POLYMARKET_GAMMA_API_URL=https://gamma-api.polymarket.com
POLYMARKET_CLOB_API_URL=https://clob.polymarket.com

# Cache TTLs (in milliseconds)
POLYMARKET_MARKET_CACHE_TTL=60000  # 1 minute
POLYMARKET_PRICE_CACHE_TTL=15000   # 15 seconds

# Request Settings
POLYMARKET_MAX_RETRIES=3
POLYMARKET_REQUEST_TIMEOUT=10000   # 10 seconds
```

## Installation

This plugin is included in the Otaku monorepo. To use it:

1. Import in your character configuration:
```typescript
import { polymarketDiscoveryPlugin } from "./plugins/plugin-polymarket-discovery";

// Add to plugins array
plugins: [polymarketDiscoveryPlugin]
```

2. No API keys required - all endpoints are public read-only

3. Build and run:
```bash
bun run build
bun run start
```

## Implementation Details

### Type Definitions
- Complete TypeScript interfaces for all API responses
- Proper type safety with ActionResult pattern
- Input parameter capture for all actions

### Logging
All actions log with `[ACTION_NAME]` prefix for easy debugging:
- `[GET_ACTIVE_POLYMARKETS]`
- `[SEARCH_POLYMARKETS]`
- `[GET_POLYMARKET_DETAIL]`
- `[GET_POLYMARKET_PRICE]`
- `[GET_POLYMARKET_CATEGORIES]`

### Performance
- Parallel API calls where possible (market + prices)
- Efficient caching reduces API calls
- Timeout protection prevents hanging requests
- Minimal dependencies (only @elizaos/core)

## Future Enhancements (Phase 2+)

Phase 1 is read-only discovery. Future phases could add:
- Trading capabilities (buy/sell positions)
- Portfolio tracking
- Real-time price alerts
- Historical data analysis
- Market recommendations

## Development

Build the plugin:
```bash
cd src/plugins/plugin-polymarket-discovery
bun run build
```

Type check:
```bash
bun run typecheck
```

## Code Structure

```
plugin-polymarket-discovery/
├── src/
│   ├── actions/              # 5 action implementations
│   │   ├── getActiveMarkets.action.ts
│   │   ├── searchMarkets.action.ts
│   │   ├── getMarketDetail.action.ts
│   │   ├── getMarketPrice.action.ts
│   │   └── getMarketCategories.action.ts
│   ├── services/
│   │   └── polymarket.service.ts
│   ├── types.ts              # TypeScript type definitions
│   └── index.ts              # Plugin export
├── package.json
├── tsconfig.json
├── tsconfig.build.json
├── build.ts
└── README.md
```

## Dependencies

- `@elizaos/core`: ElizaOS framework (peer dependency)
- No external API libraries required - uses native fetch

## License

MIT
