import type { Plugin } from "@elizaos/core";
import { CoinGeckoService } from "./services/coingecko.service";
import { getTokenMetadataAction } from "./actions/getTokenMetadata.action";
import { getTrendingTokensAction } from "./actions/getTrendingTokens.action";

export const coingeckoPlugin: Plugin = {
  name: "plugin-coingecko",
  description: "CoinGecko plugin exposing token metadata lookup and trending tokens",
  actions: [getTokenMetadataAction, getTrendingTokensAction],
  services: [CoinGeckoService],
  evaluators: [],
  providers: [],
};

export default coingeckoPlugin;

export { CoinGeckoService, getTokenMetadataAction, getTrendingTokensAction };


