import express from 'express';
import { logger } from '@elizaos/core';
import type { AgentServer } from '../../index';
import { sendError, sendSuccess } from '../shared/response-utils';
import { requireAuth, type AuthenticatedRequest } from '../../middleware';
import { CdpTransactionManager } from '@/managers/cdp-transaction-manager';
import { MAINNET_NETWORKS } from '@/constants/chains';

export function cdpRouter(_serverInstance: AgentServer): express.Router {
  const router = express.Router();

  // Get the singleton instance of CdpTransactionManager
  const cdpTransactionManager = CdpTransactionManager.getInstance();
  
  // SECURITY: Require authentication for all CDP wallet operations
  router.use(requireAuth);

  /**
   * POST /api/cdp/wallet
   * Get or create server wallet for authenticated user
   * SECURITY: Uses userId from JWT token, not from request body
   */
  router.post('/wallet', async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.userId!;

      const result = await cdpTransactionManager.getOrCreateWallet(userId);
      
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
   */
  router.get('/wallet/tokens', async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.userId!;
      const chain = req.query.chain as string | undefined;

      // Validate chain if provided
      if (chain && !MAINNET_NETWORKS.includes(chain as any)) {
        return sendError(res, 400, 'INVALID_CHAIN', `Invalid or unsupported chain: ${chain}`);
      }

      const result = await cdpTransactionManager.getTokenBalances(userId, chain, false);

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
   */
  router.post('/wallet/tokens/sync', async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.userId!;
      const { chain } = req.body;

      // Validate chain if provided
      if (chain && !MAINNET_NETWORKS.includes(chain as any)) {
        return sendError(res, 400, 'INVALID_CHAIN', `Invalid or unsupported chain: ${chain}`);
      }

      const result = await cdpTransactionManager.getTokenBalances(userId, chain, true);

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
   */
  router.get('/wallet/nfts', async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.userId!;
      const chain = req.query.chain as string | undefined;

      // Validate chain if provided
      if (chain && !MAINNET_NETWORKS.includes(chain as any)) {
        return sendError(res, 400, 'INVALID_CHAIN', `Invalid or unsupported chain: ${chain}`);
      }

      const result = await cdpTransactionManager.getNFTs(userId, chain, false);

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
   */
  router.post('/wallet/nfts/sync', async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.userId!;
      const { chain } = req.body;

      // Validate chain if provided
      if (chain && !MAINNET_NETWORKS.includes(chain as any)) {
        return sendError(res, 400, 'INVALID_CHAIN', `Invalid or unsupported chain: ${chain}`);
      }

      const result = await cdpTransactionManager.getNFTs(userId, chain, true);

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
   */
  router.get('/wallet/history', async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.userId!;

      const result = await cdpTransactionManager.getTransactionHistory(userId);

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

      const result = await cdpTransactionManager.sendToken({
        userId,
        network,
        to,
        token,
        amount,
      });

      sendSuccess(res, result);
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

      const result = await cdpTransactionManager.sendNFT({
        userId,
        network,
        to,
        contractAddress,
        tokenId,
      });

      sendSuccess(res, result);
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
   * Get swap price estimate for authenticated user
   * SECURITY: Uses userId from JWT token, not from request body
   */
  router.post('/wallet/swap-price', async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.userId!;
      const { network, fromToken, toToken, fromAmount } = req.body;

      if (!network || !fromToken || !toToken || !fromAmount) {
        return sendError(res, 400, 'INVALID_REQUEST', 'Missing required fields: network, fromToken, toToken, fromAmount');
      }

      const result = await cdpTransactionManager.getSwapPrice({
        userId,
        network,
        fromToken,
        toToken,
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
   */
  router.post('/wallet/swap', async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.userId!;
      const { network, fromToken, toToken, fromAmount, slippageBps } = req.body;

      if (!network || !fromToken || !toToken || !fromAmount || slippageBps === undefined) {
        return sendError(res, 400, 'INVALID_REQUEST', 'Missing required fields: network, fromToken, toToken, fromAmount, slippageBps');
      }

      const result = await cdpTransactionManager.swap({
        userId,
            network,
            fromToken,
            toToken,
        fromAmount,
        slippageBps,
      });

      sendSuccess(res, result);
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

  return router;
}
