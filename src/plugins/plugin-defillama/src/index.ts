import type { Plugin } from "@elizaos/core";
import { DefiLlamaService } from "./services/defillama.service";
import { getProtocolTvlAction } from "./actions/getProtocolTvl.action";
import { getProtocolTvlHistoryAction } from "./actions/getProtocolTvlHistory.action";
import { getChainTvlHistoryAction } from "./actions/getChainTvlHistory.action";
import { getYieldRatesAction } from "./actions/getYieldRates.action";
import { getYieldHistoryAction } from "./actions/getYieldHistory.action";

export const defiLlamaPlugin: Plugin = {
  name: "plugin-defillama",
  description: "DeFiLlama integration: protocol TVL lookups, yield opportunities, and historical trends",
  actions: [
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
  getProtocolTvlAction,
  getProtocolTvlHistoryAction,
  getChainTvlHistoryAction,
  getYieldRatesAction,
  getYieldHistoryAction,
};


