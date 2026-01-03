import express from 'express';
import { logger, validateUuid } from '@elizaos/core';
import type { AgentServer } from '../../index';
import { sendError, sendSuccess } from '../shared/response-utils';
import { requireAuth, type AuthenticatedRequest } from '../../middleware';
import { CdpTransactionManager } from '@/managers/cdp-transaction-manager';
import { MAINNET_NETWORKS, NATIVE_TOKEN_ADDRESS } from '@/constants/chains';

/**
 * Resolve entity_id to cdp_user_id from user_registry.
 * Server wallets are keyed by the OLD entity_id (now stored as cdp_user_id).
 */
async function resolveWalletAccountName(
  dbExecute: ((sql: string) => Promise<{ rows: any[] }>) | null,
  entityId: string,
  logPrefix = 'CDP API'
): Promise<string> {
  if (!dbExecute) {
    logger.warn(`[${logPrefix}] Database not available, falling back to entityId`);
    return entityId;
  }

  try {
    const escapedId = entityId.replace(/'/g, "''");
    const result = await dbExecute(`
      SELECT cdp_user_id FROM user_registry 
      WHERE entity_id = '${escapedId}'::uuid 
      LIMIT 1
    `);

    if (result.rows?.[0]?.cdp_user_id) {
      const cdpUserId = result.rows[0].cdp_user_id as string;
      logger.debug(`[${logPrefix}] Resolved entity_id=${entityId.substring(0, 8)}... to cdp_user_id=${cdpUserId.substring(0, 8)}...`);
      return cdpUserId;
    }

    logger.warn(`[${logPrefix}] No user_registry entry for entity_id=${entityId.substring(0, 8)}..., using entityId`);
    return entityId;
  } catch (error) {
    logger.error(`[${logPrefix}] Failed to resolve wallet account name:`, error);
    return entityId;
  }
}

export function cdpRouter(serverInstance: AgentServer): express.Router {
  const router = express.Router();
  const db = serverInstance?.database;

  // Get the singleton instance of CdpTransactionManager
  const cdpTransactionManager = CdpTransactionManager.getInstance();
  
  // SECURITY: Require authentication for all CDP wallet operations
  router.use(requireAuth);

  // Database executor for resolveWalletAccountName
  const dbExecute = db ? ((sql: string) => (db as any).execute(sql)) : null;

  /**
   * Helper: Get wallet address from entity metadata for GET requests
   */
  async function getWalletAddressFromEntity(userId: string): Promise<string | null> {
    if (!db) {
      logger.warn('[CDP API] Database not available, cannot fetch entity metadata');
      return null;
    }

    try {
      const validatedUserId = validateUuid(userId);
      if (!validatedUserId) {
        logger.warn(`[CDP API] Invalid UUID format for userId: ${userId}`);
        return null;
      }
      
      const entities = await db.getEntitiesByIds([validatedUserId]);
      if (!entities || entities.length === 0) {
        return null;
      }

      const entity = entities[0];
      const walletAddress = entity.metadata?.walletAddress as string | undefined;
      
      if (walletAddress && typeof walletAddress === 'string' && walletAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
        logger.debug(`[CDP API] Found wallet address in entity metadata: ${walletAddress}`);
        return walletAddress;
      }

      return null;
    } catch (error) {
      logger.warn('[CDP API] Error fetching entity metadata:', error instanceof Error ? error.message : String(error));
      return null;
    }
  }

  /**
   * POST /api/cdp/wallet
   * Get or create server wallet for authenticated user
   * SECURITY: Uses userId from JWT token, not from request body
   * NOTE: Resolves entity_id → cdp_user_id for wallet operations (server wallets keyed by old entity_id)
   */
  router.post('/wallet', async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.userId!;

      // Resolve entity_id to cdp_user_id for CDP wallet operations
      const accountName = await resolveWalletAccountName(dbExecute, userId, 'CDP API');
      const result = await cdpTransactionManager.getOrCreateWallet(accountName);
      
      sendSuccess(res, result);
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
   * GET /api/cdp/wallet/tokens
   * Get token balances for authenticated user (checks cache first)
   * Query params:
   *   - chain (optional): Specific chain to fetch (e.g., 'base', 'ethereum', 'polygon')
   * SECURITY: Uses authenticated userId from JWT token
   * 
   * For GET requests, we fetch the wallet address from entity metadata instead of
   * calling getOrCreateAccount, which avoids unnecessary account initialization.
   */
  router.get('/wallet/tokens', async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.userId!;
      const chain = req.query.chain as string | undefined;

      // Validate chain if provided
      if (chain && !MAINNET_NETWORKS.includes(chain as any)) {
        return sendError(res, 400, 'INVALID_CHAIN', `Invalid or unsupported chain: ${chain}`);
      }

      // Try to get address from entity metadata first (for GET requests)
      const walletAddress = await getWalletAddressFromEntity(userId);
      
      // Resolve entity_id to cdp_user_id for CDP wallet operations
      const accountName = await resolveWalletAccountName(dbExecute, userId, 'CDP API');
      const result = await cdpTransactionManager.getTokenBalances(accountName, chain, false, walletAddress || undefined);

      sendSuccess(res, result);
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
   * POST /api/cdp/wallet/tokens/sync
   * Force sync token balances for authenticated user (bypasses cache)
   * Body params:
   *   - chain (optional): Specific chain to fetch (e.g., 'base', 'ethereum', 'polygon')
   * SECURITY: Uses authenticated userId from JWT token
   * 
   * Tries to get wallet address from entity metadata first, then falls back to CDP account
   */
  router.post('/wallet/tokens/sync', async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.userId!;
      const { chain } = req.body;

      // Validate chain if provided
      if (chain && !MAINNET_NETWORKS.includes(chain as any)) {
        return sendError(res, 400, 'INVALID_CHAIN', `Invalid or unsupported chain: ${chain}`);
      }

      // Try to get address from entity metadata first (same as GET endpoint)
      const walletAddress = await getWalletAddressFromEntity(userId);
      
      // Resolve entity_id to cdp_user_id for CDP wallet operations
      const accountName = await resolveWalletAccountName(dbExecute, userId, 'CDP API');
      const result = await cdpTransactionManager.getTokenBalances(accountName, chain, true, walletAddress || undefined);

      sendSuccess(res, { ...result, synced: true });
    } catch (error) {
      logger.error(
        '[CDP API] Error syncing tokens:',
        error instanceof Error ? error.message : String(error)
      );
      sendError(
        res,
        500,
        'SYNC_TOKENS_FAILED',
        'Failed to sync token balances',
        error instanceof Error ? error.message : String(error)
      );
    }
  });

  /**
   * GET /api/cdp/wallet/nfts
   * Get NFT holdings for authenticated user (checks cache first)
   * Query params:
   *   - chain (optional): Specific chain to fetch (e.g., 'base', 'ethereum', 'polygon')
   * SECURITY: Uses authenticated userId from JWT token
   * 
   * For GET requests, we fetch the wallet address from entity metadata instead of
   * calling getOrCreateAccount, which avoids unnecessary account initialization.
   */
  router.get('/wallet/nfts', async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.userId!;
      const chain = req.query.chain as string | undefined;

      // Validate chain if provided
      if (chain && !MAINNET_NETWORKS.includes(chain as any)) {
        return sendError(res, 400, 'INVALID_CHAIN', `Invalid or unsupported chain: ${chain}`);
      }

      // Try to get address from entity metadata first (for GET requests)
      const walletAddress = await getWalletAddressFromEntity(userId);
      
      // Resolve entity_id to cdp_user_id for CDP wallet operations
      const accountName = await resolveWalletAccountName(dbExecute, userId, 'CDP API');
      const result = await cdpTransactionManager.getNFTs(accountName, chain, false, walletAddress || undefined);

      sendSuccess(res, result);
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
   * POST /api/cdp/wallet/nfts/sync
   * Force sync NFTs for authenticated user (bypasses cache)
   * Body params:
   *   - chain (optional): Specific chain to fetch (e.g., 'base', 'ethereum', 'polygon')
   * SECURITY: Uses authenticated userId from JWT token
   * 
   * Tries to get wallet address from entity metadata first, then falls back to CDP account
   */
  router.post('/wallet/nfts/sync', async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.userId!;
      const { chain } = req.body;

      // Validate chain if provided
      if (chain && !MAINNET_NETWORKS.includes(chain as any)) {
        return sendError(res, 400, 'INVALID_CHAIN', `Invalid or unsupported chain: ${chain}`);
      }

      // Try to get address from entity metadata first (same as GET endpoint)
      const walletAddress = await getWalletAddressFromEntity(userId);
      
      // Resolve entity_id to cdp_user_id for CDP wallet operations
      const accountName = await resolveWalletAccountName(dbExecute, userId, 'CDP API');
      const result = await cdpTransactionManager.getNFTs(accountName, chain, true, walletAddress || undefined);

      sendSuccess(res, { ...result, synced: true });
    } catch (error) {
      logger.error(
        '[CDP API] Error syncing NFTs:',
        error instanceof Error ? error.message : String(error)
      );
      sendError(
        res,
        500,
        'SYNC_NFTS_FAILED',
        'Failed to sync NFTs',
        error instanceof Error ? error.message : String(error)
      );
    }
  });

  /**
   * GET /api/cdp/wallet/history
   * Get transaction history for authenticated user across networks using Alchemy API
   * SECURITY: Uses authenticated userId from JWT token
   * 
   * For GET requests, we fetch the wallet address from entity metadata instead of
   * calling getOrCreateAccount, which avoids unnecessary account initialization.
   */
  router.get('/wallet/history', async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.userId!;

      // Try to get address from entity metadata first (for GET requests)
      const walletAddress = await getWalletAddressFromEntity(userId);
      
      // Resolve entity_id to cdp_user_id for CDP wallet operations
      const accountName = await resolveWalletAccountName(dbExecute, userId, 'CDP API');
      const result = await cdpTransactionManager.getTransactionHistory(accountName, walletAddress || undefined);

      sendSuccess(res, result);
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
   * Send tokens from authenticated user's server wallet
   * SECURITY: Uses userId from JWT token, not from request body
   */
  router.post('/wallet/send', async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.userId!;
      const { network, to, token, amount } = req.body;

      if (!network || !to || !token || !amount) {
        return sendError(res, 400, 'INVALID_REQUEST', 'Missing required fields: network, to, token, amount');
      }

      // Resolve entity_id to cdp_user_id for CDP wallet operations
      const accountName = await resolveWalletAccountName(dbExecute, userId, 'CDP API');
      const result = await cdpTransactionManager.sendToken({
        userId: accountName,
        network,
        to,
        token,
        amount,
      });

      sendSuccess(res, result);
    } catch (error) {
      const rawErrorMessage = error instanceof Error ? error.message : String(error);
      
      logger.error('[CDP API] Error sending tokens:', rawErrorMessage);
      
      // Extract just the "Details: ..." part if it exists
      let errorMessage = 'Failed to send tokens';
      const detailsMatch = rawErrorMessage.match(/Details:\s*(.+?)(?:\nVersion:|$)/s);
      if (detailsMatch) {
        errorMessage = detailsMatch[1].trim();
      }
      
      sendError(res, 500, 'SEND_FAILED', errorMessage);
    }
  });

  /**
   * POST /api/cdp/wallet/send-nft
   * Send NFT from authenticated user's server wallet
   * SECURITY: Uses userId from JWT token, not from request body
   */
  router.post('/wallet/send-nft', async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.userId!;
      const { network, to, contractAddress, tokenId } = req.body;

      if (!network || !to || !contractAddress || !tokenId) {
        return sendError(res, 400, 'INVALID_REQUEST', 'Missing required fields: network, to, contractAddress, tokenId');
      }

      // Resolve entity_id to cdp_user_id for CDP wallet operations
      const accountName = await resolveWalletAccountName(dbExecute, userId, 'CDP API');
      const result = await cdpTransactionManager.sendNFT({
        userId: accountName,
        network,
        to,
        contractAddress,
        tokenId,
      });

      sendSuccess(res, result);
    } catch (error) {
      const rawErrorMessage = error instanceof Error ? error.message : String(error);
      
      logger.error('[CDP API] Error sending NFT:', rawErrorMessage);
      
      // Extract just the "Details: ..." part if it exists
      let errorMessage = 'Failed to send NFT';
      const detailsMatch = rawErrorMessage.match(/Details:\s*(.+?)(?:\nVersion:|$)/s);
      if (detailsMatch) {
        errorMessage = detailsMatch[1].trim();
      }
      
      sendError(res, 500, 'SEND_NFT_FAILED', errorMessage);
    }
  });

  /**
   * Wrapped token addresses - matches action handler exactly
   */
  const WETH_ADDRESSES: Record<string, string> = {
    "base": "0x4200000000000000000000000000000000000006",
    "base-sepolia": "0x4200000000000000000000000000000000000006",
    "ethereum": "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    "arbitrum": "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
    "optimism": "0x4200000000000000000000000000000000000006",
    "polygon": "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619",
  };

  const WMATIC_ADDRESS = "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270";

  /**
   * Helper function to resolve token to address - matches action handler signature exactly
   * Uses the same logic as cdp-wallet-swap.ts action handler
   */
  async function resolveTokenToAddress(
    token: string,
    network: string
  ): Promise<`0x${string}` | null> {
    logger.debug(`[CDP API] Resolving token: ${token} on network: ${network}`);
    const trimmedToken = token.trim();
    
    // For native ETH - CDP uses special native token address
    // EXCEPTION: On Polygon, ETH refers to WETH (bridged ETH), not the native gas token
    if (trimmedToken.toLowerCase() === "eth") {
      if (network === "polygon") {
        const wethAddress = WETH_ADDRESSES[network];
        logger.info(`[CDP API] Using WETH contract address for ETH on Polygon: ${wethAddress}`);
        return wethAddress as `0x${string}`;
      }
      logger.info(`[CDP API] Using native token address for ETH: ${NATIVE_TOKEN_ADDRESS}`);
      return NATIVE_TOKEN_ADDRESS as `0x${string}`;
    }
    
    // For explicit WETH - use actual WETH contract address
    if (trimmedToken.toLowerCase() === "weth") {
      const wethAddress = WETH_ADDRESSES[network];
      if (wethAddress) {
        logger.info(`[CDP API] Using WETH contract address for ${network}: ${wethAddress}`);
        return wethAddress as `0x${string}`;
      }
      logger.warn(`[CDP API] No WETH address configured for network ${network}`);
    }
    
    // For native MATIC/POL on Polygon - use native token address
    // Note: POL exists as ERC20 on Ethereum mainnet, but is NOT a native gas token there
    // POL on Ethereum would fall through to token search resolution (ERC20 contract address)
    if ((trimmedToken.toLowerCase() === "matic" || trimmedToken.toLowerCase() === "pol") && network === "polygon") {
      logger.info(`[CDP API] Using native token address for ${trimmedToken.toUpperCase()}: ${NATIVE_TOKEN_ADDRESS}`);
      return NATIVE_TOKEN_ADDRESS as `0x${string}`;
    }
    
    // For explicit WMATIC on Polygon - use actual WMATIC contract address
    if (trimmedToken.toLowerCase() === "wmatic" && network === "polygon") {
      logger.info(`[CDP API] Using WMATIC contract address for Polygon: ${WMATIC_ADDRESS}`);
      return WMATIC_ADDRESS as `0x${string}`;
    }
    
    // If it looks like an address, validate it via searchTokens (simpler than CoinGecko validation for API route)
    if (trimmedToken.startsWith("0x") && trimmedToken.length === 42) {
      logger.debug(`[CDP API] Token ${token} looks like an address, validating via searchTokens`);
      try {
        const searchResult = await cdpTransactionManager.searchTokens({
          query: trimmedToken,
          chain: network,
        });
        
        // Check if address exists in search results
        const foundToken = searchResult.tokens?.find(
          (t: any) => t.contractAddress?.toLowerCase() === trimmedToken.toLowerCase() && t.chain === network
        );
        
        if (foundToken) {
          logger.info(`[CDP API] Validated address ${token} exists: ${foundToken.symbol} (${foundToken.name})`);
          return trimmedToken as `0x${string}`;
        }
        logger.warn(`[CDP API] Address ${token} not found via searchTokens for network ${network} - may be fake/invalid`);
      } catch (error) {
        logger.warn(`[CDP API] Failed to validate address ${token}:`, error instanceof Error ? error.message : String(error));
      }
      // Still return the address even if validation fails (let transaction manager handle it)
      return trimmedToken as `0x${string}`;
    }
    
    // Try to resolve symbol to address via searchTokens
    logger.debug(`[CDP API] Resolving token symbol from searchTokens for ${trimmedToken}`);
    try {
      const searchResult = await cdpTransactionManager.searchTokens({
        query: trimmedToken,
        chain: network,
      });
      
      // Find exact symbol match
      const matchedToken = searchResult.tokens?.find(
        (t: any) => t.symbol?.toLowerCase() === trimmedToken.toLowerCase() && t.chain === network && t.contractAddress
      );
      
      if (matchedToken?.contractAddress) {
        logger.info(`[CDP API] Resolved ${token} to ${matchedToken.contractAddress} via searchTokens`);
        return matchedToken.contractAddress.toLowerCase() as `0x${string}`;
      }
    } catch (error) {
      logger.warn(`[CDP API] Failed to resolve token symbol ${token}:`, error instanceof Error ? error.message : String(error));
    }
    
    logger.warn(`[CDP API] Could not resolve token ${token} on ${network}`);
    return null;
  }

  /**
   * POST /api/cdp/wallet/swap-price
   * Get swap price estimate for authenticated user
   * SECURITY: Uses userId from JWT token, not from request body
   * 
   * Resolves token symbols/addresses to proper addresses before getting swap price.
   * Handles:
   * - Native tokens: 'eth', 'matic', 'pol' -> NATIVE_TOKEN_ADDRESS
   * - Token symbols: 'USDC', 'CBBTC' -> resolved via searchTokens
   * - Token addresses: '0x...' -> used directly
   */
  router.post('/wallet/swap-price', async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.userId!;
      const { network, fromToken, toToken, fromAmount } = req.body;

      if (!network || !fromToken || !toToken || !fromAmount) {
        return sendError(res, 400, 'INVALID_REQUEST', 'Missing required fields: network, fromToken, toToken, fromAmount');
      }

      // Resolve token symbols/addresses to proper addresses (same logic as action handler)
      logger.debug(`[CDP API] Resolving tokens for swap price: ${fromToken} -> ${toToken} on ${network}`);
      
      const resolvedFromToken = await resolveTokenToAddress(fromToken, network);
      const resolvedToToken = await resolveTokenToAddress(toToken, network);
      
      if (!resolvedFromToken) {
        return sendError(res, 400, 'TOKEN_RESOLUTION_FAILED', `Could not resolve source token: ${fromToken}`);
      }
      if (!resolvedToToken) {
        return sendError(res, 400, 'TOKEN_RESOLUTION_FAILED', `Could not resolve destination token: ${toToken}`);
      }

      logger.debug(`[CDP API] Resolved tokens: ${resolvedFromToken} -> ${resolvedToToken}`);

      // Resolve entity_id to cdp_user_id for CDP wallet operations
      const accountName = await resolveWalletAccountName(dbExecute, userId, 'CDP API');
      const result = await cdpTransactionManager.getSwapPrice({
        userId: accountName,
        network,
        fromToken: resolvedFromToken,
        toToken: resolvedToToken,
        fromAmount,
      });

      sendSuccess(res, result);
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
   * Execute token swap for authenticated user (CDP SDK with viem fallback, or Uniswap V3)
   * SECURITY: Uses userId from JWT token, not from request body
   * 
   * Resolves token symbols/addresses to proper addresses before executing swap.
   * Handles:
   * - Native tokens: 'eth', 'matic', 'pol' -> NATIVE_TOKEN_ADDRESS
   * - Token symbols: 'USDC', 'CBBTC' -> resolved via searchTokens
   * - Token addresses: '0x...' -> used directly
   */
  router.post('/wallet/swap', async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.userId!;
      const { network, fromToken, toToken, fromAmount, slippageBps } = req.body;

      if (!network || !fromToken || !toToken || !fromAmount || slippageBps === undefined) {
        return sendError(res, 400, 'INVALID_REQUEST', 'Missing required fields: network, fromToken, toToken, fromAmount, slippageBps');
      }

      // Resolve token symbols/addresses to proper addresses (same logic as action handler)
      logger.debug(`[CDP API] Resolving tokens for swap: ${fromToken} -> ${toToken} on ${network}`);
      
      const resolvedFromToken = await resolveTokenToAddress(fromToken, network);
      const resolvedToToken = await resolveTokenToAddress(toToken, network);
      
      if (!resolvedFromToken) {
        return sendError(res, 400, 'TOKEN_RESOLUTION_FAILED', `Could not resolve source token: ${fromToken}`);
      }
      if (!resolvedToToken) {
        return sendError(res, 400, 'TOKEN_RESOLUTION_FAILED', `Could not resolve destination token: ${toToken}`);
      }

      logger.debug(`[CDP API] Resolved tokens: ${resolvedFromToken} -> ${resolvedToToken}`);

      // Resolve entity_id to cdp_user_id for CDP wallet operations
      const accountName = await resolveWalletAccountName(dbExecute, userId, 'CDP API');
      const result = await cdpTransactionManager.swap({
        userId: accountName,
        network,
        fromToken: resolvedFromToken,
        toToken: resolvedToToken,
        fromAmount,
        slippageBps,
      });

      sendSuccess(res, result);
    } catch (error) {
      const rawErrorMessage = error instanceof Error ? error.message : String(error);
      
      logger.error('[CDP API] Error executing swap:', rawErrorMessage);
      
      // Extract just the "Details: ..." part if it exists
      let errorMessage = 'Failed to execute swap';
      const detailsMatch = rawErrorMessage.match(/Details:\s*(.+?)(?:\nVersion:|$)/s);
      if (detailsMatch) {
        errorMessage = detailsMatch[1].trim();
      }
      
      sendError(res, 500, 'SWAP_FAILED', errorMessage);
    }
  });

  /**
   * GET /api/cdp/tokens/search
   * Search for tokens using CoinGecko API
   * Query params:
   *   - query (required): Token name, symbol, or contract address (min 2 characters)
   *   - chain (optional): Specific chain to search (e.g., 'base', 'ethereum', 'polygon')
   * NOTE: This endpoint does not require authentication
   */
  router.get('/tokens/search', async (req, res) => {
    try {
      const { query, chain } = req.query;

      if (!query || typeof query !== 'string') {
        return sendError(res, 400, 'INVALID_REQUEST', 'Query parameter is required');
      }

      const result = await cdpTransactionManager.searchTokens({
        query,
        chain: chain as string | undefined,
      });

      return sendSuccess(res, result);
    } catch (error) {
      logger.error(
        '[CDP API] Error searching tokens:',
        error instanceof Error ? error.message : String(error)
      );
      return sendError(
        res,
        500,
        'SEARCH_FAILED',
        'Failed to search tokens',
        error instanceof Error ? error.message : String(error)
      );
    }
  });

  /**
   * GET /api/cdp/tokens/top-and-trending
   * Get top tokens by market cap and trending tokens for a specific chain
   * Query params:
   *   - chain (required): Specific chain (e.g., 'base', 'ethereum', 'polygon', 'arbitrum', 'optimism')
   *   - limit (optional): Number of tokens to return (default: 20)
   * NOTE: This endpoint does not require authentication
   */
  router.get('/tokens/top-and-trending', async (req, res) => {
    try {
      const { chain, limit } = req.query;

      if (!chain || typeof chain !== 'string') {
        return sendError(res, 400, 'INVALID_REQUEST', 'Chain parameter is required');
      }

      const limitNum = limit ? parseInt(limit as string, 10) : 20;
      const clampedLimit = Math.max(1, Math.min(50, limitNum));

      const result = await cdpTransactionManager.getTopAndTrendingTokens({
        chain: chain as string,
        limit: clampedLimit,
      });

      return sendSuccess(res, result);
    } catch (error) {
      logger.error(
        '[CDP API] Error fetching top and trending tokens:',
        error instanceof Error ? error.message : String(error)
      );
      return sendError(
        res,
        500,
        'FETCH_FAILED',
        'Failed to fetch top and trending tokens',
        error instanceof Error ? error.message : String(error)
      );
    }
  });

  return router;
}
