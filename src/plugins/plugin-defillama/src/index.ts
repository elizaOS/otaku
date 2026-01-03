import type { Plugin } from "@elizaos/core";
import { DefiLlamaService } from "./services/defillama.service";
import { getProtocolTvlAction } from "./actions/getProtocolTvl.action";
import { getProtocolSlugAction } from "./actions/getProtocolSlug.action";
import { getProtocolTvlHistoryAction } from "./actions/getProtocolTvlHistory.action";
import { getChainTvlHistoryAction } from "./actions/getChainTvlHistory.action";
import { getYieldRatesAction } from "./actions/getYieldRates.action";
import { getYieldHistoryAction } from "./actions/getYieldHistory.action";
import { shouldDefiLlamaPluginBeActive } from "../matcher";

export const defiLlamaPlugin: Plugin = {
  name: "plugin-defillama",
  description: "DeFiLlama integration: protocol discovery, TVL lookups, yield opportunities, and historical trends",
  actions: [
    getProtocolSlugAction,
    getProtocolTvlAction,
    getProtocolTvlHistoryAction,
    getChainTvlHistoryAction,
    getYieldRatesAction,
    getYieldHistoryAction,
  ],
  evaluators: [],
  providers: [],
  services: [DefiLlamaService],
};

export default defiLlamaPlugin;
export {
  DefiLlamaService,
  getProtocolSlugAction,
  getProtocolTvlAction,
  getProtocolTvlHistoryAction,
  getChainTvlHistoryAction,
  getYieldRatesAction,
  getYieldHistoryAction,
  shouldDefiLlamaPluginBeActive,
};


