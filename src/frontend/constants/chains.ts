/**
 * Frontend Chain Configuration
 * 
 * Centralized configuration for blockchain networks in the UI
 */

/**
 * Supported blockchain networks
 */
export type SupportedChain = 'base' | 'ethereum' | 'polygon' | 'arbitrum' | 'optimism' | 'scroll';

/**
 * Chain UI configuration interface
 */
export interface ChainUIConfig {
  id: SupportedChain;
  name: string;
  displayName: string;
  icon: string; // Path to icon/logo
  walletIcon: string; // Path to wallet icon
  nativeToken: {
    symbol: string;
    name: string;
    icon: string; // Path to token icon
  };
  explorerUrl: string;
  color: string; // Brand color for the chain
}

/**
 * Centralized chain UI configurations
 */
export const CHAIN_UI_CONFIGS: Record<SupportedChain, ChainUIConfig> = {
  base: {
    id: 'base',
    name: 'Base',
    displayName: 'Base',
    icon: '/assets/base.svg',
    walletIcon: '/assets/walletIcon/base.svg',
    nativeToken: {
      symbol: 'ETH',
      name: 'Ethereum',
      icon: '/assets/eth.svg',
    },
    explorerUrl: 'https://basescan.org',
    color: '#0052FF', // Base blue
  },
  ethereum: {
    id: 'ethereum',
    name: 'Ethereum',
    displayName: 'Ethereum',
    icon: '/assets/eth.svg',
    walletIcon: '/assets/walletIcon/ethereum.svg',
    nativeToken: {
      symbol: 'ETH',
      name: 'Ethereum',
      icon: '/assets/eth.svg',
    },
    explorerUrl: 'https://etherscan.io',
    color: '#627EEA', // Ethereum purple
  },
  polygon: {
    id: 'polygon',
    name: 'Polygon',
    displayName: 'Polygon',
    icon: '/assets/polygon.svg',
    walletIcon: '/assets/walletIcon/polygon.svg',
    nativeToken: {
      symbol: 'POL',
      name: 'Polygon',
      icon: '/assets/polygon.svg',
    },
    explorerUrl: 'https://polygonscan.com',
    color: '#8247E5', // Polygon purple
  },
  arbitrum: {
    id: 'arbitrum',
    name: 'Arbitrum',
    displayName: 'Arbitrum',
    icon: '/assets/arbitrum.svg',
    walletIcon: '/assets/walletIcon/arbitrum.svg',
    nativeToken: {
      symbol: 'ETH',
      name: 'Ethereum',
      icon: '/assets/eth.svg',
    },
    explorerUrl: 'https://arbiscan.io',
    color: '#28A0F0', // Arbitrum blue
  },
  optimism: {
    id: 'optimism',
    name: 'Optimism',
    displayName: 'Optimism',
    icon: '/assets/optimism.svg',
    walletIcon: '/assets/walletIcon/optimism.svg',
      nativeToken: {
      symbol: 'ETH',
      name: 'Ethereum',
      icon: '/assets/eth.svg',
    },
    explorerUrl: 'https://optimistic.etherscan.io',
    color: '#FF0420', // Optimism red
  },
  scroll: {
    id: 'scroll',
    name: 'Scroll',
    displayName: 'Scroll',
    icon: '/assets/scroll.svg',
    walletIcon: '/assets/walletIcon/scroll.svg',
    nativeToken: {
      symbol: 'ETH',
      name: 'Ethereum',
      icon: '/assets/eth.svg',
    },
    explorerUrl: 'https://scrollscan.com',
    color: '#FFEEDA', // Scroll beige
  },
};

/**
 * All supported chains as an array
 */
export const SUPPORTED_CHAINS: SupportedChain[] = Object.keys(CHAIN_UI_CONFIGS) as SupportedChain[];

/**
 * Helper: Get chain config by chain name
 */
export function getChainConfig(chain: string): ChainUIConfig | null {
  return CHAIN_UI_CONFIGS[chain as SupportedChain] || null;
}

/**
 * Helper: Get chain icon path
 */
export function getChainIcon(chain: string): string | null {
  const config = getChainConfig(chain);
  return config?.icon || null;
}

/**
 * Helper: Get chain wallet icon path
 */
export function getChainWalletIcon(chain: string): string | null {
  const config = getChainConfig(chain);
  return config?.walletIcon || null;
}
/**
 * Helper: Get native token icon path by chain
 */
export function getNativeTokenIcon(chain: string): string | null {
  const config = getChainConfig(chain);
  return config?.nativeToken.icon || null;
}

/**
 * Helper: Get native token symbol by chain
 */
export function getNativeTokenSymbol(chain: string): string | null {
  const config = getChainConfig(chain);
  return config?.nativeToken.symbol || null;
}

/**
 * Helper: Get chain color
 */
export function getChainColor(chain: string): string {
  const config = getChainConfig(chain);
  return config?.color || '#6B7280'; // Default gray
}

/**
 * Helper: Get transaction explorer URL
 */
export function getTxExplorerUrl(chain: string, txHash: string): string | null {
  const config = getChainConfig(chain);
  return config ? `${config.explorerUrl}/tx/${txHash}` : null;
}

/**
 * Helper: Get address explorer URL
 */
export function getAddressExplorerUrl(chain: string, address: string): string | null {
  const config = getChainConfig(chain);
  return config ? `${config.explorerUrl}/address/${address}` : null;
}

/**
 * Helper: Check if a chain is supported
 */
export function isSupportedChain(chain: string): chain is SupportedChain {
  return chain in CHAIN_UI_CONFIGS;
}

/**
 * Helper: Get chain display name
 */
export function getChainDisplayName(chain: string): string {
  const config = getChainConfig(chain);
  return config?.displayName || chain;
}

/**
 * Token icon mapping for common tokens
 * Maps token symbol to icon path
 */
export const TOKEN_ICONS: Record<string, string> = {
  ETH: '/assets/eth.svg',
  WETH: '/assets/eth.svg',
  MATIC: '/assets/polygon.svg',
  POL: '/assets/polygon.svg',
  // Add more common tokens as needed
  USDC: '/assets/usdc.svg',
  USDT: '/assets/usdt.svg',
  DAI: '/assets/dai.svg',
};

/**
 * Helper: Get token icon by symbol
 * Returns null if no icon is available (will use fallback in component)
 */
export function getTokenIconBySymbol(symbol: string): string | null {
  return TOKEN_ICONS[symbol.toUpperCase()] || null;
}

/**
 * Helper: Get token icon by symbol or chain
 * First tries to get from TOKEN_ICONS, then falls back to native token icon
 */
export function getTokenIcon(symbol: string, chain?: string): string | null {
  // Try to get from common token icons first
  const tokenIcon = getTokenIconBySymbol(symbol);
  if (tokenIcon) return tokenIcon;

  // Fall back to native token icon if chain is provided
  if (chain) {
    return getNativeTokenIcon(chain);
  }

  return null;
}

