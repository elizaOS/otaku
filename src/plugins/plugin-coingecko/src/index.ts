import type { Plugin } from "@elizaos/core";
import { CoinGeckoService } from "./services/coingecko.service";
import { getTokenMetadataAction } from "./actions/getTokenMetadata.action";
import { getTrendingTokensAction } from "./actions/getTrendingTokens.action";
import { getNFTCollectionStatsAction } from "./actions/getNFTCollectionStats.action";
import { getTrendingSearchAction } from "./actions/getTrendingSearch.action";
import { getTokenPriceChartAction } from "./actions/getTokenPriceChart.action";
import { getCategoriesListAction } from "./actions/getCategoriesList.action";
import { getCategoriesWithMarketDataAction } from "./actions/getCategoriesWithMarketData.action";
import { getHistoricalPriceAction } from "./actions/getHistoricalPrice.action";
import { shouldCoingeckoPluginBeInContext } from "../matcher";

export const coingeckoPlugin: Plugin = {
  name: "plugin-coingecko",
  description: "CoinGecko plugin exposing token metadata lookup, trending tokens, NFT collection stats, trending searches, price charts, historical prices, and coin categories",
  actions: [
    getTokenMetadataAction,
    getTrendingTokensAction,
    getNFTCollectionStatsAction,
    getTrendingSearchAction,
    getTokenPriceChartAction,
    getHistoricalPriceAction,
    getCategoriesListAction,
    getCategoriesWithMarketDataAction,
  ],
  services: [CoinGeckoService],
  evaluators: [],
  providers: [],
};

export default coingeckoPlugin;

export {
  CoinGeckoService,
  getTokenMetadataAction,
  getTrendingTokensAction,
  getNFTCollectionStatsAction,
  getTrendingSearchAction,
  getTokenPriceChartAction,
  getHistoricalPriceAction,
  getCategoriesListAction,
  getCategoriesWithMarketDataAction,
  shouldCoingeckoPluginBeInContext,
};


