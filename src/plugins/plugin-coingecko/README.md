# CoinGecko Plugin

CoinGecko plugin providing token metadata lookup and trending tokens functionality.

## Features

- **Token Metadata**: Fetch detailed information about any token using CoinGecko's API
- **Trending Tokens**: Get trending tokens/pools from GeckoTerminal API across multiple networks

## Configuration

Set your CoinGecko Pro API key in the environment or runtime settings:

```bash
COINGECKO_API_KEY=your-api-key-here
```

When the API key is set, the plugin uses Pro endpoints for higher rate limits and better performance.

## Actions

### GET_TOKEN_METADATA

Fetch metadata for one or more tokens by symbol, name, CoinGecko ID, or contract address.

**Parameters:**
- `tokens` (required): Comma-separated list of token identifiers

**Example:**
```
Get metadata for bitcoin and ethereum
Show me info about BTC, ETH
What is token 0x2081...946ee?
```

### GET_TRENDING_TOKENS

Get trending tokens/pools from GeckoTerminal API for a specific blockchain network.

**Parameters:**
- `network` (optional, default: "base"): Blockchain network using GeckoTerminal's network identifiers
- `limit` (optional, default: 10): Number of trending tokens to return (1-30)

**Example:**
```
What are the trending tokens on Base?
Show me the top 5 trending tokens on eth
Get trending tokens on polygon_pos
```

**Supported Networks:**

| Chain        | GeckoTerminal Parameter |
| ------------ | ----------------------- |
| **base**     | `base`                  |
| **ethereum** | `eth`                   |
| **polygon**  | `polygon_pos`           |
| **arbitrum** | `arbitrum`              |
| **optimism** | `optimism`              |
| **scroll**   | `scroll`                |

And many more networks supported by GeckoTerminal...

## API Details

### Token Metadata
Uses CoinGecko v3 API:
- Public: `https://api.coingecko.com/api/v3`
- Pro: `https://pro-api.coingecko.com/api/v3` (when API key is set)

### Trending Tokens
Uses GeckoTerminal v2 API (public only):
- Public: `https://api.geckoterminal.com/api/v2`

**Note:** GeckoTerminal does not have a Pro tier. The public API is used regardless of whether you have a CoinGecko Pro API key.

## Response Format

### Trending Tokens Response

Returns an array of trending tokens with combined pool and token metadata:

```typescript
[
  {
    id: string;                           // Token ID (e.g., "base_0x...")
    name: string | null;                  // Token name
    symbol: string | null;                // Token symbol
    image: string | null;                 // Token image URL
    price_usd: number | null;             // Current price in USD
    market_cap_usd: number | null;        // Market cap in USD
    volume_24h_usd: number | null;        // 24h trading volume in USD
    price_change_percentage_24h: number | null;  // 24h price change %
    network: string;                      // Blockchain network
    address: string | null;               // Token contract address
    rank: number;                         // Trending rank (1-based)
    liquidity_usd: number | null;         // Pool liquidity in USD
    fdv_usd: number | null;               // Fully diluted valuation in USD
    price_change_percentage_1h: number | null;   // 1h price change %
    price_change_percentage_7d: null;     // Not available
    price_change_percentage_30d: null;    // Not available
    holders_count: null;                  // Not available
    created_at: null;                     // Not available
    pool_created_at: string | null;       // Pool creation timestamp
    trending_score: null;                 // Not provided by API
  }
]
```

### Example Response

```json
[
  {
    "id": "base_0x1bc0c42215582d5a085795f4badbac3ff36d1bcb",
    "name": "tokenbot",
    "symbol": "CLANKER",
    "image": "https://coin-images.coingecko.com/coins/images/51440/large/CLANKER.png?1731232869",
    "price_usd": 117.398940020655,
    "market_cap_usd": 115947288.284089,
    "volume_24h_usd": 15740640.51743,
    "price_change_percentage_24h": 3.438,
    "network": "base",
    "address": "0x1bc0c42215582d5a085795f4badbac3ff36d1bcb",
    "rank": 1,
    "liquidity_usd": 9208488.215,
    "fdv_usd": 115947288.284089,
    "price_change_percentage_1h": 22.401,
    "price_change_percentage_7d": null,
    "price_change_percentage_30d": null,
    "holders_count": null,
    "created_at": null,
    "pool_created_at": "2024-11-08T20:43:33.000Z",
    "trending_score": null
  }
]
```

## Notes

- The trending tokens API includes comprehensive pool and token metadata in a single call
- No additional API calls are needed to fetch token metadata for trending tokens
- Some newer tokens may not have a `coingecko_coin_id` yet
- GeckoTerminal uses specific network identifiers (e.g., `eth` instead of `ethereum`, `polygon_pos` instead of `polygon`)
- If you get an error, check the supported networks table and use the correct GeckoTerminal parameter

