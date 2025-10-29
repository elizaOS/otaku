import { webSearch } from "./actions/webSearch";
import { webFetch } from "./actions/webFetch";
import { cryptoNews } from "./actions/cryptoNews";
import { TavilyService } from "./services/tavilyService";
import { FirecrawlService } from "./services/firecrawlService";
import { CoinDeskService } from "./services/coindeskService";

export const webSearchPlugin = {
    name: "webSearch",
    description: "Web search, crypto news, and webpage scraping via Tavily, CoinDesk, and Firecrawl",
    actions: [webSearch, webFetch, cryptoNews],
    evaluators: [],
    providers: [],
    services: [TavilyService, FirecrawlService, CoinDeskService],
    clients: [],
    adapters: [],
};

export default webSearchPlugin;
