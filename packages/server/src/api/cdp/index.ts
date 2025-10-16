import express from 'express';
import { logger } from '@elizaos/core';
import { CdpClient } from '@coinbase/cdp-sdk';
import type { AgentServer } from '../../index';
import { sendError, sendSuccess } from '../shared/response-utils';
import { createWalletClient, http } from 'viem';
import { toAccount } from 'viem/accounts';
import {
  MAINNET_NETWORKS,
  getChainConfig,
  getViemChain,
  getRpcUrl,
  isCdpSwapSupported,
} from '../../constants/chains';

// Native token address used by swap protocols (0x + Ee repeated)
// This special address represents native tokens (ETH, MATIC, etc.) in swap protocols
export const NATIVE_TOKEN_ADDRESS = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';

/**
 * Normalize token address for swap protocols
 * If the token address is not a valid contract address (0x...), treat it as native token
 */
function normalizeTokenAddress(token: string): string {
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
const UNISWAP_V3_ROUTER: Record<string, string> = {
  'ethereum': '0xE592427A0AEce92De3Edee1F18E0157C05861564',
  'polygon': '0xE592427A0AEce92De3Edee1F18E0157C05861564',
  'arbitrum': '0xE592427A0AEce92De3Edee1F18E0157C05861564',
  'optimism': '0xE592427A0AEce92De3Edee1F18E0157C05861564',
  'base': '0x2626664c2603336E57B271c5C0b26F421741e481',
};

/**
 * Wrapped native token addresses per network
 * Uniswap V3 requires wrapped tokens for native currency swaps
 */
const WRAPPED_NATIVE_TOKEN: Record<string, string> = {
  'ethereum': '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
  'polygon': '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',  // WMATIC
  'arbitrum': '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', // WETH
  'optimism': '0x4200000000000000000000000000000000000006', // WETH
  'base': '0x4200000000000000000000000000000000000006',     // WETH
};

/**
 * Uniswap V3 pool fee tiers (in hundredths of a bip, i.e. 1e-6)
 */
const UNISWAP_POOL_FEES = {
  LOW: 500,      // 0.05%
  MEDIUM: 3000,  // 0.3%
  HIGH: 10000,   // 1%
};

/**
 * Check if a token needs approval and approve if necessary
 */
async function ensureTokenApproval(
  walletClient: any,
  publicClient: any,
  tokenAddress: string,
  spenderAddress: string,
  amount: bigint,
  ownerAddress: string
): Promise<void> {
  // Native token doesn't need approval
  if (tokenAddress === NATIVE_TOKEN_ADDRESS) {
    return;
  }

  // ERC20 allowance ABI
  const allowanceAbi = [
    {
      name: 'allowance',
      type: 'function',
      stateMutability: 'view',
      inputs: [
        { name: 'owner', type: 'address' },
        { name: 'spender', type: 'address' }
      ],
      outputs: [{ name: '', type: 'uint256' }]
    }
  ] as const;

  // Check current allowance
  const currentAllowance = await publicClient.readContract({
    address: tokenAddress as `0x${string}`,
    abi: allowanceAbi,
    functionName: 'allowance',
    args: [ownerAddress as `0x${string}`, spenderAddress as `0x${string}`],
  });

  // If allowance is sufficient, no need to approve
  if (currentAllowance >= amount) {
    logger.debug(`[CDP API] Token ${tokenAddress} already approved`);
    return;
  }

  logger.info(`[CDP API] Approving token ${tokenAddress} for ${spenderAddress}`);

  // ERC20 approve ABI
  const approveAbi = [
    {
      name: 'approve',
      type: 'function',
      stateMutability: 'nonpayable',
      inputs: [
        { name: 'spender', type: 'address' },
        { name: 'amount', type: 'uint256' }
      ],
      outputs: [{ name: '', type: 'bool' }]
    }
  ] as const;

  // Approve max uint256 for convenience
  const maxUint256 = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
  
  const hash = await walletClient.writeContract({
    address: tokenAddress as `0x${string}`,
    abi: approveAbi,
    functionName: 'approve',
    args: [spenderAddress as `0x${string}`, maxUint256],
  });

  // Wait for approval transaction
  await publicClient.waitForTransactionReceipt({ hash });
  logger.info(`[CDP API] Token approval successful: ${hash}`);
}

// Singleton CDP client instance
let cdpClient: CdpClient | null = null;

/**
 * Initialize CDP client with environment variables
 */
function getCdpClient(): CdpClient | null {
  if (cdpClient) {
    return cdpClient;
  }

  const apiKeyId = process.env.COINBASE_API_KEY_NAME || process.env.CDP_API_KEY_ID;
  const apiKeySecret = process.env.COINBASE_PRIVATE_KEY || process.env.CDP_API_KEY_SECRET;
  const walletSecret = process.env.COINBASE_WALLET_SECRET;

  if (!apiKeyId || !apiKeySecret || !walletSecret) {
    logger.warn('[CDP API] Missing CDP credentials in environment variables');
    return null;
  }

  try {
    cdpClient = new CdpClient({
      apiKeyId,
      apiKeySecret,
      walletSecret,
    });
    logger.info('[CDP API] CDP client initialized successfully');
    return cdpClient;
  } catch (error) {
    logger.error('[CDP API] Failed to initialize CDP client:', error instanceof Error ? error.message : String(error));
    return null;
  }
}

/**
 * Fetch token info (price and icon) from CoinGecko Pro API
 */
async function getTokenInfo(contractAddress: string, platform: string): Promise<{
  price: number;
  icon?: string;
  name?: string;
  symbol?: string;
  decimals?: number;
} | null> {
  const apiKey = process.env.COINGECKO_API_KEY;
  if (!apiKey) {
    logger.warn('[CDP API] CoinGecko API key not configured');
    return null;
  }

  try {
    // Use the full coin endpoint to get price, icon, and metadata
    const url = `https://pro-api.coingecko.com/api/v3/coins/${platform}/contract/${contractAddress}`;
    const response = await fetch(url, {
      headers: {
        'x-cg-pro-api-key': apiKey,
        'Accept': 'application/json',
      },
    });

    if (response.ok) {
      const data = await response.json();
      return {
        price: data.market_data?.current_price?.usd || 0,
        icon: data.image?.small, // Small icon URL
        name: data.name || undefined,
        symbol: data.symbol?.toUpperCase() || undefined,
        decimals: data.detail_platforms?.[platform]?.decimal_place || 18,
      };
    }
  } catch (err) {
    logger.warn(`[CDP API] Failed to fetch token info for ${contractAddress}:`, err instanceof Error ? err.message : String(err));
  }

  return null;
}

/**
 * Fetch token info from DexScreener
 */
async function getTokenInfoFromDexScreener(address: string, chainId: string): Promise<{
  price?: number;
  liquidity?: number;
  volume24h?: number;
  priceChange24h?: number;
  name?: string;
  symbol?: string;
} | null> {
  try {
    const url = `https://api.dexscreener.com/latest/dex/tokens/${address}`;
    const response = await fetch(url);
    
    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    const pairs = data.pairs || [];
    
    // Find pair for the specific chain
    const pair = pairs.find((p: any) => p.chainId === chainId);
    
    if (!pair) {
      return null;
    }

    return {
      price: parseFloat(pair.priceUsd) || undefined,
      liquidity: parseFloat(pair.liquidity?.usd) || undefined,
      volume24h: parseFloat(pair.volume?.h24) || undefined,
      priceChange24h: parseFloat(pair.priceChange?.h24) || undefined,
      name: pair.baseToken?.name || undefined,
      symbol: pair.baseToken?.symbol || undefined,
    };
  } catch (err) {
    logger.warn(`[CDP API] DexScreener error for ${address}:`, err instanceof Error ? err.message : String(err));
    return null;
  }
}

/**
 * Fetch native token price from CoinGecko Pro API
 */
async function getNativeTokenPrice(coingeckoId: string): Promise<number> {
  const apiKey = process.env.COINGECKO_API_KEY;
  if (!apiKey) {
    logger.warn('[CDP API] CoinGecko API key not configured');
    return 0;
  }

  try {
    const url = `https://pro-api.coingecko.com/api/v3/simple/price?ids=${coingeckoId}&vs_currencies=usd`;
    const response = await fetch(url, {
      headers: {
        'x-cg-pro-api-key': apiKey,
        'Accept': 'application/json',
      },
    });

    if (response.ok) {
      const data = await response.json();
      return data[coingeckoId]?.usd || 0;
    }
  } catch (err) {
    logger.warn(`[CDP API] Failed to fetch native token price for ${coingeckoId}:`, err instanceof Error ? err.message : String(err));
  }

  return 0;
}


export function cdpRouter(_serverInstance: AgentServer): express.Router {
  const router = express.Router();

  /**
   * POST /api/cdp/wallet
   * Get or create server wallet for a user
   */
  router.post('/wallet', async (req, res) => {
    try {
      const { name } = req.body;

      if (!name || typeof name !== 'string') {
        return sendError(res, 400, 'INVALID_REQUEST', 'Name is required and must be a string');
      }

      const client = getCdpClient();
      if (!client) {
        return sendError(res, 503, 'SERVICE_UNAVAILABLE', 'CDP client not initialized. Check environment variables.');
      }

      logger.info(`[CDP API] Getting/creating wallet for user: ${name}`);

      const account = await client.evm.getOrCreateAccount({ name });
      const address = account.address;

      logger.info(`[CDP API] Wallet ready: ${address} (user: ${name})`);

      sendSuccess(res, {
        address,
        accountName: name,
      });
    } catch (error) {
      logger.error(
        '[CDP API] Error with wallet:',
        error instanceof Error ? error.message : String(error)
      );
      sendError(
        res,
        500,
        'WALLET_FAILED',
        'Failed to get/create wallet',
        error instanceof Error ? error.message : String(error)
      );
    }
  });

  /**
   * Helper function to safely convert BigInt balance to number
   */
  const safeBalanceToNumber = (balanceHex: string, decimals: number): number => {
    try {
      const balance = BigInt(balanceHex);
      // Convert to string first, then do division to avoid Number overflow
      const balanceStr = balance.toString();
      const decimalPoint = balanceStr.length - decimals;
      
      if (decimalPoint <= 0) {
        // Very small number (0.00xxx)
        const zeros = '0'.repeat(Math.abs(decimalPoint));
        return parseFloat(`0.${zeros}${balanceStr}`);
      } else {
        // Normal number
        const intPart = balanceStr.slice(0, decimalPoint);
        const fracPart = balanceStr.slice(decimalPoint);
        return parseFloat(`${intPart}.${fracPart}`);
      }
    } catch (err) {
      logger.warn(`[CDP API] Error converting balance ${balanceHex} with ${decimals} decimals:`, err instanceof Error ? err.message : String(err));
      return 0;
    }
  };

  /**
   * GET /api/cdp/wallet/tokens/:name
   * Get token balances across all networks
   */
  router.get('/wallet/tokens/:name', async (req, res) => {
    try {
      const { name } = req.params;

      if (!name || typeof name !== 'string') {
        return sendError(res, 400, 'INVALID_REQUEST', 'Name is required');
      }

      const client = getCdpClient();
      if (!client) {
        return sendError(res, 503, 'SERVICE_UNAVAILABLE', 'CDP client not initialized.');
      }

      logger.info(`[CDP API] Fetching token balances for user: ${name}`);

      const account = await client.evm.getOrCreateAccount({ name });
      const address = account.address;
      const alchemyKey = process.env.ALCHEMY_API_KEY;
      
      if (!alchemyKey) {
        return sendError(res, 503, 'SERVICE_UNAVAILABLE', 'Alchemy API key not configured');
      }

      const allTokens: any[] = [];
      let totalUsdValue = 0;

      for (const network of MAINNET_NETWORKS) {
        try {
          const chainConfig = getChainConfig(network);
          if (!chainConfig) {
            logger.warn(`[CDP API] Unsupported network: ${network}`);
            continue;
          }

          const rpcUrl = chainConfig.rpcUrl(alchemyKey);

          // Step 1: Fetch native token balance
          const nativeResponse = await fetch(rpcUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              method: 'eth_getBalance',
              params: [address, 'latest'],
            }),
          });

          const nativeJson = await nativeResponse.json();
          const nativeBalance = BigInt(nativeJson.result || '0');

          // Add native token if balance > 0
          if (nativeBalance > 0n) {
            const amountNum = safeBalanceToNumber('0x' + nativeBalance.toString(16), chainConfig.nativeToken.decimals);
            const usdPrice = await getNativeTokenPrice(chainConfig.nativeToken.coingeckoId);
            const usdValue = amountNum * usdPrice;
            
            // Only add to total if it's a valid number
            if (!isNaN(usdValue)) {
              totalUsdValue += usdValue;
            }

            allTokens.push({
              symbol: chainConfig.nativeToken.symbol,
              name: chainConfig.nativeToken.name,
              balance: isNaN(amountNum) ? '0' : amountNum.toString(),
              balanceFormatted: isNaN(amountNum) ? '0' : amountNum.toFixed(6).replace(/\.?0+$/, ''),
              usdValue: isNaN(usdValue) ? 0 : usdValue,
              usdPrice: isNaN(usdPrice) ? 0 : usdPrice,
              contractAddress: null,
              chain: network,
              decimals: chainConfig.nativeToken.decimals,
              icon: undefined,
            });
          }

          // Step 2: Fetch ERC20 token balances using Alchemy
          const tokensResponse = await fetch(rpcUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 2,
              method: 'alchemy_getTokenBalances',
              params: [address],
            }),
          });

          if (!tokensResponse.ok) {
            logger.warn(`[CDP API] Failed to fetch tokens for ${network}: ${tokensResponse.status}`);
            continue;
          }

          const tokensJson = await tokensResponse.json();
          if (tokensJson.error) {
            logger.warn(`[CDP API] RPC error for ${network}:`, tokensJson.error);
            continue;
          }

          const tokenBalances = tokensJson?.result?.tokenBalances || [];

          // Step 3: Process ERC20 tokens
          for (const tokenBalance of tokenBalances) {
            try {
              const contractAddress = tokenBalance.contractAddress;
              const tokenBalanceHex = tokenBalance.tokenBalance;
              
              // Skip tokens with 0 balance
              if (!tokenBalanceHex || BigInt(tokenBalanceHex) === 0n) continue;
              
              // Get token info from CoinGecko
              const platform = chainConfig.coingeckoPlatform;
              let tokenInfo = await getTokenInfo(contractAddress, platform);
              let usdPrice = 0;
              
              if (!tokenInfo) {
                // Try DexScreener as fallback
                const dexInfo = await getTokenInfoFromDexScreener(contractAddress, network);
                if (dexInfo?.price) {
                  usdPrice = dexInfo.price;
                  // Use DexScreener data with token metadata
                  const amountNum = safeBalanceToNumber(tokenBalanceHex, 18); // Assume 18 decimals
                  const usdValue = amountNum * usdPrice;
                  
                  // Only add to total if it's a valid number
                  if (!isNaN(usdValue)) {
                    totalUsdValue += usdValue;
                  }
                  
                  allTokens.push({
                    symbol: dexInfo.symbol?.toUpperCase() || 'UNKNOWN',
                    name: dexInfo.name || 'Unknown Token',
                    balance: isNaN(amountNum) ? '0' : amountNum.toString(),
                    balanceFormatted: isNaN(amountNum) ? '0' : amountNum.toFixed(6).replace(/\.?0+$/, ''),
                    usdValue: isNaN(usdValue) ? 0 : usdValue,
                    usdPrice: isNaN(usdPrice) ? 0 : usdPrice,
                    contractAddress,
                    chain: network,
                    decimals: 18,
                    icon: undefined,
                  });
                } else {
                  logger.debug(`[CDP API] Could not get price for token ${contractAddress} on ${network}`);
                }
                continue;
              }
              
              // Use token info price, fallback to 0 if null
              usdPrice = tokenInfo.price || 0;
              
              // Convert balance using correct decimals
              const amountNum = safeBalanceToNumber(tokenBalanceHex, tokenInfo.decimals || 18);
              const usdValue = amountNum * usdPrice;
              
              // Only add to total if it's a valid number
              if (!isNaN(usdValue)) {
                totalUsdValue += usdValue;
              }
              
              allTokens.push({
                symbol: tokenInfo.symbol || 'UNKNOWN',
                name: tokenInfo.name || 'Unknown Token',
                balance: isNaN(amountNum) ? '0' : amountNum.toString(),
                balanceFormatted: isNaN(amountNum) ? '0' : amountNum.toFixed(6).replace(/\.?0+$/, ''),
                usdValue: isNaN(usdValue) ? 0 : usdValue,
                usdPrice: isNaN(usdPrice) ? 0 : usdPrice,
                contractAddress,
                chain: network,
                decimals: tokenInfo.decimals || 18,
                icon: tokenInfo.icon,
              });
            } catch (err) {
              logger.warn(`[CDP API] Error processing token ${tokenBalance.contractAddress} on ${network}:`, err instanceof Error ? err.message : String(err));
            }
          }
        } catch (err) {
          logger.warn(`[CDP API] Failed to fetch balances for ${network}:`, err instanceof Error ? err.message : String(err));
        }
      }

      // Ensure totalUsdValue is a valid number
      const finalTotalUsdValue = isNaN(totalUsdValue) ? 0 : totalUsdValue;
      
      logger.info(`[CDP API] Found ${allTokens.length} tokens for user ${name}, total value: $${finalTotalUsdValue.toFixed(2)}`);

      sendSuccess(res, {
        tokens: allTokens,
        totalUsdValue: finalTotalUsdValue,
        address: account.address,
      });
    } catch (error) {
      logger.error(
        '[CDP API] Error fetching tokens:',
        error instanceof Error ? error.message : String(error)
      );
      sendError(
        res,
        500,
        'FETCH_TOKENS_FAILED',
        'Failed to fetch token balances',
        error instanceof Error ? error.message : String(error)
      );
    }
  });

  /**
   * GET /api/cdp/wallet/nfts/:name
   * Get NFT holdings across networks using Alchemy API
   */
  router.get('/wallet/nfts/:name', async (req, res) => {
    try {
      const { name } = req.params;

      if (!name || typeof name !== 'string') {
        return sendError(res, 400, 'INVALID_REQUEST', 'Name is required');
      }

      const client = getCdpClient();
      if (!client) {
        return sendError(res, 503, 'SERVICE_UNAVAILABLE', 'CDP client not initialized.');
      }

      const alchemyKey = process.env.ALCHEMY_API_KEY;
      if (!alchemyKey) {
        return sendError(res, 503, 'SERVICE_UNAVAILABLE', 'Alchemy API key not configured');
      }

      logger.info(`[CDP API] Fetching NFTs for user: ${name}`);

      const account = await client.evm.getOrCreateAccount({ name });
      const address = account.address;

      // Fetch NFTs from all mainnet networks using Alchemy REST API
      const networks = MAINNET_NETWORKS.map(network => {
        const config = getChainConfig(network);
        const baseUrl = config?.rpcUrl(alchemyKey).replace('/v2/', '/nft/v3/');
        return {
          name: network,
          url: `${baseUrl}/getNFTsForOwner?owner=${address}&withMetadata=true&pageSize=100`
        };
      });

      const allNfts: any[] = [];

      for (const network of networks) {
        try {
          const response = await fetch(network.url);
          
          if (!response.ok) {
            logger.warn(`[CDP API] Failed to fetch NFTs for ${network.name}: ${response.status}`);
            continue;
          }

          const data = await response.json();
          const nfts = data.ownedNfts || [];

          for (const nft of nfts) {
            const metadata = nft.raw?.metadata || {};
            const tokenId = nft.tokenId;
            const contractAddress = nft.contract?.address;
            
            // Get image URL and handle IPFS
            let imageUrl = metadata.image || nft.image?.cachedUrl || nft.image?.originalUrl || nft.image?.thumbnailUrl || '';
            if (imageUrl && imageUrl.startsWith('ipfs://')) {
              imageUrl = imageUrl.replace('ipfs://', 'https://ipfs.io/ipfs/');
            }

            allNfts.push({
              chain: network.name,
              contractAddress,
              tokenId,
              name: metadata.name || nft.name || `${nft.contract?.name || 'Unknown'} #${tokenId}`,
              description: metadata.description || nft.description || '',
              image: imageUrl,
              contractName: nft.contract?.name || nft.contract?.symbol || 'Unknown Collection',
              tokenType: nft.contract?.tokenType || 'ERC721',
              balance: nft.balance, // For ERC1155
              attributes: metadata.attributes || [], // NFT attributes/traits
            });
          }
        } catch (err) {
          logger.warn(`[CDP API] Error fetching NFTs for ${network.name}:`, err instanceof Error ? err.message : String(err));
        }
      }

      logger.info(`[CDP API] Found ${allNfts.length} NFTs for user ${name}`);

      sendSuccess(res, {
        nfts: allNfts,
        address,
      });
    } catch (error) {
      logger.error(
        '[CDP API] Error fetching NFTs:',
        error instanceof Error ? error.message : String(error)
      );
      sendError(
        res,
        500,
        'FETCH_NFTS_FAILED',
        'Failed to fetch NFTs',
        error instanceof Error ? error.message : String(error)
      );
    }
  });

  /**
   * GET /api/cdp/wallet/history/:name
   * Get transaction history across networks using Alchemy API
   */
  router.get('/wallet/history/:name', async (req, res) => {
    try {
      const { name } = req.params;

      if (!name || typeof name !== 'string') {
        return sendError(res, 400, 'INVALID_REQUEST', 'Name is required');
      }

      const client = getCdpClient();
      if (!client) {
        return sendError(res, 503, 'SERVICE_UNAVAILABLE', 'CDP client not initialized.');
      }

      const alchemyKey = process.env.ALCHEMY_API_KEY;
      if (!alchemyKey) {
        return sendError(res, 503, 'SERVICE_UNAVAILABLE', 'Alchemy API key not configured');
      }

      logger.info(`[CDP API] Fetching transaction history for user: ${name}`);

      const account = await client.evm.getOrCreateAccount({ name });
      const address = account.address;

      // Fetch transactions from all mainnet networks
      const networks = MAINNET_NETWORKS.map(network => {
        const config = getChainConfig(network);
        return {
          name: network,
          rpc: config?.rpcUrl(alchemyKey) || '',
          explorer: config?.explorerUrl || '',
        };
      }).filter(n => n.rpc && n.explorer);

      const allTransactions: any[] = [];

      for (const network of networks) {
        try {
          // Fetch sent transactions (fromAddress)
          const sentResponse = await fetch(network.rpc, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              method: 'alchemy_getAssetTransfers',
              params: [{
                fromAddress: address,
                category: ['external', 'erc20', 'erc721', 'erc1155'],
                maxCount: '0x19', // 25 transactions
                withMetadata: true,
                excludeZeroValue: false,
              }],
            }),
          });

          // Fetch received transactions (toAddress)
          const receivedResponse = await fetch(network.rpc, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 2,
              method: 'alchemy_getAssetTransfers',
              params: [{
                toAddress: address,
                category: ['external', 'erc20', 'erc721', 'erc1155'],
                maxCount: '0x19', // 25 transactions
                withMetadata: true,
                excludeZeroValue: false,
              }],
            }),
          });

          if (sentResponse.ok) {
            const sentData = await sentResponse.json();
            if (sentData.error) {
              logger.warn(`[CDP API] ${network.name} sent transactions error:`, sentData.error);
            } else {
              const sentTransfers = sentData?.result?.transfers || [];
              for (const tx of sentTransfers) {
                const timestamp = tx.metadata?.blockTimestamp ? new Date(tx.metadata.blockTimestamp).getTime() : Date.now();
                allTransactions.push({
                  chain: network.name,
                  hash: tx.hash,
                  from: tx.from,
                  to: tx.to,
                  value: tx.value?.toString() || '0',
                  asset: tx.asset || 'ETH',
                  category: tx.category,
                  timestamp,
                  blockNum: tx.blockNum,
                  explorerUrl: `${network.explorer}/tx/${tx.hash}`,
                  direction: 'sent',
                });
              }
            }
          } else {
            logger.warn(`[CDP API] ${network.name} sent transactions: HTTP ${sentResponse.status}`);
          }

          if (receivedResponse.ok) {
            const receivedData = await receivedResponse.json();
            if (receivedData.error) {
              logger.warn(`[CDP API] ${network.name} received transactions error:`, receivedData.error);
            } else {
              const receivedTransfers = receivedData?.result?.transfers || [];
              for (const tx of receivedTransfers) {
                const timestamp = tx.metadata?.blockTimestamp ? new Date(tx.metadata.blockTimestamp).getTime() : Date.now();
                allTransactions.push({
                  chain: network.name,
                  hash: tx.hash,
                  from: tx.from,
                  to: tx.to,
                  value: tx.value?.toString() || '0',
                  asset: tx.asset || 'ETH',
                  category: tx.category,
                  timestamp,
                  blockNum: tx.blockNum,
                  explorerUrl: `${network.explorer}/tx/${tx.hash}`,
                  direction: 'received',
                });
              }
            }
          } else {
            logger.warn(`[CDP API] ${network.name} received transactions: HTTP ${receivedResponse.status}`);
          }
        } catch (err) {
          logger.warn(`[CDP API] Error fetching history for ${network.name}:`, err instanceof Error ? err.message : String(err));
        }
      }

      // Sort by timestamp descending (most recent first)
      allTransactions.sort((a, b) => b.timestamp - a.timestamp);

      logger.info(`[CDP API] Found ${allTransactions.length} transactions for user ${name}`);

      sendSuccess(res, {
        transactions: allTransactions,
        address,
      });
    } catch (error) {
      logger.error(
        '[CDP API] Error fetching history:',
        error instanceof Error ? error.message : String(error)
      );
      sendError(
        res,
        500,
        'FETCH_HISTORY_FAILED',
        'Failed to fetch transaction history',
        error instanceof Error ? error.message : String(error)
      );
    }
  });

  /**
   * POST /api/cdp/wallet/send
   * Send tokens from server wallet with fallback to viem
   */
  router.post('/wallet/send', async (req, res) => {
    try {
      const { name, network, to, token, amount } = req.body;

      if (!name || !network || !to || !token || !amount) {
        return sendError(res, 400, 'INVALID_REQUEST', 'Missing required fields: name, network, to, token, amount');
      }

      const client = getCdpClient();
      if (!client) {
        return sendError(res, 503, 'SERVICE_UNAVAILABLE', 'CDP client not initialized.');
      }

      logger.info(`[CDP API] Sending ${amount} ${token} to ${to} on ${network} for user ${name}`);

      // Try CDP SDK first
      let cdpSuccess = false;
      let transactionHash: string | undefined;
      let fromAddress: string;

      try {
        logger.info(`[CDP API] Attempting transfer with CDP SDK...`);
        const account = await client.evm.getOrCreateAccount({ name });
        const networkAccount = await account.useNetwork(network);
        fromAddress = account.address;

        // Convert amount to bigint (assuming it's already in base units with decimals)
        const amountBigInt = BigInt(amount);

        const result = await networkAccount.transfer({
          to: to as `0x${string}`,
          amount: amountBigInt,
          token: token as any,
        });

        if (result.transactionHash) {
          transactionHash = result.transactionHash;
          cdpSuccess = true;
          logger.info(`[CDP API] CDP SDK transfer successful: ${transactionHash}`);
        }
      } catch (cdpError) {
        logger.warn(
          `[CDP API] CDP SDK transfer failed, trying viem fallback:`,
          cdpError instanceof Error ? cdpError.message : String(cdpError)
        );

        // Fallback to viem
        logger.info(`[CDP API] Using viem fallback for transfer...`);
        
        const chain = getViemChain(network);
        if (!chain) {
          throw new Error(`Unsupported network: ${network}`);
        }

        // Get wallet from CDP
        const account = await client.evm.getOrCreateAccount({ name });
        fromAddress = account.address;

        // Get Alchemy key for RPC
        const alchemyKey = process.env.ALCHEMY_API_KEY;
        if (!alchemyKey) {
          throw new Error('Alchemy API key not configured');
        }

        const rpcUrl = getRpcUrl(network, alchemyKey);
        if (!rpcUrl) {
          throw new Error(`Could not get RPC URL for network: ${network}`);
        }

        // Create wallet client
        const walletClient = createWalletClient({
          account: toAccount(account),
          chain,
          transport: http(rpcUrl),
        });

        const amountBigInt = BigInt(amount);

        // Check if it's a native token or ERC20
        const isNativeToken = !token.startsWith('0x');
        
        if (isNativeToken) {
          // Native token transfer (ETH, MATIC, etc.)
          logger.info(`[CDP API] Sending native token via viem...`);
          const hash = await walletClient.sendTransaction({
            chain,
            to: to as `0x${string}`,
            value: amountBigInt,
          });
          transactionHash = hash;
        } else {
          // ERC20 token transfer
          logger.info(`[CDP API] Sending ERC20 token ${token} via viem...`);
          
          // ERC20 transfer function
          const hash = await walletClient.writeContract({
            chain,
            address: token as `0x${string}`,
            abi: [
              {
                name: 'transfer',
                type: 'function',
                stateMutability: 'nonpayable',
                inputs: [
                  { name: 'to', type: 'address' },
                  { name: 'amount', type: 'uint256' }
                ],
                outputs: [{ name: '', type: 'bool' }]
              }
            ] as const,
            functionName: 'transfer',
            args: [to as `0x${string}`, amountBigInt],
          });
          transactionHash = hash;
        }

        logger.info(`[CDP API] Viem transfer successful: ${transactionHash}`);
      }

      if (!transactionHash) {
        throw new Error('Transfer did not return a transaction hash');
      }

      sendSuccess(res, {
        transactionHash,
        from: fromAddress!,
        to,
        amount: amount.toString(),
        token,
        network,
        method: cdpSuccess ? 'cdp-sdk' : 'viem-fallback',
      });
    } catch (error) {
      logger.error(
        '[CDP API] Error sending tokens:',
        error instanceof Error ? error.message : String(error)
      );
      sendError(
        res,
        500,
        'SEND_FAILED',
        'Failed to send tokens',
        error instanceof Error ? error.message : String(error)
      );
    }
  });

  /**
   * POST /api/cdp/wallet/send-nft
   * Send NFT from server wallet using viem
   */
  router.post('/wallet/send-nft', async (req, res) => {
    try {
      const { name, network, to, contractAddress, tokenId } = req.body;

      if (!name || !network || !to || !contractAddress || !tokenId) {
        return sendError(res, 400, 'INVALID_REQUEST', 'Missing required fields: name, network, to, contractAddress, tokenId');
      }

      const client = getCdpClient();
      if (!client) {
        return sendError(res, 503, 'SERVICE_UNAVAILABLE', 'CDP client not initialized.');
      }

      logger.info(`[CDP API] Sending NFT ${contractAddress}:${tokenId} to ${to} on ${network} for user ${name}`);

      const account = await client.evm.getOrCreateAccount({ name });
      
      // Use viem to send the NFT transaction
      const { createWalletClient, createPublicClient, http } = await import('viem');
      const { toAccount } = await import('viem/accounts');
      
      const chain = getViemChain(network);
      if (!chain) {
        return sendError(res, 400, 'INVALID_NETWORK', `Unsupported network: ${network}`);
      }
      
      const alchemyKey = process.env.ALCHEMY_API_KEY;
      if (!alchemyKey) {
        return sendError(res, 503, 'SERVICE_UNAVAILABLE', 'Alchemy API key not configured');
      }
      
      const rpcUrl = getRpcUrl(network, alchemyKey);
      if (!rpcUrl) {
        return sendError(res, 400, 'INVALID_NETWORK', `Could not get RPC URL for network: ${network}`);
      }
      
      const walletClient = createWalletClient({
        account: toAccount(account),
        chain,
        transport: http(rpcUrl),
      });
      
      const publicClient = createPublicClient({
        chain,
        transport: http(rpcUrl),
      });

      // ERC721 safeTransferFrom ABI
      const erc721Abi = [
        {
          name: 'safeTransferFrom',
          type: 'function',
          stateMutability: 'nonpayable',
          inputs: [
            { name: 'from', type: 'address' },
            { name: 'to', type: 'address' },
            { name: 'tokenId', type: 'uint256' }
          ],
          outputs: []
        }
      ] as const;

      const txHash = await walletClient.writeContract({
        address: contractAddress as `0x${string}`,
        abi: erc721Abi,
        functionName: 'safeTransferFrom',
        args: [account.address as `0x${string}`, to as `0x${string}`, BigInt(tokenId)],
        chain,
      });

      // Wait for transaction confirmation
      await publicClient.waitForTransactionReceipt({ hash: txHash });

      logger.info(`[CDP API] NFT transfer successful: ${txHash}`);

      sendSuccess(res, {
        transactionHash: txHash,
        from: account.address,
        to,
        contractAddress,
        tokenId,
        network,
      });
    } catch (error) {
      logger.error(
        '[CDP API] Error sending NFT:',
        error instanceof Error ? error.message : String(error)
      );
      sendError(
        res,
        500,
        'SEND_NFT_FAILED',
        'Failed to send NFT',
        error instanceof Error ? error.message : String(error)
      );
    }
  });

  /**
   * POST /api/cdp/wallet/swap-price
   * Get swap price estimate (CDP SDK only for supported networks)
   * Non-CDP networks: price estimation not available, will execute swap directly
   */
  router.post('/wallet/swap-price', async (req, res) => {
    try {
      const { name, network, fromToken, toToken, fromAmount } = req.body;

      if (!name || !network || !fromToken || !toToken || !fromAmount) {
        return sendError(res, 400, 'INVALID_REQUEST', 'Missing required fields: name, network, fromToken, toToken, fromAmount');
      }

      const client = getCdpClient();
      if (!client) {
        return sendError(res, 503, 'SERVICE_UNAVAILABLE', 'CDP client not initialized.');
      }

      logger.info(`[CDP API] Getting swap price for ${fromAmount} ${fromToken} to ${toToken} on ${network} for user ${name}`);

      const account = await client.evm.getOrCreateAccount({ name });

      // Normalize token addresses (convert native token symbols to NATIVE_TOKEN_ADDRESS)
      const normalizedFromToken = normalizeTokenAddress(fromToken);
      const normalizedToToken = normalizeTokenAddress(toToken);

      logger.debug(`[CDP API] Normalized tokens: ${normalizedFromToken} -> ${normalizedToToken}`);

      let swapPriceResult;

      // Check if CDP SDK supports swaps on this network
      if (isCdpSwapSupported(network)) {
        logger.info(`[CDP API] Using CDP SDK for swap price on ${network}`);
        
        // Use CDP SDK
        const swapPrice = await client.evm.getSwapPrice({
          fromToken: normalizedFromToken as `0x${string}`,
          toToken: normalizedToToken as `0x${string}`,
          fromAmount: BigInt(fromAmount),
          network: network,
          taker: account.address,
        });

        swapPriceResult = {
          liquidityAvailable: swapPrice.liquidityAvailable,
          toAmount: (swapPrice as any).toAmount?.toString() || '0',
          minToAmount: (swapPrice as any).minToAmount?.toString() || '0',
        };
      } else {
        // Non-CDP networks: No price estimation available
        // User will execute swap directly without preview
        logger.info(`[CDP API] Price estimation not available for ${network} (non-CDP network)`);
        
        swapPriceResult = {
          liquidityAvailable: false,
          toAmount: '0',
          minToAmount: '0',
        };
      }

      logger.info(`[CDP API] Swap price retrieved. Liquidity available: ${swapPriceResult.liquidityAvailable}`);

      sendSuccess(res, {
        liquidityAvailable: swapPriceResult.liquidityAvailable,
        toAmount: swapPriceResult.toAmount,
        minToAmount: swapPriceResult.minToAmount,
        fromAmount: fromAmount,
        fromToken,
        toToken,
        network,
      });
    } catch (error) {
      logger.error(
        '[CDP API] Error getting swap price:',
        error instanceof Error ? error.message : String(error)
      );
      sendError(
        res,
        500,
        'SWAP_PRICE_FAILED',
        'Failed to get swap price',
        error instanceof Error ? error.message : String(error)
      );
    }
  });

  /**
   * POST /api/cdp/wallet/swap
   * Execute token swap (CDP SDK with viem fallback, or Uniswap V3 for non-CDP networks)
   */
  router.post('/wallet/swap', async (req, res) => {
    try {
      const { name, network, fromToken, toToken, fromAmount, slippageBps } = req.body;

      if (!name || !network || !fromToken || !toToken || !fromAmount || slippageBps === undefined) {
        return sendError(res, 400, 'INVALID_REQUEST', 'Missing required fields: name, network, fromToken, toToken, fromAmount, slippageBps');
      }

      const client = getCdpClient();
      if (!client) {
        return sendError(res, 503, 'SERVICE_UNAVAILABLE', 'CDP client not initialized.');
      }

      logger.info(`[CDP API] Executing swap: ${fromAmount} ${fromToken} to ${toToken} on ${network} for user ${name}`);

      const account = await client.evm.getOrCreateAccount({ name });
      
      // Normalize token addresses (convert native token symbols to NATIVE_TOKEN_ADDRESS)
      const normalizedFromToken = normalizeTokenAddress(fromToken);
      const normalizedToToken = normalizeTokenAddress(toToken);

      logger.debug(`[CDP API] Normalized tokens: ${normalizedFromToken} -> ${normalizedToToken}`);

      let transactionHash: string | undefined;
      let method: string = 'unknown';
      let toAmount: string = '0';

      // Check if CDP SDK supports swaps on this network
      if (isCdpSwapSupported(network)) {
        // Try CDP SDK swap first
        try {
          logger.info(`[CDP API] Attempting swap with CDP SDK...`);
          
          const networkAccount = await account.useNetwork(network);
          
          // Execute swap using CDP SDK
          const swapResult = await (networkAccount as any).swap({
            fromToken: normalizedFromToken as `0x${string}`,
            toToken: normalizedToToken as `0x${string}`,
            fromAmount: BigInt(fromAmount),
            slippageBps: slippageBps,
          });

          transactionHash = swapResult.transactionHash;
          toAmount = swapResult.toAmount?.toString() || '0';
          method = 'cdp-sdk';
          
          logger.info(`[CDP API] CDP SDK swap successful: ${transactionHash}`);
        } catch (cdpError) {
          logger.warn(
            `[CDP API] CDP SDK swap failed, trying viem fallback:`,
            cdpError instanceof Error ? cdpError.message : String(cdpError)
          );

          // Fallback to viem with CDP quote
          logger.info(`[CDP API] Using viem fallback for swap...`);

          const chain = getViemChain(network);
          if (!chain) {
            throw new Error(`Unsupported network: ${network}`);
          }

          const alchemyKey = process.env.ALCHEMY_API_KEY;
          if (!alchemyKey) {
            throw new Error('Alchemy API key not configured');
          }

          const rpcUrl = getRpcUrl(network, alchemyKey);
          if (!rpcUrl) {
            throw new Error(`Could not get RPC URL for network: ${network}`);
          }

          // Get swap quote first
          const networkAccount = await account.useNetwork(network);
          const swapQuote = await (networkAccount as any).quoteSwap({
            fromToken: normalizedFromToken as `0x${string}`,
            toToken: normalizedToToken as `0x${string}`,
            fromAmount: BigInt(fromAmount),
            slippageBps: slippageBps,
            network: network,
          });

          if (!swapQuote.liquidityAvailable) {
            throw new Error('Insufficient liquidity for swap');
          }

          toAmount = swapQuote.toAmount?.toString() || '0';

          // Execute the swap using viem with the quote data
          const { createWalletClient, createPublicClient } = await import('viem');
          const { toAccount } = await import('viem/accounts');

          const walletClient = createWalletClient({
            account: toAccount(account),
            chain,
            transport: http(rpcUrl),
          });

          const publicClient = createPublicClient({
            chain,
            transport: http(rpcUrl),
          });

          // Get the transaction data from the quote
          const txData = swapQuote.transaction;
          
          if (!txData || !txData.to || !txData.data) {
            throw new Error('Invalid transaction data from swap quote');
          }

          // Send the transaction
          const hash = await walletClient.sendTransaction({
            to: txData.to as `0x${string}`,
            data: txData.data as `0x${string}`,
            value: txData.value ? BigInt(txData.value) : 0n,
            chain,
          });

          // Wait for confirmation
          await publicClient.waitForTransactionReceipt({ hash });

          transactionHash = hash;
          method = 'viem-cdp-fallback';
          logger.info(`[CDP API] Viem swap successful: ${transactionHash}`);
        }
      } else {
        // Non-CDP networks: Use Uniswap V3 directly with viem
        logger.info(`[CDP API] Using Uniswap V3 + viem for swap on ${network}`);

        const routerAddress = UNISWAP_V3_ROUTER[network];
        if (!routerAddress) {
          throw new Error(`Uniswap V3 not available on network: ${network}`);
        }

        const chain = getViemChain(network);
        if (!chain) {
          throw new Error(`Unsupported network: ${network}`);
        }

        const alchemyKey = process.env.ALCHEMY_API_KEY;
        if (!alchemyKey) {
          throw new Error('Alchemy API key not configured');
        }

        const rpcUrl = getRpcUrl(network, alchemyKey);
        if (!rpcUrl) {
          throw new Error(`Could not get RPC URL for network: ${network}`);
        }

        const { createWalletClient, createPublicClient, encodeFunctionData } = await import('viem');
        const { toAccount } = await import('viem/accounts');

        const walletClient = createWalletClient({
          account: toAccount(account),
          chain,
          transport: http(rpcUrl),
        });

        const publicClient = createPublicClient({
          chain,
          transport: http(rpcUrl),
        });

        // Convert native token addresses to wrapped tokens for Uniswap V3
        const wrappedNativeAddress = WRAPPED_NATIVE_TOKEN[network];
        if (!wrappedNativeAddress) {
          throw new Error(`Wrapped native token not configured for network: ${network}`);
        }

        const isFromNative = normalizedFromToken === NATIVE_TOKEN_ADDRESS;
        const isToNative = normalizedToToken === NATIVE_TOKEN_ADDRESS;

        const uniswapFromToken = isFromNative ? wrappedNativeAddress : normalizedFromToken;
        const uniswapToToken = isToNative ? wrappedNativeAddress : normalizedToToken;

        logger.debug(`[CDP API] Uniswap tokens: ${uniswapFromToken} -> ${uniswapToToken}`);

        // If swapping FROM native token, wrap it first
        if (isFromNative) {
          logger.info(`[CDP API] Wrapping native token before swap: ${fromAmount}`);
          
          // WETH/WMATIC ABI for deposit
          const wethAbi = [
            {
              name: 'deposit',
              type: 'function',
              stateMutability: 'payable',
              inputs: [],
              outputs: []
            }
          ] as const;

          const wrapHash = await walletClient.writeContract({
            address: wrappedNativeAddress as `0x${string}`,
            abi: wethAbi,
            functionName: 'deposit',
            value: BigInt(fromAmount),
          });

          await publicClient.waitForTransactionReceipt({ hash: wrapHash });
          logger.info(`[CDP API] Native token wrapped successfully: ${wrapHash}`);
        }

        // Handle token approvals if needed (for the wrapped token if we just wrapped, or the original ERC20)
        await ensureTokenApproval(
          walletClient,
          publicClient,
          uniswapFromToken,
          routerAddress,
          BigInt(fromAmount),
          account.address
        );

        // Set minimum amount out to 0 since we don't have a price quote
        // The user has been warned about market rate execution
        const minAmountOut = 0n;

        // Uniswap V3 SwapRouter ABI for exactInputSingle
        const swapRouterAbi = [
          {
            name: 'exactInputSingle',
            type: 'function',
            stateMutability: 'payable',
            inputs: [
              {
                name: 'params',
                type: 'tuple',
                components: [
                  { name: 'tokenIn', type: 'address' },
                  { name: 'tokenOut', type: 'address' },
                  { name: 'fee', type: 'uint24' },
                  { name: 'recipient', type: 'address' },
                  { name: 'deadline', type: 'uint256' },
                  { name: 'amountIn', type: 'uint256' },
                  { name: 'amountOutMinimum', type: 'uint256' },
                  { name: 'sqrtPriceLimitX96', type: 'uint160' }
                ]
              }
            ],
            outputs: [{ name: 'amountOut', type: 'uint256' }]
          }
        ] as const;

        // Prepare swap parameters
        const deadline = BigInt(Math.floor(Date.now() / 1000) + 60 * 20); // 20 minutes
        const swapParams = {
          tokenIn: uniswapFromToken as `0x${string}`,
          tokenOut: uniswapToToken as `0x${string}`,
          fee: UNISWAP_POOL_FEES.MEDIUM, // Try 0.3% fee tier first
          recipient: account.address as `0x${string}`,
          deadline,
          amountIn: BigInt(fromAmount),
          amountOutMinimum: minAmountOut,
          sqrtPriceLimitX96: 0n, // No price limit
        };

        // Encode the function call
        const data = encodeFunctionData({
          abi: swapRouterAbi,
          functionName: 'exactInputSingle',
          args: [swapParams],
        });

        // No native token value needed since we're using wrapped tokens
        const value = 0n;

        // Send the transaction
        const hash = await walletClient.sendTransaction({
          to: routerAddress as `0x${string}`,
          data,
          value,
          chain,
        });

        // Wait for confirmation
        await publicClient.waitForTransactionReceipt({ hash });
        logger.info(`[CDP API] Uniswap V3 swap successful: ${hash}`);

        // If swapping TO native token, unwrap it
        if (isToNative) {
          logger.info(`[CDP API] Unwrapping output to native token`);
          
          // Get wrapped token balance to unwrap
          const balanceAbi = [
            {
              name: 'balanceOf',
              type: 'function',
              stateMutability: 'view',
              inputs: [{ name: 'account', type: 'address' }],
              outputs: [{ name: '', type: 'uint256' }]
            }
          ] as const;

          const wrappedBalance = await publicClient.readContract({
            address: wrappedNativeAddress as `0x${string}`,
            abi: balanceAbi,
            functionName: 'balanceOf',
            args: [account.address as `0x${string}`],
          });

          if (wrappedBalance > 0n) {
            // WETH/WMATIC ABI for withdraw
            const wethWithdrawAbi = [
              {
                name: 'withdraw',
                type: 'function',
                stateMutability: 'nonpayable',
                inputs: [{ name: 'amount', type: 'uint256' }],
                outputs: []
              }
            ] as const;

            const unwrapHash = await walletClient.writeContract({
              address: wrappedNativeAddress as `0x${string}`,
              abi: wethWithdrawAbi,
              functionName: 'withdraw',
              args: [wrappedBalance],
            });

            await publicClient.waitForTransactionReceipt({ hash: unwrapHash });
            logger.info(`[CDP API] Unwrapped ${wrappedBalance.toString()} to native token: ${unwrapHash}`);
            toAmount = wrappedBalance.toString();
          }
        }

        transactionHash = hash;
        method = 'uniswap-v3-viem';
        logger.info(`[CDP API] Uniswap V3 + viem swap complete: ${transactionHash}`);
      }

      if (!transactionHash) {
        throw new Error('Swap did not return a transaction hash');
      }

      sendSuccess(res, {
        transactionHash,
        from: account.address,
        fromToken,
        toToken,
        fromAmount: fromAmount.toString(),
        toAmount,
        network,
        method,
      });
    } catch (error) {
      logger.error(
        '[CDP API] Error executing swap:',
        error instanceof Error ? error.message : String(error)
      );
      sendError(
        res,
        500,
        'SWAP_FAILED',
        'Failed to execute swap',
        error instanceof Error ? error.message : String(error)
      );
    }
  });

  return router;
}
