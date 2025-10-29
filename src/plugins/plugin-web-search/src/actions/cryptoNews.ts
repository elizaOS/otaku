import {
    type Action,
    type ActionResult,
    type HandlerCallback,
    type IAgentRuntime,
    type Memory,
    type State,
    logger,
} from "@elizaos/core";
import { TavilyService } from "../services/tavilyService";
import { CoinDeskService } from "../services/coindeskService";
import type { SearchResult } from "../types";

const DEFAULT_MAX_CRYPTO_NEWS_CHARS = 20000;

const CRYPTO_NEWS_SOURCES = {
    theblock: "theblock.co",
    coindesk: "coindesk.com",
    decrypt: "decrypt.co",
    dlnews: "dlnews.com",
    coinbureau: "coinbureau.com",
    cointelegraph: "cointelegraph.com",
    blockworks: "blockworks.co",
} as const;

function MaxTokens(
    data: string,
    maxTokens: number = DEFAULT_MAX_CRYPTO_NEWS_CHARS
): string {
    return data.length > maxTokens ? data.slice(0, maxTokens) : data;
}

export const cryptoNews: Action = {
    name: "CRYPTO_NEWS",
    similes: [
        "BLOCKCHAIN_NEWS",
        "DEFI_NEWS",
        "CRYPTO_UPDATES",
        "WEB3_NEWS",
        "CRYPTOCURRENCY_NEWS",
        "GET_CRYPTO_NEWS",
        "LATEST_CRYPTO",
        "CRYPTO_HEADLINES",
    ],
    suppressInitialMessage: true,
    description:
        "Search for cryptocurrency, blockchain, DeFi, and Web3 news from reputable crypto-focused sources.\n\n" +
        "**CoinDesk API** (when configured with COINDESK_API_KEY):\n" +
        "- Direct access to CoinDesk's news database (100+ articles available per query)\n" +
        "- Rich filtering: categories (markets/tech/policy/defi/nft/layer-2/regulation), keywords, authors, tags\n" +
        "- Full metadata: title, summary, optional body, publish dates, authors, thumbnails\n" +
        "- Date range filtering with automatic time_range conversion\n" +
        "- Sorted by relevance or publish date\n\n" +
        "**Tavily Fallback** (for other sources or when CoinDesk unavailable):\n" +
        "- Uses finance topic for crypto-focused results\n" +
        "- Site filtering for TheBlock, Decrypt, DL News, Coinbureau, Cointelegraph, Blockworks\n" +
        "- Up to 20 results with answer synthesis",
    
    parameters: {
        query: {
            type: "string",
            description: "The crypto/blockchain/DeFi news query (e.g., 'Aave', 'Ethereum merge', 'DeFi hacks')",
            required: true,
        },
        source: {
            type: "string",
            description: "Specific crypto news source: 'theblock', 'coindesk', 'decrypt', 'dlnews', 'coinbureau', 'cointelegraph', 'blockworks'. Leave empty to search all sources.",
            required: false,
        },
        categories: {
            type: "array",
            description: "CoinDesk categories to filter by: 'markets', 'tech', 'policy', 'defi', 'nft', 'layer-2', 'regulation'. Only applies when using CoinDesk API.",
            required: false,
        },
        time_range: {
            type: "string",
            description: "Time range filter: 'day', 'week', 'month', 'year' (or 'd', 'w', 'm', 'y'). Defaults to 'week' for recent news.",
            required: false,
        },
        max_results: {
            type: "number",
            description: "Maximum number of results (1-100 for CoinDesk API, 1-20 for Tavily). Defaults to 10.",
            required: false,
        },
        search_depth: {
            type: "string",
            description: "Search depth: 'basic' or 'advanced'. Only applies to Tavily fallback. Defaults to 'basic'.",
            required: false,
        },
        include_body: {
            type: "boolean",
            description: "Include full article body in response (CoinDesk API only). Defaults to false for performance.",
            required: false,
        },
    },
    
    validate: async (
        runtime: IAgentRuntime,
        _message: Memory,
        _state?: State
    ) => {
        try {
            // Check for either CoinDesk or Tavily service
            const coindeskService = runtime.getService<CoinDeskService>("COINDESK_NEWS");
            const tavilyService = runtime.getService<TavilyService>("TAVILY");
            return !!(coindeskService || tavilyService);
        } catch (err) {
            logger.warn("No news service available:", (err as Error).message);
            return false;
        }
    },
    
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        _state: State,
        _options?: { [key: string]: unknown },
        callback?: HandlerCallback
    ): Promise<ActionResult> => {
        try {
            const composedState = await runtime.composeState(message, ["ACTION_STATE"], true);
            const params = composedState?.data?.actionParams || composedState?.data?.cryptoNews || {};
            
            const query: string | undefined = params?.query?.trim();
            
            if (!query) {
                const errorMsg = "Missing required parameter 'query'. Please specify what crypto news to search for.";
                logger.error(`[CRYPTO_NEWS] ${errorMsg}`);
                const emptyResult: ActionResult = {
                    text: errorMsg,
                    success: false,
                    error: "missing_required_parameter",
                };
                if (callback) {
                    callback({ 
                        text: emptyResult.text, 
                        content: { error: "missing_required_parameter", details: errorMsg } 
                    });
                }
                return emptyResult;
            }

            const sourceKey = params?.source?.toLowerCase().trim();
            const timeRange = params?.time_range || "week";
            const maxResults = params?.max_results ? Math.min(Math.max(1, params.max_results), 100) : 10;
            const searchDepth = params?.search_depth === "advanced" ? "advanced" : "basic";
            const categories = params?.categories;
            const includeBody = params?.include_body === true;

            const inputParams = { 
                query,
                source: sourceKey,
                categories,
                time_range: timeRange,
                max_results: maxResults,
                search_depth: searchDepth,
                include_body: includeBody,
            };

            // Calculate date range for CoinDesk API
            let startDate: string | undefined;
            let endDate: string | undefined;
            
            if (timeRange) {
                const now = new Date();
                endDate = now.toISOString().split('T')[0];
                
                switch (timeRange) {
                    case 'day':
                    case 'd':
                        startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
                        break;
                    case 'week':
                    case 'w':
                        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
                        break;
                    case 'month':
                    case 'm':
                        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
                        break;
                    case 'year':
                    case 'y':
                        startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
                        break;
                }
            }

            // Try CoinDesk API first if available and either no source specified or source is coindesk
            const coindeskService = runtime.getService<CoinDeskService>("COINDESK_NEWS");
            if (coindeskService && coindeskService.isConfigured() && (!sourceKey || sourceKey === "coindesk")) {
                logger.info(`[CRYPTO_NEWS] Using CoinDesk API for: ${query}`);
                
                const coindeskResponse = await coindeskService.searchNews({
                    query,
                    limit: maxResults,
                    categories,
                    startDate,
                    endDate,
                    sortBy: 'published',
                    sortOrder: 'desc',
                    includeSummary: true,
                    includeBody,
                    includeThumbnail: true,
                });

                if (coindeskResponse.success && coindeskResponse.data?.articles.length) {
                    const articles = coindeskResponse.data.articles;
                    
                    let responseText = `**CoinDesk News Results** (${articles.length} articles)\n\n`;
                    
                    responseText += articles
                        .map((article, index) => {
                            const parts = [`**${index + 1}. ${article.title}**`];
                            if (article.summary) parts.push(`${article.summary}`);
                            if (article.categories?.length) parts.push(`*Categories: ${article.categories.join(", ")}*`);
                            if (article.authors?.length) parts.push(`*By: ${article.authors.join(", ")}*`);
                            if (article.publishedAt) {
                                const pubDate = new Date(article.publishedAt);
                                parts.push(`*Published: ${pubDate.toLocaleDateString()} at ${pubDate.toLocaleTimeString()}*`);
                            }
                            parts.push(`[Read full article](${article.url})`);
                            if (includeBody && article.body) {
                                parts.push(`\n${article.body.substring(0, 500)}${article.body.length > 500 ? "..." : ""}`);
                            }
                            return parts.join("\n");
                        })
                        .join("\n\n---\n\n");

                    const result: ActionResult = {
                        text: MaxTokens(responseText, DEFAULT_MAX_CRYPTO_NEWS_CHARS),
                        success: true,
                        data: { 
                            articles, 
                            source: "coindesk-api",
                            total: coindeskResponse.data.total,
                        },
                        input: inputParams,
                    } as ActionResult & { input: typeof inputParams };

                    if (callback) {
                        callback({ text: result.text, actions: ["CRYPTO_NEWS"], data: result.data });
                    }

                    return result;
                }
                
                // CoinDesk API returned no results, log and fall through to Tavily
                logger.warn(`[CRYPTO_NEWS] CoinDesk API returned no results, falling back to Tavily`);
            }

            // Fall back to Tavily with source filtering
            const tavilyService = runtime.getService<TavilyService>("TAVILY");
            if (!tavilyService) {
                throw new Error("No news service available (CoinDesk or Tavily)");
            }

            const sourceDomain = sourceKey && sourceKey in CRYPTO_NEWS_SOURCES
                ? CRYPTO_NEWS_SOURCES[sourceKey as keyof typeof CRYPTO_NEWS_SOURCES]
                : null;

            let enhancedQuery = query;
            if (sourceDomain) {
                enhancedQuery = `${query} site:${sourceDomain}`;
                logger.info(`[CRYPTO_NEWS] Using Tavily with source filter: ${sourceKey}`);
            } else {
                logger.info(`[CRYPTO_NEWS] Using Tavily for all crypto sources`);
            }

            const searchResponse = await tavilyService.search(enhancedQuery, {
                topic: "finance",
                max_results: maxResults,
                search_depth: searchDepth,
                time_range: timeRange,
                include_answer: true,
                include_images: false,
            });

            if (searchResponse && searchResponse.results.length) {
                const responseList = searchResponse.answer
                    ? `${searchResponse.answer}${
                          Array.isArray(searchResponse.results) &&
                          searchResponse.results.length > 0
                              ? `\n\nSources:\n${searchResponse.results
                                    .map(
                                        (result: SearchResult, index: number) =>
                                            `${index + 1}. [${result.title}](${result.url})`
                                    )
                                    .join("\n")}`
                              : ""
                      }`
                    : "";

                const result: ActionResult = {
                    text: MaxTokens(responseList, DEFAULT_MAX_CRYPTO_NEWS_CHARS),
                    success: true,
                    data: searchResponse,
                    input: inputParams,
                } as ActionResult & { input: typeof inputParams };

                if (callback) {
                    callback({ text: result.text, actions: ["CRYPTO_NEWS"], data: result.data });
                }

                return result;
            }

            const noResult: ActionResult = {
                text: sourceDomain 
                    ? `No crypto news found from ${sourceKey} for "${query}". Try removing source filter or adjusting time range.`
                    : `No crypto news found for "${query}". Try different keywords or broader time range.`,
                success: false,
                input: inputParams,
            } as ActionResult & { input: typeof inputParams };

            if (callback) {
                callback({ text: noResult.text });
            }
            return noResult;
        } catch (error) {
            const errMsg = error instanceof Error ? error.message : String(error);
            logger.error(`[CRYPTO_NEWS] Action failed: ${errMsg}`);
            
            const composedState = await runtime.composeState(message, ["ACTION_STATE"], true);
            const params = composedState?.data?.actionParams || composedState?.data?.cryptoNews || {};
            const failureInputParams = {
                query: params?.query,
                source: params?.source,
                categories: params?.categories,
                time_range: params?.time_range,
                max_results: params?.max_results,
                search_depth: params?.search_depth,
                include_body: params?.include_body,
            };
            
            const errorResult: ActionResult = {
                text: `Crypto news search failed: ${errMsg}`,
                success: false,
                error: errMsg,
                input: failureInputParams,
            } as ActionResult & { input: typeof failureInputParams };
            
            if (callback) {
                callback({ 
                    text: errorResult.text, 
                    content: { error: "crypto_news_failed", details: errMsg } 
                });
            }
            return errorResult;
        }
    },
    examples: [
        [
            {
                name: "{{user}}",
                content: {
                    text: "Latest Aave news",
                },
            },
            {
                name: "{{agent}}",
                content: {
                    text: "Searching crypto sources for Aave news:",
                    action: "CRYPTO_NEWS",
                },
            },
        ],
        [
            {
                name: "{{user}}",
                content: {
                    text: "What's happening with Ethereum today?",
                },
            },
            {
                name: "{{agent}}",
                content: {
                    text: "Checking latest Ethereum news:",
                    action: "CRYPTO_NEWS",
                },
            },
        ],
        [
            {
                name: "{{user}}",
                content: {
                    text: "Any DeFi news from The Block?",
                },
            },
            {
                name: "{{agent}}",
                content: {
                    text: "Searching The Block for DeFi news:",
                    action: "CRYPTO_NEWS",
                },
            },
        ],
        [
            {
                name: "{{user}}",
                content: {
                    text: "CoinDesk news on Bitcoin",
                },
            },
            {
                name: "{{agent}}",
                content: {
                    text: "Fetching Bitcoin news from CoinDesk:",
                    action: "CRYPTO_NEWS",
                },
            },
        ],
        [
            {
                name: "{{user}}",
                content: {
                    text: "Show me DeFi policy news from this month",
                },
            },
            {
                name: "{{agent}}",
                content: {
                    text: "Searching DeFi policy news:",
                    action: "CRYPTO_NEWS",
                    actionParams: {
                        query: "DeFi",
                        categories: ["policy", "defi", "regulation"],
                        time_range: "month",
                        max_results: 15
                    }
                },
            },
        ],
    ],
} as Action;

