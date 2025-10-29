/**
 * Plugin metadata for UI display
 * Maps plugin names to their display information and sample prompts
 */

export interface PluginMetadata {
  name: string;
  displayName: string;
  icon: string; // emoji or icon path
  description: string;
  samplePrompts: string[];
}

export const PLUGIN_METADATA: Record<string, PluginMetadata> = {
  'plugin-cdp': {
    name: 'plugin-cdp',
    displayName: 'Coinbase',
    icon: '💰',
    description: 'Wallet & trading on Base',
    samplePrompts: [
      'Show my wallet balance',
      'Send 0.01 ETH to address',
      'Swap ETH for USDC',
      'Get my transaction history',
    ],
  },
  'plugin-coingecko': {
    name: 'plugin-coingecko',
    displayName: 'CoinGecko',
    icon: '🦎',
    description: 'Token prices & market data',
    samplePrompts: [
      'Get Bitcoin price',
      'Show trending tokens',
      'What are trending NFT collections?',
      'Get ETH price chart',
    ],
  },
  'plugin-defillama': {
    name: 'plugin-defillama',
    displayName: 'DeFiLlama',
    icon: '🦙',
    description: 'DeFi protocol analytics',
    samplePrompts: [
      'Compare Aave vs Uniswap TVL',
      'Get Compound protocol stats',
      'Show top DeFi protocols',
      'Compare Eigen vs Morpho',
    ],
  },
  'plugin-web-search': {
    name: 'plugin-web-search',
    displayName: 'Web Search',
    icon: '🔍',
    description: 'Latest crypto news & info',
    samplePrompts: [
      'Latest DeFi news',
      'What is happening with Bitcoin?',
      'Search for Ethereum upgrades',
      'Latest crypto market news',
    ],
  },
  'plugin-relay': {
    name: 'plugin-relay',
    displayName: 'Relay',
    icon: '🔄',
    description: 'Cross-chain bridging',
    samplePrompts: [
      'Bridge tokens to Base',
      'Check bridge status',
      'Get bridge quote',
      'Cross-chain transfer',
    ],
  },
};

// Get all plugins in display order
export const getPlugins = (): PluginMetadata[] => {
  return Object.values(PLUGIN_METADATA);
};

// Get plugin by name
export const getPluginMetadata = (name: string): PluginMetadata | undefined => {
  return PLUGIN_METADATA[name];
};
