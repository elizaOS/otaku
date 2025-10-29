import {
    type Action,
    type ActionResult,
    type HandlerCallback,
    type IAgentRuntime,
    type Memory,
    type State,
    logger,
} from "@elizaos/core";
import { FirecrawlService } from "../services/firecrawlService";

const DEFAULT_MAX_FETCH_CHARS = 32000;

function MaxTokens( 
    data: string,
    maxTokens: number = DEFAULT_MAX_FETCH_CHARS
): string {
    // Character-based truncation to cap response length
    return data.length > maxTokens ? data.slice(0, maxTokens) : data;
}

export const webFetch: Action = {
    name: "WEB_FETCH_OR_SCRAPE",
    similes: [
        "FETCH_URL",
        "SCRAPE_PAGE",
        "GET_WEBPAGE",
        "FETCH_WEB_PAGE",
        "SCRAPE_URL",
        "GET_PAGE_CONTENT",
        "FETCH_CONTENT",
        "SCRAPE_WEBSITE",
        "FIRECRAWL",
        "FIRECRAWL_SCRAPE",
        "CRAWL_PAGE",
        "EXTRACT_PAGE",
        "READ_WEBPAGE",
        "DOWNLOAD_PAGE",
        "GET_URL_CONTENT",
        "EXTRACT_URL",
        "PARSE_URL",
        "SCRAPE_ARTICLE",
        "GET_ARTICLE",
        "FETCH_ARTICLE",
        "READ_URL",
        "GET_BLOG_POST",
        "FETCH_DOCUMENTATION",
        "GET_DOC_PAGE",
        "EXTRACT_WEB_CONTENT",
        "WEB_SCRAPER",
    ],
    suppressInitialMessage: true,
    description:
        "Fetch and scrape content from a specific URL. Returns clean markdown, HTML, metadata, and links. Use when user provides a direct URL to read/fetch/scrape. NOT for web searches - use WEB_SEARCH for queries without URLs.",
    
    // Parameter schema for tool calling
    parameters: {
        url: {
            type: "string",
            description: "The URL of the webpage to fetch and scrape",
            required: true,
        },
        formats: {
            type: "array",
            description: "Array of formats to return: 'markdown', 'html', 'rawHtml', 'screenshot', 'links'. Defaults to ['markdown', 'html']",
            required: false,
        },
        onlyMainContent: {
            type: "boolean",
            description: "Whether to extract only main content (removes headers, footers, nav). Defaults to true",
            required: false,
        },
    },
    
    validate: async (
        runtime: IAgentRuntime,
        _message: Memory,
        _state?: State
    ) => {
        try {
            const service = runtime.getService<FirecrawlService>("FIRECRAWL");
            return !!service && service.isConfigured();
        } catch (err) {
            logger.warn("FirecrawlService not available:", (err as Error).message);
            return false;
        }
    },

    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        _state?: State,
        _options?: { [key: string]: unknown },
        callback?: HandlerCallback
    ): Promise<ActionResult> => {
        try {
            const firecrawlService = runtime.getService<FirecrawlService>("FIRECRAWL");
            if (!firecrawlService) {
                throw new Error("FirecrawlService not initialized");
            }

            if (!firecrawlService.isConfigured()) {
                throw new Error("FIRECRAWL_API_KEY is not configured");
            }

            // Read parameters from state (extracted by multiStepDecisionTemplate)
            const composedState = await runtime.composeState(message, ["ACTION_STATE"], true);
            
            // Support both actionParams (new pattern) and webFetch (legacy pattern)
            const params = composedState?.data?.actionParams || composedState?.data?.webFetch || {};
            
            // Extract and validate URL parameter (required)
            const url: string | undefined = params?.url?.trim();
            
            if (!url) {
                const errorMsg = "Missing required parameter 'url'. Please specify the URL to fetch.";
                logger.error(`[WEB_FETCH] ${errorMsg}`);
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

            // Validate URL format
            try {
                new URL(url);
            } catch (e) {
                const errorMsg = `Invalid URL format: ${url}`;
                logger.error(`[WEB_FETCH] ${errorMsg}`);
                const invalidResult: ActionResult = {
                    text: errorMsg,
                    success: false,
                    error: "invalid_url",
                };
                if (callback) {
                    callback({ 
                        text: invalidResult.text, 
                        content: { error: "invalid_url", details: errorMsg } 
                    });
                }
                return invalidResult;
            }

            logger.info(`[WEB_FETCH] Fetching URL: "${url}"`);

            // Store input parameters for return
            const inputParams = { 
                url,
                formats: params?.formats,
                onlyMainContent: params?.onlyMainContent,
            };

            // Use provided parameters or defaults
            const scrapeResponse = await firecrawlService.scrape(url, {
                formats: params?.formats || ['markdown', 'html'],
                onlyMainContent: params?.onlyMainContent ?? true,
            });

            if (scrapeResponse.success && scrapeResponse.data) {
                const { data } = scrapeResponse;
                
                // Build response text with markdown content
                let responseText = '';
                
                if (data.metadata?.title) {
                    responseText += `# ${data.metadata.title}\n\n`;
                }
                
                if (data.metadata?.description) {
                    responseText += `${data.metadata.description}\n\n`;
                }
                
                responseText += `**Source:** ${url}\n\n`;
                
                if (data.markdown) {
                    responseText += `## Content\n\n${data.markdown}`;
                } else if (data.html) {
                    responseText += `## Content (HTML)\n\n${data.html}`;
                }

                const result: ActionResult = {
                    text: MaxTokens(responseText, DEFAULT_MAX_FETCH_CHARS),
                    success: true,
                    data: {
                        url,
                        markdown: data.markdown,
                        html: data.html,
                        metadata: data.metadata,
                        links: data.links,
                    },
                    input: inputParams,
                } as ActionResult & { input: typeof inputParams };

                if (callback) {
                    callback({ 
                        text: result.text, 
                        actions: ["WEB_FETCH_OR_SCRAPE"], 
                        data: result.data 
                    });
                }

                return result;
            }

            const errorResult: ActionResult = {
                text: `Failed to fetch content from ${url}: ${scrapeResponse.error || 'Unknown error'}`,
                success: false,
                error: scrapeResponse.error,
                input: inputParams,
            } as ActionResult & { input: typeof inputParams };

            if (callback) {
                callback({ 
                    text: errorResult.text,
                    content: { error: "fetch_failed", details: scrapeResponse.error } 
                });
            }
            return errorResult;
        } catch (error) {
            const errMsg = error instanceof Error ? error.message : String(error);
            logger.error(`[WEB_FETCH] Action failed: ${errMsg}`);
            
            // Try to capture input params even in failure
            const composedState = await runtime.composeState(message, ["ACTION_STATE"], true);
            const params = composedState?.data?.actionParams || composedState?.data?.webFetch || {};
            const failureInputParams = {
                url: params?.url,
                formats: params?.formats,
                onlyMainContent: params?.onlyMainContent,
            };
            
            const errorResult: ActionResult = {
                text: `Web fetch failed: ${errMsg}`,
                success: false,
                error: errMsg,
                input: failureInputParams,
            } as ActionResult & { input: typeof failureInputParams };
            
            if (callback) {
                callback({ 
                    text: errorResult.text, 
                    content: { error: "web_fetch_failed", details: errMsg } 
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
                    text: "Fetch the content from https://example.com/article",
                },
            },
            {
                name: "{{agent}}",
                content: {
                    text: "I'll fetch that page for you.",
                    action: "WEB_FETCH_OR_SCRAPE",
                },
            },
        ],
        [
            {
                name: "{{user}}",
                content: {
                    text: "Get the content of this documentation page: https://docs.example.com/guide",
                },
            },
            {
                name: "{{agent}}",
                content: {
                    text: "Here's the content from that documentation page:",
                    action: "WEB_FETCH_OR_SCRAPE",
                },
            },
        ],
        [
            {
                name: "{{user}}",
                content: {
                    text: "Can you scrape https://blog.example.com/post/123",
                },
            },
            {
                name: "{{agent}}",
                content: {
                    text: "I'll scrape that blog post for you:",
                    action: "WEB_FETCH_OR_SCRAPE",
                },
            },
        ],
        [
            {
                name: "{{user}}",
                content: {
                    text: "Read this article for me: https://techblog.com/ai-trends-2024",
                },
            },
            {
                name: "{{agent}}",
                content: {
                    text: "I'll read that article and get you the content:",
                    action: "WEB_FETCH_OR_SCRAPE",
                },
            },
        ],
        [
            {
                name: "{{user}}",
                content: {
                    text: "What does this page say? https://news.site/breaking-story",
                },
            },
            {
                name: "{{agent}}",
                content: {
                    text: "Let me fetch the content from that page:",
                    action: "WEB_FETCH_OR_SCRAPE",
                },
            },
        ],
        [
            {
                name: "{{user}}",
                content: {
                    text: "Can you extract the content from this URL: https://medium.com/@author/post",
                },
            },
            {
                name: "{{agent}}",
                content: {
                    text: "I'll extract the content from that Medium post:",
                    action: "WEB_FETCH_OR_SCRAPE",
                },
            },
        ],
        [
            {
                name: "{{user}}",
                content: {
                    text: "Download and read https://research.org/paper.html",
                },
            },
            {
                name: "{{agent}}",
                content: {
                    text: "I'll download and read that page for you:",
                    action: "WEB_FETCH_OR_SCRAPE",
                },
            },
        ],
        [
            {
                name: "{{user}}",
                content: {
                    text: "Parse this documentation: https://api.example.com/docs/authentication",
                },
            },
            {
                name: "{{agent}}",
                content: {
                    text: "I'll parse that documentation page:",
                    action: "WEB_FETCH_OR_SCRAPE",
                },
            },
        ],
    ],
};
