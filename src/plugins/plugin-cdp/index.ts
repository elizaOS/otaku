import type { Plugin } from "@elizaos/core";

// Services
import { CdpService } from "./services/cdp.service";

// Actions
// import { cdpWalletBalance } from "./actions/cdp-wallet-balance";
// import { cdpCreateWallet } from "./actions/cdp-wallet-create";
import { cdpWalletInfo } from "./actions/cdp-wallet-info";
import { cdpWalletCheckBalance } from "./actions/cdp-wallet-check-balance";
import { cdpWalletSwap } from "./actions/cdp-wallet-swap";
import { cdpWalletTokenTransfer } from "./actions/cdp-wallet-token-transfer";
import { cdpWalletNftTransfer } from "./actions/cdp-wallet-nft-transfer";
// import { cdpWalletFetchWithPayment } from "./actions/cdp-wallet-fetch-with-payment";
// import { cdpWalletUnwrap } from "./actions/cdp-wallet-unwrap";

// Providers
import { walletStateProvider } from "./providers/walletState";

// Types
export type { CdpNetwork } from "./types";

/**
 * CDP Plugin
 * 
 * Provides Coinbase Developer Platform integration for:
 * - Wallet management (balances, tokens, NFTs)
 * - Token transfers and swaps
 * - NFT transfers
 * - x402 paid API requests (new!)
 * 
 * Actions:
 * - USER_WALLET_INFO: View wallet balances and assets
 * - CHECK_TOKEN_BALANCE: Fast balance check for specific token (optimized for transaction validation)
 * - USER_WALLET_TOKEN_TRANSFER: Transfer ERC20 tokens
 * - USER_WALLET_NFT_TRANSFER: Transfer NFTs
 * - USER_WALLET_SWAP: Swap tokens via DEX aggregators
 * - FETCH_WITH_PAYMENT: Make paid requests to x402 APIs
 */
export const cdpPlugin: Plugin = {
  name: "cdp",
  description:
    "Coinbase Developer Platform plugin providing authenticated EVM account creation, token transfers, NFT transfers, swaps, and x402 paid API requests via CDP SDK",
  evaluators: [],
  providers: [walletStateProvider],
  actions: [cdpWalletInfo, cdpWalletCheckBalance, cdpWalletTokenTransfer, cdpWalletNftTransfer, cdpWalletSwap],
  services: [CdpService],
};

export default cdpPlugin;


