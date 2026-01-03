import {
  Action,
  ActionResult,
  HandlerCallback,
  IAgentRuntime,
  Memory,
  State,
  logger,
} from "@elizaos/core";
import { DefiLlamaService, type ProtocolLookupResult, type ProtocolSummary } from "../services/defillama.service";
import { validateDefillamaService, getDefillamaService, extractActionParams } from "../utils/actionHelpers";

export const getProtocolSlugAction: Action = {
  name: "GET_PROTOCOL_SLUG",
  similes: [
    "PROTOCOL_SLUG",
    "FIND_PROTOCOL",
    "SEARCH_PROTOCOL",
    "PROTOCOL_INFO",
    "DEFILLAMA_PROTOCOL_SLUG",
  ],
  description:
    "Use this action to search for DeFi protocol slugs and basic information by protocol name or symbol. Returns protocol slugs needed for TVL history lookups.",

  // Parameter schema for tool calling
  parameters: {
    protocols: {
      type: "string",
      description: "Comma-separated list of DeFi protocol names or symbols to search for (e.g., 'Aave,Curve' or 'EIGEN,MORPHO')",
      required: true,
    },
  },

  validate: async (runtime: IAgentRuntime, message: Memory, state?: State): Promise<boolean> => {
    return validateDefillamaService(runtime, "GET_PROTOCOL_SLUG", state, message);
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: { [key: string]: unknown },
    callback?: HandlerCallback,
  ): Promise<ActionResult> => {
    try {
      const svc = getDefillamaService(runtime);
      if (!svc) {
        throw new Error("DefiLlamaService not available");
      }

      // Read parameters from state (extracted by multiStepDecisionTemplate)
      const params = await extractActionParams<{ protocols?: string }>(runtime, message);

      // Extract and validate protocols parameter (required)
      const protocolsRaw: string | undefined = params?.protocols?.trim();

      if (!protocolsRaw) {
        const errorMsg = "Missing required parameter 'protocols'. Please specify which DeFi protocol(s) to search for (e.g., 'Aave,Curve' or 'EIGEN,MORPHO').";
        logger.error(`[GET_PROTOCOL_SLUG] ${errorMsg}`);
        const errorResult: ActionResult = {
          text: errorMsg,
          success: false,
          error: "missing_required_parameter",
        };
        if (callback) {
          await callback({
            text: errorResult.text,
            content: { error: "missing_required_parameter", details: errorMsg },
          });
        }
        return errorResult;
      }

      // Parse comma-separated protocol names
      const names = protocolsRaw
        .split(",")
        .map((s: string) => s.trim())
        .filter(Boolean);

      if (!names.length) {
        const errorMsg = "No valid protocol names found. Please provide DeFi protocol names or symbols.";
        logger.error(`[GET_PROTOCOL_SLUG] ${errorMsg}`);
        const errorResult: ActionResult = {
          text: errorMsg,
          success: false,
          error: "invalid_parameter",
        };
        if (callback) {
          await callback({
            text: errorResult.text,
            content: { error: "invalid_parameter", details: errorMsg },
          });
        }
        return errorResult;
      }

      logger.info(`[GET_PROTOCOL_SLUG] Searching for protocols: ${names.join(", ")}`);

      // Store input parameters for return
      const inputParams = { protocols: protocolsRaw };

      // Search for multiple candidates per protocol name (0-5 matches each)
      type ProtocolSlugInfo = {
        id: string;
        slug: string | null;
        name: string;
        symbol: string | null;
        category: string | null;
        chains: string[];
        url: string | null;
        logo: string | null;
        tvl: number | null;
      };

      type SearchResult = {
        query: string;
        candidates: ProtocolSlugInfo[];
      };

      const searchResults: SearchResult[] = [];

      for (const query of names) {
        const candidates = await svc.searchProtocolCandidates(query, 5);
        const candidateInfos: ProtocolSlugInfo[] = candidates.map((protocol) => ({
          id: protocol.id,
          slug: protocol.slug,
          name: protocol.name,
          symbol: protocol.symbol,
          category: protocol.category,
          chains: protocol.chains,
          url: protocol.url,
          logo: protocol.logo,
          tvl: protocol.tvl,
        }));

        searchResults.push({
          query,
          candidates: candidateInfos,
        });
      }

      const totalCandidates = searchResults.reduce((sum, r) => sum + r.candidates.length, 0);
      const queriesWithNoResults = searchResults.filter((r) => r.candidates.length === 0).length;

      if (totalCandidates === 0) {
        const errorMsg = "No protocols matched any of the provided names";
        logger.error(`[GET_PROTOCOL_SLUG] ${errorMsg}`);
        const errorResult: ActionResult = {
          text: errorMsg,
          success: false,
          error: "no_matches",
          input: inputParams,
        } as ActionResult & { input: typeof inputParams };
        if (callback) {
          await callback({
            text: errorResult.text,
            content: { error: "no_matches", details: errorMsg },
          });
        }
        return errorResult;
      }

      const messageText = queriesWithNoResults > 0
        ? `Found ${totalCandidates} candidate(s) for ${searchResults.length} search(es); ${queriesWithNoResults} search(es) had no matches`
        : `Found ${totalCandidates} candidate(s) for ${searchResults.length} search(es)`;

      if (callback) {
        await callback({
          text: messageText,
          actions: ["GET_PROTOCOL_SLUG"],
          content: searchResults,
          source: message.content.source,
        });
      }

      return {
        text: messageText,
        success: true,
        data: searchResults,
        values: searchResults,
        input: inputParams,
      } as ActionResult & { input: typeof inputParams };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`[GET_PROTOCOL_SLUG] Action failed: ${msg}`);
      
      // Try to capture input params even in failure
      const params = await extractActionParams<{ protocols?: string }>(runtime, message);
      const failureInputParams = {
        protocols: params?.protocols,
      };
      
      const errorResult: ActionResult = {
        text: `Failed to search for protocols: ${msg}`,
        success: false,
        error: msg,
        input: failureInputParams,
      } as ActionResult & { input: typeof failureInputParams };
      
      if (callback) {
        await callback({
          text: errorResult.text,
          content: { error: "action_failed", details: msg },
        });
      }
      return errorResult;
    }
  },

  examples: [
    [
      {
        name: "{{user}}",
        content: { text: "What's Aave's TVL?" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Found 4 candidate(s) for 1 search(es)",
          actions: ["GET_PROTOCOL_SLUG"],
          content: [
            {
              query: "Aave",
              candidates: [
                { id: "2269", slug: "aave-v3", name: "Aave V3", symbol: "AAVE", category: "Lending", chains: ["Ethereum", "Arbitrum", "Polygon"], tvl: 37488847110 },
                { id: "118", slug: "aave-v2", name: "Aave V2", symbol: "AAVE", category: "Lending", chains: ["Ethereum", "Polygon"], tvl: 250317261 },
              ],
            },
          ],
        },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Aave V3 has $37.5B TVL across Ethereum, Arbitrum, and Polygon. Aave V2 has $250M TVL.",
          actions: ["GET_PROTOCOL_TVL"],
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: { text: "Compare Morpho and Curve TVL" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Found 6 candidate(s) for 2 search(es)",
          actions: ["GET_PROTOCOL_SLUG"],
          content: [
            {
              query: "Morpho",
              candidates: [
                { id: "2432", slug: "morpho-v1", name: "Morpho V1", symbol: "MORPHO", category: "Lending", chains: ["Ethereum"], tvl: 8358689621 },
                { id: "2711", slug: "morpho-v0-aavev3", name: "Morpho V0 AaveV3", symbol: "MORPHO", category: "Lending", chains: ["Ethereum"], tvl: 157908526 },
              ],
            },
            {
              query: "Curve",
              candidates: [
                { id: "3", slug: "curve-dex", name: "Curve DEX", symbol: "CRV", category: "Dexs", chains: ["Ethereum"], tvl: 2297116219 },
                { id: "3331", slug: "curve-llamalend", name: "Curve LlamaLend", symbol: "CRV", category: "Lending", chains: ["Ethereum"], tvl: 88837892 },
              ],
            },
          ],
        },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Morpho V1: $8.36B TVL. Curve DEX: $2.30B TVL. Morpho has 3.6x higher TVL.",
          actions: ["GET_PROTOCOL_TVL"],
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: { text: "Show me EigenLayer's TVL history" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Found 2 candidate(s) for 1 search(es)",
          actions: ["GET_PROTOCOL_SLUG"],
          content: [
            {
              query: "EigenLayer",
              candidates: [
                { id: "2442", slug: "eigenlayer", name: "EigenLayer", symbol: "EIGEN", category: "Restaking", chains: ["Ethereum"], tvl: 16138339551 },
                { id: "3282", slug: "eigenpie", name: "Eigenpie", symbol: "-", category: "Liquid Restaking", chains: ["Ethereum"], tvl: 11186759 },
              ],
            },
          ],
        },
      },
      {
        name: "{{agent}}",
        content: {
          text: "EigenLayer TVL peaked at $18.2B in March 2024, currently at $16.1B (-11.5%).",
          actions: ["GET_PROTOCOL_TVL_HISTORY"],
        },
      },
    ],
  ],
};

