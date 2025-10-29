import {
    type IAgentRuntime,
    Service,
    logger,
} from "@elizaos/core";

export interface CoinDeskArticle {
    id: string;
    title: string;
    url: string;
    summary?: string;
    body?: string;
    publishedAt?: string;
    updatedAt?: string;
    authors?: string[];
    categories?: string[];
    tags?: string[];
    thumbnail?: string;
    source?: string;
}

export interface CoinDeskNewsResponse {
    success: boolean;
    data?: {
        articles: CoinDeskArticle[];
        total?: number;
        page?: number;
        pageSize?: number;
    };
    error?: string;
}

export interface CoinDeskSearchOptions {
    // Search and filtering
    query?: string;                    // Search query for article content
    keywords?: string[];               // Specific keywords to filter by
    
    // Pagination
    limit?: number;                    // Number of results (1-100)
    offset?: number;                   // Pagination offset
    page?: number;                     // Page number
    
    // Categorization
    categories?: string[];             // Filter by categories (e.g., 'markets', 'tech', 'policy', 'defi')
    tags?: string[];                   // Filter by tags
    authors?: string[];                // Filter by author names
    
    // Date filtering
    startDate?: string;                // Start date (YYYY-MM-DD or ISO 8601)
    endDate?: string;                  // End date (YYYY-MM-DD or ISO 8601)
    publishedAfter?: string;           // Articles published after this timestamp
    publishedBefore?: string;          // Articles published before this timestamp
    
    // Sorting
    sortBy?: 'published' | 'updated' | 'relevance';  // Sort field
    sortOrder?: 'asc' | 'desc';        // Sort direction
    
    // Content options
    includeBody?: boolean;             // Include full article body
    includeSummary?: boolean;          // Include article summary
    includeThumbnail?: boolean;        // Include thumbnail image URL
}

export class CoinDeskService extends Service {
    static serviceType = "COINDESK_NEWS" as const;
    capabilityDescription = "Fetch cryptocurrency news articles from CoinDesk API";
    
    private apiKey: string;
    private baseUrl: string = "https://data-api.coindesk.com";

    static async start(runtime: IAgentRuntime): Promise<CoinDeskService> {
        const service = new CoinDeskService();
        await service.initialize(runtime);
        return service;
    }

    async initialize(runtime: IAgentRuntime): Promise<void> {
        this.apiKey = runtime.getSetting("COINDESK_API_KEY") ?? "";
        
        if (!this.apiKey) {
            logger.warn("COINDESK_API_KEY not configured. CRYPTO_NEWS will fall back to Tavily.");
        } else {
            logger.info("CoinDeskService initialized successfully");
        }
    }

    /**
     * Search for news articles using CoinDesk API
     * @param options - Comprehensive search and filter options
     * @returns Promise with article results
     */
    async searchNews(
        options: CoinDeskSearchOptions = {}
    ): Promise<CoinDeskNewsResponse> {
        if (!this.apiKey) {
            return {
                success: false,
                error: "COINDESK_API_KEY is not configured",
            };
        }

        try {
            const params = new URLSearchParams();
            
            // Search and filtering
            if (options.query) params.append("q", options.query);
            if (options.keywords?.length) params.append("keywords", options.keywords.join(","));
            
            // Pagination
            const limit = options.limit ? Math.min(Math.max(1, options.limit), 100) : 20;
            params.append("limit", limit.toString());
            if (options.offset) params.append("offset", options.offset.toString());
            if (options.page) params.append("page", options.page.toString());
            
            // Categorization
            if (options.categories?.length) params.append("categories", options.categories.join(","));
            if (options.tags?.length) params.append("tags", options.tags.join(","));
            if (options.authors?.length) params.append("authors", options.authors.join(","));
            
            // Date filtering - support multiple formats
            if (options.startDate) params.append("start_date", options.startDate);
            if (options.endDate) params.append("end_date", options.endDate);
            if (options.publishedAfter) params.append("published_after", options.publishedAfter);
            if (options.publishedBefore) params.append("published_before", options.publishedBefore);
            
            // Sorting
            if (options.sortBy) params.append("sort_by", options.sortBy);
            if (options.sortOrder) params.append("sort_order", options.sortOrder);
            
            // Content options
            if (options.includeBody) params.append("include_body", "true");
            if (options.includeSummary !== false) params.append("include_summary", "true");
            if (options.includeThumbnail) params.append("include_thumbnail", "true");

            const url = `${this.baseUrl}/news/v1/article/list?${params.toString()}`;
            
            logger.info(`[CoinDesk] Fetching news: ${options.query || "latest"} (limit: ${limit})`);

            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                    'X-API-Key': this.apiKey,
                    'User-Agent': 'Otaku-ElizaOS/1.0',
                },
            });

            if (!response.ok) {
                const errorText = await response.text();
                logger.error(`[CoinDesk] API error (${response.status}): ${errorText}`);
                return {
                    success: false,
                    error: `CoinDesk API error: ${response.status} - ${errorText}`,
                };
            }

            const result = await response.json();
            
            // Handle different possible response formats
            const articles = result.data || result.articles || result.results || [];
            const total = result.total || result.count || articles.length;
            
            logger.info(`[CoinDesk] Found ${articles.length} articles (total: ${total})`);
            
            return {
                success: true,
                data: {
                    articles: articles.map((article: CoinDeskArticle) => ({
                        id: article.id,
                        title: article.title,
                        url: article.url,
                        summary: article.summary,
                        body: article.body,
                        publishedAt: article.publishedAt,
                        updatedAt: article.updatedAt,
                        authors: article.authors,
                        categories: article.categories,
                        tags: article.tags,
                        thumbnail: article.thumbnail,
                        source: "CoinDesk",
                    })),
                    total,
                    page: result.page,
                    pageSize: result.pageSize || limit,
                },
            };
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            logger.error(`[CoinDesk] Search failed: ${errorMsg}`);
            return {
                success: false,
                error: errorMsg,
            };
        }
    }

    /**
     * Get latest crypto news headlines (convenience method)
     * @param limit - Number of headlines to fetch (default: 10)
     * @returns Promise with article results
     */
    async getLatestHeadlines(limit: number = 10): Promise<CoinDeskNewsResponse> {
        return this.searchNews({
            limit,
            sortBy: 'published',
            sortOrder: 'desc',
            includeSummary: true,
        });
    }

    /**
     * Search news by category
     * @param category - Category name (e.g., 'markets', 'tech', 'policy', 'defi')
     * @param limit - Number of results
     * @returns Promise with article results
     */
    async searchByCategory(category: string, limit: number = 10): Promise<CoinDeskNewsResponse> {
        return this.searchNews({
            categories: [category],
            limit,
            sortBy: 'published',
            sortOrder: 'desc',
        });
    }

    /**
     * Search news within date range
     * @param query - Search query
     * @param startDate - Start date (YYYY-MM-DD)
     * @param endDate - End date (YYYY-MM-DD)
     * @param limit - Number of results
     * @returns Promise with article results
     */
    async searchByDateRange(
        query: string,
        startDate: string,
        endDate: string,
        limit: number = 10
    ): Promise<CoinDeskNewsResponse> {
        return this.searchNews({
            query,
            startDate,
            endDate,
            limit,
            sortBy: 'published',
            sortOrder: 'desc',
        });
    }

    /**
     * Check if the service is properly configured
     */
    isConfigured(): boolean {
        return !!this.apiKey;
    }

    /**
     * Stop the service (cleanup if needed)
     */
    async stop(): Promise<void> {
        logger.info("CoinDeskService stopped");
    }
}

