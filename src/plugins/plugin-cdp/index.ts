import type { Plugin } from "@elizaos/core";

// Services
import { CdpService } from "./services/cdp.service";

// Actions
// import { cdpWalletBalance } from "./actions/cdp-wallet-balance";
// import { cdpCreateWallet } from "./actions/cdp-wallet-create";
import { cdpWalletInfo } from "./actions/cdp-wallet-info";
import { cdpWalletSwap } from "./actions/cdp-wallet-swap";
import { cdpWalletTransfer } from "./actions/cdp-wallet-transfer";
// import { cdpWalletUnwrap } from "./actions/cdp-wallet-unwrap";

// Providers
import { walletStateProvider } from "./providers/walletState";

// Types
export type { CdpNetwork } from "./types";

export const cdpPlugin: Plugin = {
  name: "cdp",
  description:
    "Coinbase Developer Platform plugin providing authenticated EVM account creation, token transfers, and swaps via CDP SDK",
  evaluators: [],
  providers: [walletStateProvider],
  actions: [cdpWalletInfo, cdpWalletTransfer, cdpWalletSwap],
  services: [CdpService],
};

export default cdpPlugin;


