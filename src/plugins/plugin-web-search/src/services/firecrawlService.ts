import {
    type IAgentRuntime,
    Service,
    ServiceType,
    logger,
} from "@elizaos/core";

export interface FirecrawlScrapeOptions {
    formats?: Array<'markdown' | 'html' | 'rawHtml' | 'screenshot' | 'links'>;
    onlyMainContent?: boolean;
    includeTags?: string[];
    excludeTags?: string[];
    waitFor?: number;
    timeout?: number;
}

export interface FirecrawlScrapeResponse {
    success: boolean;
    data?: {
        markdown?: string;
        html?: string;
        rawHtml?: string;
        screenshot?: string;
        links?: string[];
        metadata?: {
            title?: string;
            description?: string;
            language?: string;
            ogTitle?: string;
            ogDescription?: string;
            ogUrl?: string;
            ogImage?: string;
        };
    };
    error?: string;
}

export class FirecrawlService extends Service {
    static serviceType = "FIRECRAWL" as const;
    capabilityDescription = "Fetch and scrape webpage content using Firecrawl API";
    
    private apiKey: string;
    private baseUrl: string = "https://api.firecrawl.dev/v1";

    static async start(runtime: IAgentRuntime): Promise<FirecrawlService> {
        const service = new FirecrawlService();
        await service.initialize(runtime);
        return service;
    }

    async initialize(runtime: IAgentRuntime): Promise<void> {
        this.apiKey = runtime.getSetting("FIRECRAWL_API_KEY") ?? "";
        
        if (!this.apiKey) {
            logger.warn("FIRECRAWL_API_KEY not configured. WEB_FETCH action will not be available.");
        } else {
            logger.info("FirecrawlService initialized successfully");
        }
    }

    /**
     * Scrape a URL using Firecrawl API
     * @param url - The URL to scrape
     * @param options - Optional scraping configuration
     * @returns Promise with scraped content
     */
    async scrape(
        url: string,
        options: FirecrawlScrapeOptions = {}
    ): Promise<FirecrawlScrapeResponse> {
        if (!this.apiKey) {
            throw new Error("FIRECRAWL_API_KEY is not configured");
        }

        try {
            logger.info(`[Firecrawl] Scraping URL: ${url}`);

            const requestBody = {
                url,
                formats: options.formats || ['markdown', 'html'],
                onlyMainContent: options.onlyMainContent ?? true,
                ...(options.includeTags && { includeTags: options.includeTags }),
                ...(options.excludeTags && { excludeTags: options.excludeTags }),
                ...(options.waitFor && { waitFor: options.waitFor }),
                ...(options.timeout && { timeout: options.timeout }),
            };

            const response = await fetch(`${this.baseUrl}/scrape`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`,
                },
                body: JSON.stringify(requestBody),
            });

            if (!response.ok) {
                const errorText = await response.text();
                logger.error(`[Firecrawl] API error (${response.status}): ${errorText}`);
                return {
                    success: false,
                    error: `Firecrawl API error: ${response.status} - ${errorText}`,
                };
            }

            const result = await response.json();
            
            logger.info(`[Firecrawl] Successfully scraped ${url}`);
            
            return {
                success: true,
                data: result.data,
            };
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            logger.error(`[Firecrawl] Scrape failed for ${url}: ${errorMsg}`);
            return {
                success: false,
                error: errorMsg,
            };
        }
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
        // No cleanup needed for Firecrawl service
        logger.info("FirecrawlService stopped");
    }
}
