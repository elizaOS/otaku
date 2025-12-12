import { base, mainnet, polygon, baseSepolia, sepolia, arbitrum, optimism, scroll } from 'viem/chains';
import type { Chain } from 'viem/chains';

/**
 * Supported blockchain networks
 */
export type SupportedNetwork = 'base' | 'ethereum' | 'polygon' | 'arbitrum' | 'optimism' | 'scroll' | 'base-sepolia' | 'ethereum-sepolia';

/**
 * Chain configuration interface
 */
export interface ChainConfig {
  name: string;
  chain: Chain;
  rpcUrl: (alchemyKey: string) => string;
  explorerUrl: string;
  nativeToken: {
    symbol: string;
    name: string;
    coingeckoId: string;
    decimals: number;
  };
  coingeckoPlatform: string;
  // Swap configuration
  swap: {
    cdpSupported: boolean; // Does CDP SDK support swaps on this network?
  };
}

/**
 * Centralized chain configurations
 * Add new chains here to support them across the entire application
 */
export const CHAIN_CONFIGS: Record<SupportedNetwork, ChainConfig> = {
  'base': {
    name: 'Base',
    chain: base,
    rpcUrl: (alchemyKey: string) => `https://base-mainnet.g.alchemy.com/v2/${alchemyKey}`,
    explorerUrl: 'https://basescan.org',
    nativeToken: {
      symbol: 'ETH',
      name: 'Ethereum',
      coingeckoId: 'ethereum',
      decimals: 18,
    },
    coingeckoPlatform: 'base',
    swap: {
      cdpSupported: true, // CDP SDK supports Base swaps
    },
  },
  'ethereum': {
    name: 'Ethereum',
    chain: mainnet,
    rpcUrl: (alchemyKey: string) => `https://eth-mainnet.g.alchemy.com/v2/${alchemyKey}`,
    explorerUrl: 'https://etherscan.io',
    nativeToken: {
      symbol: 'ETH',
      name: 'Ethereum',
      coingeckoId: 'ethereum',
      decimals: 18,
    },
    coingeckoPlatform: 'ethereum',
    swap: {
      cdpSupported: true, // CDP SDK supports Ethereum swaps
    },
  },
  'polygon': {
    name: 'Polygon',
    chain: polygon,
    rpcUrl: (alchemyKey: string) => `https://polygon-mainnet.g.alchemy.com/v2/${alchemyKey}`,
    explorerUrl: 'https://polygonscan.com',
    nativeToken: {
      symbol: 'POL',
      name: 'Polygon',
      coingeckoId: 'polygon-ecosystem-token',
      decimals: 18,
    },
    coingeckoPlatform: 'polygon-pos',
    swap: {
      cdpSupported: false, // CDP SDK does NOT support Polygon swaps
    },
  },
  'arbitrum': {
    name: 'Arbitrum',
    chain: arbitrum,
    rpcUrl: (alchemyKey: string) => `https://arb-mainnet.g.alchemy.com/v2/${alchemyKey}`,
    explorerUrl: 'https://arbiscan.io',
    nativeToken: {
      symbol: 'ETH',
      name: 'Ethereum',
      coingeckoId: 'ethereum',
      decimals: 18,
    },
    coingeckoPlatform: 'arbitrum-one',
    swap: {
      cdpSupported: false, // CDP SDK does NOT support Arbitrum swaps
    },
  },
  'optimism': {
    name: 'Optimism',
    chain: optimism,
    rpcUrl: (alchemyKey: string) => `https://opt-mainnet.g.alchemy.com/v2/${alchemyKey}`,
    explorerUrl: 'https://optimistic.etherscan.io',
    nativeToken: {
      symbol: 'ETH',
      name: 'Ethereum',
      coingeckoId: 'ethereum',
      decimals: 18,
    },
    coingeckoPlatform: 'optimistic-ethereum',
    swap: {
      cdpSupported: false, // CDP SDK does NOT support Optimism swaps
    },
  },
  'scroll': {
    name: 'Scroll',
    chain: scroll,
    rpcUrl: (alchemyKey: string) => `https://scroll-mainnet.g.alchemy.com/v2/${alchemyKey}`,
    explorerUrl: 'https://scrollscan.com',
    nativeToken: {
      symbol: 'ETH',
      name: 'Ethereum',
      coingeckoId: 'ethereum',
      decimals: 18,
    },
    coingeckoPlatform: 'scroll',
    swap: {
      cdpSupported: false, // CDP SDK does NOT support Scroll swaps
    },
  },
  'base-sepolia': {
    name: 'Base Sepolia',
    chain: baseSepolia,
    rpcUrl: (alchemyKey: string) => `https://base-sepolia.g.alchemy.com/v2/${alchemyKey}`,
    explorerUrl: 'https://sepolia.basescan.org',
    nativeToken: {
      symbol: 'ETH',
      name: 'Ethereum',
      coingeckoId: 'ethereum',
      decimals: 18,
    },
    coingeckoPlatform: 'base',
    swap: {
      cdpSupported: false, // Testnet - no CDP swap support
    },
  },
  'ethereum-sepolia': {
    name: 'Ethereum Sepolia',
    chain: sepolia,
    rpcUrl: (alchemyKey: string) => `https://eth-sepolia.g.alchemy.com/v2/${alchemyKey}`,
    explorerUrl: 'https://sepolia.etherscan.io',
    nativeToken: {
      symbol: 'ETH',
      name: 'Ethereum',
      coingeckoId: 'ethereum',
      decimals: 18,
    },
    coingeckoPlatform: 'ethereum',
    swap: {
      cdpSupported: false, // Testnet - no CDP swap support
    },
  },
};

/**
 * Get mainnet networks only (excludes testnets)
 */
export const MAINNET_NETWORKS: SupportedNetwork[] = ['base', 'ethereum', 'polygon', 'arbitrum', 'optimism', 'scroll'];

/**
 * Get testnet networks only
 */
export const TESTNET_NETWORKS: SupportedNetwork[] = ['base-sepolia', 'ethereum-sepolia'];

/**
 * Get all supported networks
 */
export const ALL_NETWORKS: SupportedNetwork[] = Object.keys(CHAIN_CONFIGS) as SupportedNetwork[];

/**
 * Helper: Get chain config by network name
 */
export function getChainConfig(network: string): ChainConfig | null {
  return CHAIN_CONFIGS[network as SupportedNetwork] || null;
}

/**
 * Helper: Get viem chain object by network name
 */
export function getViemChain(network: string): Chain | null {
  const config = getChainConfig(network);
  return config?.chain || null;
}

/**
 * Helper: Get RPC URL for a network
 */
export function getRpcUrl(network: string, alchemyKey: string): string | null {
  const config = getChainConfig(network);
  return config ? config.rpcUrl(alchemyKey) : null;
}

/**
 * Helper: Get explorer URL for a network
 */
export function getExplorerUrl(network: string): string | null {
  const config = getChainConfig(network);
  return config?.explorerUrl || null;
}

/**
 * Helper: Get transaction explorer URL
 */
export function getTxExplorerUrl(network: string, txHash: string): string | null {
  const explorerUrl = getExplorerUrl(network);
  return explorerUrl ? `${explorerUrl}/tx/${txHash}` : null;
}

/**
 * Helper: Get address explorer URL
 */
export function getAddressExplorerUrl(network: string, address: string): string | null {
  const explorerUrl = getExplorerUrl(network);
  return explorerUrl ? `${explorerUrl}/address/${address}` : null;
}

/**
 * Helper: Get native token info for a network
 */
export function getNativeTokenInfo(network: string) {
  const config = getChainConfig(network);
  return config?.nativeToken || null;
}

/**
 * Helper: Get CoinGecko platform ID for a network
 */
export function getCoingeckoPlatform(network: string): string | null {
  const config = getChainConfig(network);
  return config?.coingeckoPlatform || null;
}

/**
 * Helper: Check if a network is supported
 */
export function isSupportedNetwork(network: string): network is SupportedNetwork {
  return network in CHAIN_CONFIGS;
}

/**
 * Helper: Check if a network is a mainnet
 */
export function isMainnet(network: string): boolean {
  return MAINNET_NETWORKS.includes(network as SupportedNetwork);
}

/**
 * Helper: Check if a network is a testnet
 */
export function isTestnet(network: string): boolean {
  return TESTNET_NETWORKS.includes(network as SupportedNetwork);
}

/**
 * Helper: Check if CDP SDK supports swaps on a network
 */
export function isCdpSwapSupported(network: string): boolean {
  const config = getChainConfig(network);
  return config?.swap.cdpSupported || false;
}

/**
 * Helper: Get networks that support CDP swaps
 */
export function getCdpSwapSupportedNetworks(): SupportedNetwork[] {
  return ALL_NETWORKS.filter(network => isCdpSwapSupported(network));
}

// ============================================================================
// Swap Protocol Constants
// ============================================================================

/**
 * Native token address used by swap protocols (0x + Ee repeated)
 * This special address represents native tokens (ETH, MATIC, etc.) in swap protocols
 */
export const NATIVE_TOKEN_ADDRESS = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';

/**
 * Normalize token address for swap protocols
 * If the token address is not a valid contract address (0x...), treat it as native token
 */
export function normalizeTokenAddress(token: string): string {
  // Check if it's already a valid contract address (0x followed by 40 hex chars)
  if (/^0x[a-fA-F0-9]{40}$/.test(token)) {
    return token;
  }
  // Otherwise, treat it as native token
  return NATIVE_TOKEN_ADDRESS;
}

/**
 * Uniswap V3 SwapRouter addresses per network
 */
export const UNISWAP_V3_ROUTER: Record<string, string> = {
  'ethereum': '0xE592427A0AEce92De3Edee1F18E0157C05861564',
  'polygon': '0xE592427A0AEce92De3Edee1F18E0157C05861564',
  'arbitrum': '0xE592427A0AEce92De3Edee1F18E0157C05861564',
  'optimism': '0xE592427A0AEce92De3Edee1F18E0157C05861564',
  'base': '0x2626664c2603336E57B271c5C0b26F421741e481',
};

/**
 * Uniswap V3 Quoter V2 addresses per network
 */
export const UNISWAP_V3_QUOTER: Record<string, string> = {
  'ethereum': '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
  'polygon': '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
  'arbitrum': '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
  'optimism': '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
  'base': '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a',
};

/**
 * Wrapped native token addresses per network
 * Uniswap V3 requires wrapped tokens for native currency swaps
 */
export const WRAPPED_NATIVE_TOKEN: Record<string, string> = {
  'ethereum': '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
  'polygon': '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',  // WMATIC
  'arbitrum': '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', // WETH
  'optimism': '0x4200000000000000000000000000000000000006', // WETH
  'base': '0x4200000000000000000000000000000000000006',     // WETH
};

/**
 * Uniswap V3 pool fee tiers (in hundredths of a bip, i.e. 1e-6)
 */
export const UNISWAP_POOL_FEES = {
  LOW: 500,      // 0.05%
  MEDIUM: 3000,  // 0.3%
  HIGH: 10000,   // 1%
};
