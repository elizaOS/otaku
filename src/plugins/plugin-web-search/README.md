# @elizaos/plugin-web-search

A plugin for powerful web search and webpage scraping capabilities, providing efficient search query handling, result processing, and direct webpage content fetching through customizable API interfaces.

## Overview

This plugin provides functionality to:

- Execute web searches with topic support: general, news, and finance (via Tavily)
- Search crypto/blockchain/DeFi news from curated reputable sources (via Tavily)
- Fetch and scrape specific webpage content (via Firecrawl)
- Filter by source, time range, and search depth
- Process and format search results
- Handle API authentication for both services
- Manage token limits and response sizes
- Optimize query performance

## Installation

```bash
pnpm install @elizaos/plugin-web-search
```

## Configuration

The plugin requires the following environment variables:

```env
TAVILY_API_KEY=your_api_key        # Required for WEB_SEARCH: API key for search service
FIRECRAWL_API_KEY=your_api_key     # Required for WEB_FETCH: API key for Firecrawl (get one at https://www.firecrawl.dev/)
COINDESK_API_KEY=your_api_key      # Optional for CRYPTO_NEWS: CoinDesk API key (get one at https://developers.coindesk.com/)
```

### Getting API Keys

**Tavily API (for WEB_SEARCH):**
1. Visit [Tavily](https://tavily.com/)
2. Sign up for an account
3. Get your API key from the dashboard

**Firecrawl API (for WEB_FETCH):**
1. Visit [Firecrawl](https://www.firecrawl.dev/)
2. Sign up for an account  
3. Get your API key from the dashboard
4. Free tier includes 500 credits/month (enough for testing)
5. Production plans available with higher limits

**CoinDesk API (optional for CRYPTO_NEWS):**
1. Visit [CoinDesk Developers](https://developers.coindesk.com/)
2. Sign up for an account
3. Get your API key from the dashboard
4. If not configured, CRYPTO_NEWS falls back to Tavily with crypto source filtering

## Usage

Import and register the plugin in your Eliza configuration.

```typescript
import { webSearchPlugin } from "@elizaos/plugin-web-search";

export default {
    plugins: [webSearchPlugin],
    // ... other configuration
};
```

**Custom Usage**
If you want custom usage, for example, a social media client to search the web before posting, you can also import the TavilyService and use it directly. Here's how you can do it:

```typescript
// Example usage in a social media client
const tavilyService = new TavilyService(runtime);
await tavilyService.initialize(runtime);
const latestNews = await tavilyService.search(
    "latest news on AI Agents",
    // searchOptions
);

const state = await this.runtime.composeState(
    {  } // memory,
    { // additional keys
        latestNews: latestNews,
    }
);

// Then modify the post template to include the {{latestNews}} and however you need
```

## Features

### Web Search

Comprehensive web search using Tavily API with support for general, news, and finance topics:

```typescript
import { webSearch } from "@elizaos/plugin-web-search";

// General web search
const result = await webSearch.handler(
    runtime,
    {
        content: { text: "What is quantum computing?" },
    },
    state,
    {},
    callback
);

// News search from specific source
const newsResult = await webSearch.handler(
    runtime,
    {
        content: { 
            text: "Get Bloomberg news on Bitcoin",
            actionParams: {
                query: "Bitcoin",
                topic: "news",
                source: "bloomberg.com",
                max_results: 10
            }
        },
    },
    state,
    {},
    callback
);

// Finance search with advanced depth
const financeResult = await webSearch.handler(
    runtime,
    {
        content: { 
            text: "DeFi TVL trends",
            actionParams: {
                query: "DeFi TVL trends",
                topic: "finance",
                search_depth: "advanced",
                time_range: "week"
            }
        },
    },
    state,
    {},
    callback
);
```

**Parameters:**
- `query` (required): The search query
- `topic` (optional): 'general', 'news', or 'finance' (default: 'general')
- `source` (optional): Specific source domain (e.g., 'bloomberg.com', 'reuters.com'). Uses `site:` operator.
- `max_results` (optional): Number of results (1-20, default: 5)
- `search_depth` (optional): 'basic' or 'advanced' (default: 'basic')
- `time_range` (optional): 'day', 'week', 'month', 'year'
- `start_date` (optional): Start date in YYYY-MM-DD format
- `end_date` (optional): End date in YYYY-MM-DD format

### Crypto News

Dedicated crypto/blockchain/DeFi news search from reputable sources:

```typescript
import { cryptoNews } from "@elizaos/plugin-web-search";

// Search all crypto sources
const result = await cryptoNews.handler(
    runtime,
    {
        content: { text: "Latest Aave news" },
    },
    state,
    {},
    callback
);

// Search specific source
const theBlockNews = await cryptoNews.handler(
    runtime,
    {
        content: { 
            text: "DeFi hacks from The Block",
            actionParams: {
                query: "DeFi security hacks",
                source: "theblock",
                time_range: "month"
            }
        },
    },
    state,
    {},
    callback
);
```

**Parameters:**
- `query` (required): The crypto/blockchain/DeFi news query
- `source` (optional): 'theblock', 'coindesk', 'decrypt', 'dlnews', 'coinbureau', 'cointelegraph', 'blockworks'
- `categories` (optional): CoinDesk categories - 'markets', 'tech', 'policy', 'defi', 'nft', 'layer-2', 'regulation' (CoinDesk API only)
- `time_range` (optional): 'day', 'week', 'month', 'year' (default: 'week')
- `max_results` (optional): 1-100 for CoinDesk API, 1-20 for Tavily (default: 10)
- `search_depth` (optional): 'basic' or 'advanced' - Tavily only (default: 'basic')
- `include_body` (optional): Include full article body - CoinDesk API only (default: false)

**Features:**
- **CoinDesk API integration** (when configured):
  - Up to 100 articles per request
  - Rich metadata: categories, tags, authors, timestamps, thumbnails
  - Optional full article body
  - Category and keyword filtering
  - Date range filtering with automatic conversion from time_range
  - Convenience methods: `getLatestHeadlines()`, `searchByCategory()`, `searchByDateRange()`
- **Tavily fallback** (when CoinDesk unavailable or for other sources):
  - Uses `topic: "finance"` for crypto-focused results
  - Site filtering for specific sources
  - Up to 20 results per request
- **Smart routing**: Uses CoinDesk API for CoinDesk queries, Tavily for others
- **Curated sources**: 7 reputable crypto news outlets
- **Optimized defaults**: 10 results, week timeframe, summaries included

### Web Fetch (Scraping)

The plugin provides webpage scraping capabilities using Firecrawl API:

```typescript
import { webFetch } from "@elizaos/plugin-web-search";

// Fetch and scrape a specific webpage
const result = await webFetch.handler(
    runtime,
    {
        content: { text: "Fetch https://example.com/article" },
    },
    state,
    {},
    callback
);
```

**Parameters:**
- `url` (required): The URL to fetch and scrape
- `formats` (optional): Array of formats to return - 'markdown', 'html', 'rawHtml', 'screenshot', 'links' (defaults to `['markdown', 'html']`)
- `onlyMainContent` (optional): Extract only main content, removing headers/footers/nav (defaults to `true`)

**Response includes:**
- Clean markdown content
- HTML content
- Page metadata (title, description, OpenGraph data)
- Extracted links
- Screenshots (if requested)

### Response Length Management

```typescript
// The plugin caps response length by characters
const DEFAULT_MAX_WEB_SEARCH_CHARS = 16000;  // For WEB_SEARCH
const DEFAULT_MAX_FETCH_CHARS = 32000;       // For WEB_FETCH

// Example of length-limited response
const response = MaxTokens(searchResult, DEFAULT_MAX_WEB_SEARCH_CHARS);
```

## Development

### Building

```bash
pnpm run build
```

### Testing

```bash
pnpm run test
```

### Development Mode

```bash
pnpm run dev
```

## Dependencies

- `@elizaos/core`: Core Eliza functionality
- `tsup`: Build tool
- Other standard dependencies listed in package.json

## API Reference

### Core Interfaces

```typescript
interface Action {
    name: "WEB_SEARCH" | "WEB_FETCH";
    similes: string[];
    description: string;
    validate: (runtime: IAgentRuntime, message: Memory) => Promise<boolean>;
    handler: (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        options: any,
        callback: HandlerCallback
    ) => Promise<void>;
    examples: Array<Array<any>>;
}

interface SearchResult {
    title: string;
    url: string;
    answer?: string;
    results?: Array<{
        title: string;
        url: string;
    }>;
}
```

### Plugin Methods

**WEB_SEARCH:**
- `webSearch.handler`: Main method for executing searches
- `TavilyService.search`: Core Tavily search function
- `MaxTokens`: Token limit management function

**CRYPTO_NEWS:**
- `cryptoNews.handler`: Main method for crypto news searches
- `CoinDeskService.searchNews`: Comprehensive CoinDesk API search with categories, tags, authors, date filters
- `CoinDeskService.getLatestHeadlines`: Quick latest headlines
- `CoinDeskService.searchByCategory`: Category-specific search (markets, tech, policy, defi, nft, layer-2, regulation)
- `CoinDeskService.searchByDateRange`: Date-filtered search
- `TavilyService.search`: Fallback for non-CoinDesk sources
- `MaxTokens`: Token limit management function

**WEB_FETCH:**
- `webFetch.handler`: Main method for fetching and scraping webpages
- `FirecrawlService.scrape`: Core scraping function
- `MaxTokens`: Token limit management function

## Common Issues/Troubleshooting

### Issue: API Authentication Failures

- **Cause**: Invalid or missing Tavily API key
- **Solution**: Verify TAVILY_API_KEY environment variable

### Issue: Token Limit Exceeded

- **Cause**: Search results exceeding maximum token limit
- **Solution**: Results are automatically truncated to fit within limits

### Issue: Search Rate Limiting

- **Cause**: Too many requests in short time
- **Solution**: Implement proper request throttling

## Security Best Practices

- Store API keys securely using environment variables
- Validate all search inputs
- Implement proper error handling
- Keep dependencies updated
- Monitor API usage and rate limits
- Use HTTPS for API communication

## Example Usage

### WEB_SEARCH Examples

```typescript
// Basic general search
const generalSearch = await webSearch.handler(
    runtime,
    {
        content: { 
            text: "Latest quantum computing developments"
        },
    },
    state
);

// News search with time filter
const recentNews = await webSearch.handler(
    runtime,
    {
        content: { 
            text: "AI news from last week",
            actionParams: { 
                query: "AI developments", 
                topic: "news",
                time_range: "week" 
            }
        },
    },
    state
);

// Finance search from specific source
const financeNews = await webSearch.handler(
    runtime,
    {
        content: { 
            text: "Bloomberg DeFi news",
            actionParams: { 
                query: "DeFi protocols", 
                topic: "finance",
                source: "bloomberg.com",
                max_results: 10
            }
        },
    },
    state
);

// Advanced depth search
const deepSearch = await webSearch.handler(
    runtime,
    {
        content: { 
            text: "Comprehensive Ethereum research",
            actionParams: { 
                query: "Ethereum scalability solutions", 
                search_depth: "advanced",
                max_results: 20
            }
        },
    },
    state
);
```

### WEB_FETCH Examples

```typescript
// Fetch a documentation page
const firecrawlService = runtime.getService("FIRECRAWL");
const docPage = await firecrawlService.scrape("https://docs.example.com/api-guide", {
    formats: ['markdown', 'html'],
    onlyMainContent: true,
});

// Fetch with all metadata and links
const fullPage = await firecrawlService.scrape("https://blog.example.com/article", {
    formats: ['markdown', 'html', 'links'],
    onlyMainContent: false,
});

// Using the action directly
const result = await webFetch.handler(
    runtime,
    {
        content: { 
            text: "Get the content from https://example.com",
            actionParams: { 
                url: "https://example.com",
                onlyMainContent: true
            }
        },
    },
    state
);
```

## Configuration Options

### Token Management

```typescript
const DEFAULT_MODEL_ENCODING = "gpt-3.5-turbo";
const DEFAULT_MAX_WEB_SEARCH_TOKENS = 4000;
```

### Actions

**WEB_SEARCH** - Comprehensive Tavily search with topic support:
- SEARCH_WEB, INTERNET_SEARCH, LOOKUP, QUERY_WEB, FIND_ONLINE
- Supports: general, news, finance topics
- Source filtering with `site:` operator
- Full control over results count and search depth

**CRYPTO_NEWS** - Crypto-focused news from reputable sources:
- BLOCKCHAIN_NEWS, DEFI_NEWS, CRYPTO_UPDATES, WEB3_NEWS
- Curated sources: TheBlock, CoinDesk, Decrypt, DL News, Coinbureau, Cointelegraph, Blockworks
- Automatically uses finance topic
- Optimized for crypto/DeFi coverage

**WEB_FETCH_OR_SCRAPE** - Firecrawl webpage scraping:
- FETCH_URL, SCRAPE_PAGE, GET_WEBPAGE, FIRECRAWL
- Returns clean markdown and HTML
- Metadata extraction and link discovery

## Contributing

Contributions are welcome! Please see the [CONTRIBUTING.md](CONTRIBUTING.md) file for more information.

## Credits

This plugin integrates with and builds upon several key technologies:

- [Tavily API](https://tavily.com/): Advanced search and content analysis API  
- [CoinDesk API](https://developers.coindesk.com/): Cryptocurrency news and data API
- [Firecrawl](https://www.firecrawl.dev/): LLM-ready web scraping API
- [Zod](https://github.com/colinhacks/zod): TypeScript-first schema validation

Special thanks to:

- The Eliza community for their contributions and feedback

For more information about the search and scraping capabilities:

- [Tavily API Documentation](https://docs.tavily.com/)
- [CoinDesk API Documentation](https://developers.coindesk.com/documentation/data-api/news_v1_article_list)
- [Firecrawl Documentation](https://docs.firecrawl.dev/)
- [Search API Best Practices](https://docs.tavily.com/docs/guides/best-practices)

## License

This plugin is part of the Eliza project. See the main project repository for license information.
