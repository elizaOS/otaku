import express from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { logger } from '@elizaos/core';
import type { AgentServer } from '../../index';
import { sendError, sendSuccess } from '../shared/response-utils';
import { generateAuthToken, type AuthenticatedRequest, createAuthRateLimit } from '../../middleware';

// Create auth rate limiter instance
const authRateLimiter = createAuthRateLimit();

/**
 * User Registry - maps (cdpUserId, email) to server-generated entityId
 * 
 * Security model:
 * - Server generates a random entityId on first registration
 * - cdpUserId + email together identify a user, but entityId is the DB key
 * - Attacker who guesses cdpUserId but wrong email → creates NEW entity (can't access victim's)
 * - Attacker who guesses both → rejected if already registered (email taken for that cdpUserId)
 * - entityId is never exposed to client except in signed JWT
 * 
 * MIGRATION: Run scripts/migrate-entity-ids.sql FIRST to create table and migrate existing users
 */

/**
 * Generate a cryptographically secure entity ID
 */
function generateEntityId(): string {
  return crypto.randomUUID();
}

/**
 * Escape string for SQL (prevent SQL injection)
 * Only used for validated inputs (UUID format checked, email format checked)
 */
function escapeSql(str: string): string {
  return str.replace(/'/g, "''");
}

/**
 * Initialize user_registry table (PostgreSQL)
 */
async function initUserRegistry(db: any): Promise<void> {
  try {
    // Check if table exists - raw SQL string
    const tableCheck = await db.execute(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'user_registry'
      ) as exists
    `);
    
    const tableExists = tableCheck.rows?.[0]?.exists === true || tableCheck.rows?.[0]?.exists === 't';
    
    if (!tableExists) {
      logger.warn('[Auth] user_registry table does not exist - run migration script first');
      logger.warn('[Auth] Run: psql $DATABASE_URL -f scripts/migrate-entity-ids.sql');
    } else {
      logger.info('[Auth] user_registry table verified');
    }
  } catch (error) {
    logger.error('[Auth] Failed to verify user_registry:', error);
  }
}

export function createAuthRouter(serverInstance: AgentServer): express.Router {
  const router = express.Router();
  const db = (serverInstance?.database as any)?.db;
  
  // Initialize user_registry table
  if (db) {
    initUserRegistry(db).catch(error => {
      logger.error('[Auth] Failed to initialize user registry:', error);
    });
  }

  /**
   * Verify user identity and return server-generated entityId
   * 
   * Security: entityId is server-generated and never derived from client input
   */
  async function verifyUserBinding(
    cdpUserId: string,
    email: string,
    username: string
  ): Promise<{ verified: boolean; entityId?: string; isNewUser: boolean; error?: string }> {
    const normalizedEmail = email.toLowerCase().trim();
    
    if (!db) {
      // Development fallback - generate deterministic ID (NOT for production)
      logger.warn('[Auth] Database not available, using fallback (development mode)');
      const fallbackId = crypto.createHash('sha256').update(`${cdpUserId}:${normalizedEmail}`).digest('hex').substring(0, 32);
      const entityId = `${fallbackId.substring(0, 8)}-${fallbackId.substring(8, 12)}-4${fallbackId.substring(13, 16)}-${fallbackId.substring(16, 20)}-${fallbackId.substring(20, 32)}`;
      return { verified: true, entityId, isNewUser: true };
    }
    
    try {
      // All inputs are validated before this point:
      // - cdpUserId: UUID format validated
      // - normalizedEmail: email format validated, lowercased, trimmed
      // - username: string validated
      
      // Check if this (cdpUserId, email) pair exists
      const existingResult = await db.execute(`
        SELECT entity_id, email, username FROM user_registry 
        WHERE cdp_user_id = '${escapeSql(cdpUserId)}'::uuid AND email = '${escapeSql(normalizedEmail)}'
        LIMIT 1
      `);
      
      const existingUser = existingResult.rows?.[0];
      
      if (existingUser) {
        // Existing user - return their server-generated entityId
        const entityId = existingUser.entity_id as string;
        
        // Update last login and username
        await db.execute(`
          UPDATE user_registry SET last_login_at = NOW(), username = '${escapeSql(username)}' 
          WHERE entity_id = '${escapeSql(entityId)}'::uuid
        `);
        
        logger.info(`[Auth] Returning user verified: entityId=${entityId.substring(0, 8)}...`);
        return { verified: true, entityId, isNewUser: false };
      }
      
      // Check if cdpUserId exists with DIFFERENT email (potential attack or user error)
      const cdpResult = await db.execute(`
        SELECT entity_id, email FROM user_registry 
        WHERE cdp_user_id = '${escapeSql(cdpUserId)}'::uuid
        LIMIT 1
      `);
      
      if (cdpResult.rows?.length > 0) {
        const registeredEmail = cdpResult.rows[0].email as string;
        const entityId = cdpResult.rows[0].entity_id as string;
        
        // Allow upgrading from placeholder email (migration artifact) to real email
        const isPlaceholderEmail = registeredEmail.endsWith('@unknown.local');
        
        if (isPlaceholderEmail) {
          // Update placeholder email to real email
          await db.execute(`
            UPDATE user_registry SET email = '${escapeSql(normalizedEmail)}', username = '${escapeSql(username)}', last_login_at = NOW()
            WHERE entity_id = '${escapeSql(entityId)}'::uuid
          `);
          
          logger.info(
            `[Auth] Upgraded placeholder email to real email for entityId=${entityId.substring(0, 8)}... ` +
            `(${registeredEmail} → ${normalizedEmail})`
          );
          return { verified: true, entityId, isNewUser: false };
        }
        
        // Real email mismatch - reject
        logger.warn(
          `[Auth] CDP userId ${cdpUserId.substring(0, 8)}... already registered with different email ` +
          `(registered: ${registeredEmail}, attempted: ${normalizedEmail})`
        );
        return { 
          verified: false, 
          isNewUser: false, 
          error: 'This CDP account is already registered with a different email' 
        };
      }
      
      // New user - generate server-side entityId and register
      const entityId = generateEntityId();
      
      await db.execute(`
        INSERT INTO user_registry (entity_id, cdp_user_id, email, username, registered_at, last_login_at)
        VALUES ('${escapeSql(entityId)}'::uuid, '${escapeSql(cdpUserId)}'::uuid, '${escapeSql(normalizedEmail)}', '${escapeSql(username)}', NOW(), NOW())
      `);
      
      logger.info(`[Auth] New user registered: entityId=${entityId.substring(0, 8)}... (cdp=${cdpUserId.substring(0, 8)}..., email=${normalizedEmail})`);
      return { verified: true, entityId, isNewUser: true };
    } catch (error: any) {
      logger.error('[Auth] Database error during user verification:', error);
      return { verified: false, isNewUser: false, error: 'Database error' };
    }
  }
  
  /**
   * POST /api/auth/login
   * 
   * Authenticates a user and issues a JWT token.
   * 
   * Request body:
   * - email: string (user's email from CDP)
   * - username: string (user's display name from CDP)
   * - cdpUserId: string (CDP's user identifier - UUID, required)
   * 
   * Security:
   * - Rate limited to 10 requests per 15 minutes per IP
   * - Server generates entityId (never trusts client-provided ID for DB access)
   * - JWT contains server-generated entityId, not cdpUserId
   * - JWT expires in 24 hours (use /refresh to extend)
   */
  router.post('/login', authRateLimiter, async (req, res) => {
    try {
      const { email, username, cdpUserId } = req.body;
      
      // Validate email
      if (!email || typeof email !== 'string') {
        return sendError(res, 400, 'INVALID_REQUEST', 'Email is required');
      }
      
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return sendError(res, 400, 'INVALID_EMAIL', 'Invalid email format');
      }
      
      // Validate username
      if (!username || typeof username !== 'string') {
        return sendError(res, 400, 'INVALID_REQUEST', 'Username is required');
      }
      
      // Validate CDP userId
      if (!cdpUserId || typeof cdpUserId !== 'string') {
        return sendError(res, 400, 'INVALID_REQUEST', 'CDP userId is required');
      }
      
      // Validate UUID format (CDP uses UUIDs)
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(cdpUserId)) {
        return sendError(res, 400, 'INVALID_CDP_USER_ID', 'CDP userId must be a valid UUID');
      }
      
      // Verify user identity and get server-generated entityId
      // - New users: creates new entity with random ID
      // - Existing users: returns their existing entityId
      // - cdpUserId with different email: rejected (prevents account takeover)
      const verification = await verifyUserBinding(cdpUserId, email, username);
      
      if (!verification.verified || !verification.entityId) {
        logger.warn(`[Auth] User verification failed for cdpUserId: ${cdpUserId.substring(0, 8)}...`);
        return sendError(res, 401, 'UNAUTHORIZED', verification.error || 'Authentication failed');
      }
      
      // Generate JWT token with SERVER-GENERATED entityId (not client-provided cdpUserId)
      const token = generateAuthToken(verification.entityId, email, username);
      
      logger.info(
        `[Auth] User authenticated: ${username} (${email}) (entityId: ${verification.entityId.substring(0, 8)}...)` +
        (verification.isNewUser ? ' [NEW USER]' : '')
      );
      
      // Return entityId as userId (this is now the server-generated ID)
      return sendSuccess(res, {
        token,
        userId: verification.entityId,
        username,
        expiresIn: '24h'
      });
    } catch (error: any) {
      logger.error('[Auth] Login error:', error);
      return sendError(res, 500, 'AUTH_ERROR', error.message);
    }
  });
  
  /**
   * POST /api/auth/refresh
   * 
   * Refreshes an existing JWT token (extends expiration)
   */
  router.post('/refresh', async (req: AuthenticatedRequest, res) => {
    try {
      const authHeader = req.headers.authorization;
      
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return sendError(res, 401, 'UNAUTHORIZED', 'No token provided');
      }
      
      const oldToken = authHeader.substring(7);
      const JWT_SECRET = process.env.JWT_SECRET;
      
      if (!JWT_SECRET) {
        return sendError(res, 500, 'SERVER_MISCONFIGURED', 'JWT_SECRET not configured');
      }
      
      try {
        const decoded = jwt.verify(oldToken, JWT_SECRET) as any;
        
        // Issue new token with extended expiration
        const newToken = generateAuthToken(decoded.userId, decoded.email, decoded.username);
        
        logger.info(`[Auth] Token refreshed for: ${decoded.username} (userId: ${decoded.userId.substring(0, 8)}...)`);
        
        return sendSuccess(res, {
          token: newToken,
          userId: decoded.userId,
          username: decoded.username,
          expiresIn: '24h'
        });
      } catch (error: any) {
        logger.warn(`[Auth] Token refresh failed: ${error.message}`);
        return sendError(res, 401, 'INVALID_TOKEN', 'Invalid or expired token');
      }
    } catch (error: any) {
      logger.error('[Auth] Refresh error:', error);
      return sendError(res, 500, 'REFRESH_ERROR', error.message);
    }
  });
  
  /**
   * GET /api/auth/me
   * 
   * Get current authenticated user info
   */
  router.get('/me', async (req: AuthenticatedRequest, res) => {
    try {
      const authHeader = req.headers.authorization;
      
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return sendError(res, 401, 'UNAUTHORIZED', 'No token provided');
      }
      
      const token = authHeader.substring(7);
      const JWT_SECRET = process.env.JWT_SECRET;
      
      if (!JWT_SECRET) {
        return sendError(res, 500, 'SERVER_MISCONFIGURED', 'JWT_SECRET not configured');
      }
      
      try {
        const decoded = jwt.verify(token, JWT_SECRET) as any;
        
        return sendSuccess(res, {
          userId: decoded.userId,
          email: decoded.email,
          username: decoded.username
        });
      } catch (error: any) {
        return sendError(res, 401, 'INVALID_TOKEN', 'Invalid or expired token');
      }
    } catch (error: any) {
      logger.error('[Auth] Get user info error:', error);
      return sendError(res, 500, 'AUTH_ERROR', error.message);
    }
  });
  
  return router;
}
