import express from 'express';
import { logger } from '@elizaos/core';
import { CdpClient } from '@coinbase/cdp-sdk';
import type { AgentServer } from '../../index';
import { sendError, sendSuccess } from '../shared/response-utils';
import { createWalletClient, http } from 'viem';
import { toAccount } from 'viem/accounts';
import { base, mainnet, polygon, baseSepolia, sepolia } from 'viem/chains';
        

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

      // Supported networks
      const networks = ['base', 'ethereum', 'polygon'] as const;
      const platformMap: Record<string, string> = {
        base: 'base',
        ethereum: 'ethereum',
        polygon: 'polygon-pos',
      };

      const rpcMap: Record<string, string> = {
        base: `https://base-mainnet.g.alchemy.com/v2/${alchemyKey}`,
        ethereum: `https://eth-mainnet.g.alchemy.com/v2/${alchemyKey}`,
        polygon: `https://polygon-mainnet.g.alchemy.com/v2/${alchemyKey}`,
      };

      const allTokens: any[] = [];
      let totalUsdValue = 0;

      // Native token info mapping
      const nativeTokenInfo: Record<string, { symbol: string; name: string; coingeckoId: string }> = {
        base: { symbol: 'ETH', name: 'Ethereum', coingeckoId: 'ethereum' },
        ethereum: { symbol: 'ETH', name: 'Ethereum', coingeckoId: 'ethereum' },
        polygon: { symbol: 'MATIC', name: 'Polygon', coingeckoId: 'matic-network' },
      };

      for (const network of networks) {
        try {
          const rpcUrl = rpcMap[network];

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
            const amountNum = safeBalanceToNumber('0x' + nativeBalance.toString(16), 18);
            const nativeInfo = nativeTokenInfo[network];
            const usdPrice = await getNativeTokenPrice(nativeInfo.coingeckoId);
            const usdValue = amountNum * usdPrice;
            
            // Only add to total if it's a valid number
            if (!isNaN(usdValue)) {
              totalUsdValue += usdValue;
            }

            allTokens.push({
              symbol: nativeInfo.symbol,
              name: nativeInfo.name,
              balance: isNaN(amountNum) ? '0' : amountNum.toString(),
              balanceFormatted: isNaN(amountNum) ? '0' : amountNum.toFixed(6).replace(/\.?0+$/, ''),
              usdValue: isNaN(usdValue) ? 0 : usdValue,
              usdPrice: isNaN(usdPrice) ? 0 : usdPrice,
              contractAddress: null,
              chain: network,
              decimals: 18,
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
              let tokenInfo = await getTokenInfo(contractAddress, platformMap[network]);
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

      // Fetch NFTs from Base and Ethereum using Alchemy REST API
      const networks = [
        { name: 'base', url: `https://base-mainnet.g.alchemy.com/nft/v3/${alchemyKey}/getNFTsForOwner?owner=${address}&withMetadata=true&pageSize=100` },
        { name: 'ethereum', url: `https://eth-mainnet.g.alchemy.com/nft/v3/${alchemyKey}/getNFTsForOwner?owner=${address}&withMetadata=true&pageSize=100` },
        { name: 'polygon', url: `https://polygon-mainnet.g.alchemy.com/nft/v3/${alchemyKey}/getNFTsForOwner?owner=${address}&withMetadata=true&pageSize=100` },
      ];

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

      // Fetch transactions from Base and Ethereum
      const networks = [
        { name: 'base', rpc: `https://base-mainnet.g.alchemy.com/v2/${alchemyKey}`, explorer: 'https://basescan.org' },
        { name: 'ethereum', rpc: `https://eth-mainnet.g.alchemy.com/v2/${alchemyKey}`, explorer: 'https://etherscan.io' },
        { name: 'polygon', rpc: `https://polygon-mainnet.g.alchemy.com/v2/${alchemyKey}`, explorer: 'https://polygonscan.com' },
      ];

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
        
        const chainMap: Record<string, any> = {
          'base': base,
          'base-sepolia': baseSepolia,
          'ethereum': mainnet,
          'ethereum-sepolia': sepolia,
          'polygon': polygon,
        };

        const chain = chainMap[network];
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

        const rpcUrls: Record<string, string> = {
          'base': `https://base-mainnet.g.alchemy.com/v2/${alchemyKey}`,
          'base-sepolia': `https://base-sepolia.g.alchemy.com/v2/${alchemyKey}`,
          'ethereum': `https://eth-mainnet.g.alchemy.com/v2/${alchemyKey}`,
          'ethereum-sepolia': `https://eth-sepolia.g.alchemy.com/v2/${alchemyKey}`,
          'polygon': `https://polygon-mainnet.g.alchemy.com/v2/${alchemyKey}`,
        };

        // Create wallet client
        const walletClient = createWalletClient({
          account: toAccount(account),
          chain,
          transport: http(rpcUrls[network]),
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
      const { base, mainnet, polygon } = await import('viem/chains');
      
      const chainMap: Record<string, any> = {
        base,
        ethereum: mainnet,
        polygon,
      };
      
      const chain = chainMap[network] || base;
      const alchemyKey = process.env.ALCHEMY_API_KEY || '';
      const rpcMap: Record<string, string> = {
        base: `https://base-mainnet.g.alchemy.com/v2/${alchemyKey}`,
        ethereum: `https://eth-mainnet.g.alchemy.com/v2/${alchemyKey}`,
        polygon: `https://polygon-mainnet.g.alchemy.com/v2/${alchemyKey}`,
      };
      
      const rpcUrl = rpcMap[network] || rpcMap.base;
      
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

  return router;
}
