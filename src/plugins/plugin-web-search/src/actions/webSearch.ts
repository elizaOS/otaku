import {
    type ActionResult,
    type HandlerCallback,
    type IAgentRuntime,
    type Memory,
    type State,
    logger,
} from "@elizaos/core";
import { ActionWithParams } from "../../../../types";
import { WebSearchService } from "../services/webSearchService";
import type { SearchResult } from "../types";

const DEFAULT_MAX_WEB_SEARCH_CHARS = 16000;

function MaxTokens(
    data: string,
    maxTokens: number = DEFAULT_MAX_WEB_SEARCH_CHARS
): string {
    // Character-based truncation to cap response length
    return data.length > maxTokens ? data.slice(0, maxTokens) : data;
}

export const webSearch: ActionWithParams = {
    name: "WEB_SEARCH",
    similes: [
        "SEARCH_WEB",
        "INTERNET_SEARCH",
        "LOOKUP",
        "QUERY_WEB",
        "FIND_ONLINE",
        "SEARCH_ENGINE",
        "WEB_LOOKUP",
        "ONLINE_SEARCH",
        "FIND_INFORMATION",
    ],
    suppressInitialMessage: true,
    description:
        "Use this action when other actions/providers can't provide accurate or current info, or when facts must be confirmed via the web.",
    
    // Parameter schema for tool calling
    parameters: {
        query: {
            type: "string",
            description: "The search query to look up on the web",
            required: true,
        },
        time_range: {
            type: "string",
            description: "Time range filter: 'day', 'week', 'month', 'year' (or 'd', 'w', 'm', 'y')",
            required: false,
        },
        start_date: {
            type: "string",
            description: "Start date filter in YYYY-MM-DD format (returns results after this date)",
            required: false,
        },
        end_date: {
            type: "string",
            description: "End date filter in YYYY-MM-DD format (returns results before this date)",
            required: false,
        },
    },
    
    validate: async (
        runtime: IAgentRuntime,
        _message: Memory,
        _state?: State
    ) => {
        try {
            const service = runtime.getService<WebSearchService>(WebSearchService.serviceType);
            return !!service;
        } catch (err) {
            logger.warn("WebSearchService not available:", (err as Error).message);
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
            const webSearchService = runtime.getService<WebSearchService>(WebSearchService.serviceType);
            if (!webSearchService) {
                throw new Error("WebSearchService not initialized");
            }

            // Read parameters from state (extracted by multiStepDecisionTemplate)
            const composedState = await runtime.composeState(message, ["ACTION_STATE"], true);
            
            // Support both actionParams (new pattern) and webSearch (legacy pattern)
            const params = composedState?.data?.actionParams || composedState?.data?.webSearch || {};
            
            // Extract and validate query parameter (required)
            const query: string | undefined = params?.query?.trim();
            
            if (!query) {
                const errorMsg = "Missing required parameter 'query'. Please specify what to search for.";
                logger.error(`[WEB_SEARCH] ${errorMsg}`);
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

            logger.info(`[WEB_SEARCH] Searching for: "${query}"`);

            // Store input parameters for return
            const inputParams = { 
                query,
                time_range: params?.time_range,
                start_date: params?.start_date,
                end_date: params?.end_date,
            };

            // Use provided parameters or defaults
            const searchResponse = await webSearchService.search(query, {
                max_results: 5,
                search_depth: "basic",
                time_range: params?.time_range,
                start_date: params?.start_date,
                end_date: params?.end_date,
                include_answer: true,
                include_images: false,
            });

            if (searchResponse && searchResponse.results.length) {
                const responseList = searchResponse.answer
                    ? `${searchResponse.answer}${
                          Array.isArray(searchResponse.results) &&
                          searchResponse.results.length > 0
                              ? `\n\nFor more details, you can check out these resources:\n${searchResponse.results
                                    .map(
                                        (result: SearchResult, index: number) =>
                                            `${index + 1}. [${result.title}](${result.url})`
                                    )
                                    .join("\n")}`
                              : ""
                      }`
                    : "";

                const result: ActionResult = {
                    text: MaxTokens(responseList, DEFAULT_MAX_WEB_SEARCH_CHARS),
                    success: true,
                    data: searchResponse,
                    input: inputParams,
                } as ActionResult & { input: typeof inputParams };

                if (callback) {
                    callback({ text: result.text, actions: ["WEB_SEARCH"], data: result.data });
                }

                return result;
            }

            const noResult: ActionResult = {
                text: "I couldn't find relevant results for that query.",
                success: false,
                input: inputParams,
            } as ActionResult & { input: typeof inputParams };

            if (callback) {
                callback({ text: noResult.text });
            }
            return noResult;
        } catch (error) {
            const errMsg = error instanceof Error ? error.message : String(error);
            logger.error(`[WEB_SEARCH] Action failed: ${errMsg}`);
            
            // Try to capture input params even in failure
            const composedState = await runtime.composeState(message, ["ACTION_STATE"], true);
            const params = composedState?.data?.actionParams || composedState?.data?.webSearch || {};
            const failureInputParams = {
                query: params?.query,
                time_range: params?.time_range,
                start_date: params?.start_date,
                end_date: params?.end_date,
            };
            
            const errorResult: ActionResult = {
                text: `Web search failed: ${errMsg}`,
                success: false,
                error: errMsg,
                input: failureInputParams,
            } as ActionResult & { input: typeof failureInputParams };
            
            if (callback) {
                callback({ 
                    text: errorResult.text, 
                    content: { error: "web_search_failed", details: errMsg } 
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
                    text: "Find the latest news about SpaceX launches.",
                },
            },
            {
                name: "{{agent}}",
                content: {
                    text: "Here is the latest news about SpaceX launches:",
                    action: "WEB_SEARCH",
                },
            },
        ],
        [
            {
                name: "{{user}}",
                content: {
                    text: "Can you find details about the iPhone 16 release?",
                },
            },
            {
                name: "{{agent}}",
                content: {
                    text: "Here are the details I found about the iPhone 16 release:",
                    action: "WEB_SEARCH",
                },
            },
        ],
        [
            {
                name: "{{user}}",
                content: {
                    text: "What is the schedule for the next FIFA World Cup?",
                },
            },
            {
                name: "{{agent}}",
                content: {
                    text: "Here is the schedule for the next FIFA World Cup:",
                    action: "WEB_SEARCH",
                },
            },
        ],
        [
            {
                name: "{{user}}",
                content: { text: "Check the latest stock price of Tesla." },
            },
            {
                name: "{{agent}}",
                content: {
                    text: "Here is the latest stock price of Tesla I found:",
                    action: "WEB_SEARCH",
                },
            },
        ],
        [
            {
                name: "{{user}}",
                content: {
                    text: "What are the current trending movies in the US?",
                },
            },
            {
                name: "{{agent}}",
                content: {
                    text: "Here are the current trending movies in the US:",
                    action: "WEB_SEARCH",
                },
            },
        ],
        [
            {
                name: "{{user}}",
                content: {
                    text: "What is the latest score in the NBA finals?",
                },
            },
            {
                name: "{{agent}}",
                content: {
                    text: "Here is the latest score from the NBA finals:",
                    action: "WEB_SEARCH",
                },
            },
        ],
        [
            {
                name: "{{user}}",
                content: { text: "When is the next Apple keynote event?" },
            },
            {
                name: "{{agent}}",
                content: {
                    text: "Here is the information about the next Apple keynote event:",
                    action: "WEB_SEARCH",
                },
            },
        ],
    ],
} as ActionWithParams;