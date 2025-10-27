import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import { logger } from '@elizaos/core';

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  logger.warn('[Auth] JWT_SECRET not set - authentication will not work. Set JWT_SECRET environment variable.');
}

export interface AuthTokenPayload {
  userId: string;
  email: string;
  username: string;
  isAdmin?: boolean;
  iat: number;
  exp: number;
}

export interface AuthenticatedRequest extends Request {
  userId?: string;
  userEmail?: string;
  username?: string;
  isAdmin?: boolean;
  isServerAuthenticated?: boolean;
}

/**
 * Generate JWT authentication token
 * Uses CDP's userId directly (no generation or salting needed)
 */
export function generateAuthToken(userId: string, email: string, username: string, isAdmin?: boolean): string {
  if (!JWT_SECRET) {
    throw new Error('JWT_SECRET not configured');
  }
  
  // Check if user is admin based on environment variable
  const adminEmails = process.env.ADMIN_EMAILS?.split(',').map(e => e.trim().toLowerCase()) || [];
  const computedIsAdmin = isAdmin || adminEmails.includes(email.toLowerCase());
  
  const payload: Omit<AuthTokenPayload, 'iat' | 'exp'> = {
    userId,
    email,
    username,
    ...(computedIsAdmin && { isAdmin: true }),
  };
  
  return jwt.sign(
    payload,
    JWT_SECRET,
    { expiresIn: '7d' } // Token expires in 7 days
  );
}

/**
 * Middleware to verify JWT token and extract user info
 * Requires authentication - returns 401 if no valid token
 */
export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (!JWT_SECRET) {
    logger.error('[Auth] JWT_SECRET not configured - cannot verify tokens');
    return res.status(500).json({
      success: false,
      error: {
        code: 'SERVER_MISCONFIGURED',
        message: 'Authentication system not properly configured'
      }
    });
  }

  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication required. Please provide a valid Bearer token.'
      }
    });
  }

  const token = authHeader.substring(7); // Remove 'Bearer ' prefix
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as AuthTokenPayload;
    req.userId = decoded.userId;
    req.userEmail = decoded.email;
    req.username = decoded.username;
    req.isAdmin = decoded.isAdmin || false;
    
    // Log successful auth (debug level to avoid spam)
    logger.debug(`[Auth] Authenticated request from user: ${decoded.username} (${decoded.userId.substring(0, 8)}...)${req.isAdmin ? ' [ADMIN]' : ''}`);
    
    next();
  } catch (error: any) {
    logger.warn(`[Auth] Token verification failed: ${error.message}`);
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: {
          code: 'TOKEN_EXPIRED',
          message: 'Authentication token has expired. Please sign in again.'
        }
      });
    }
    
    return res.status(401).json({
      success: false,
      error: {
        code: 'INVALID_TOKEN',
        message: 'Invalid authentication token.'
      }
    });
  }
}

/**
 * Optional middleware for endpoints that work with or without auth
 * If token is provided and valid, sets userId and userEmail
 * If token is invalid or missing, continues without setting them
 */
export function optionalAuth(req: AuthenticatedRequest, next: NextFunction) {
  if (!JWT_SECRET) {
    return next();
  }

  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next();
  }

  const token = authHeader.substring(7);
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as AuthTokenPayload;
    req.userId = decoded.userId;
    req.userEmail = decoded.email;
    req.username = decoded.username;
    req.isAdmin = decoded.isAdmin || false;
  } catch (error) {
    // Ignore invalid tokens for optional auth
    logger.debug('[Auth] Optional auth - invalid token ignored');
  }
  
  next();
}

/**
 * Middleware to accept either JWT Bearer token or X-API-KEY.
 * - If JWT is valid, sets user fields on request.
 * - If X-API-KEY matches ELIZA_SERVER_AUTH_TOKEN, marks request as server-authenticated.
 * - Otherwise, returns 401.
 */
export function requireAuthOrApiKey(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  // First try standard JWT auth
  const authHeader = req.headers.authorization;
  const serverAuthToken = process.env.ELIZA_SERVER_AUTH_TOKEN;

  // Try JWT path if present
  if (authHeader && authHeader.startsWith('Bearer ')) {
    if (!JWT_SECRET) {
      logger.error('[Auth] JWT_SECRET not configured - cannot verify tokens');
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_MISCONFIGURED', message: 'Authentication system not properly configured' },
      });
    }

    const token = authHeader.substring(7);
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as AuthTokenPayload;
      req.userId = decoded.userId;
      req.userEmail = decoded.email;
      req.username = decoded.username;
      req.isAdmin = decoded.isAdmin || false;
      logger.debug(`[Auth] Authenticated via JWT: ${decoded.username} (${decoded.userId.substring(0, 8)}...)${req.isAdmin ? ' [ADMIN]' : ''}`);
      return next();
    } catch (error: any) {
      logger.warn(`[Auth] JWT verification failed in requireAuthOrApiKey: ${error.message}`);
      // Fall through to API key check
    }
  }

  // Try API key path
  const apiKey = (req.headers?.['x-api-key'] as string | undefined) || undefined;
  if (serverAuthToken && apiKey && apiKey === serverAuthToken) {
    req.isServerAuthenticated = true;
    logger.debug('[Auth] Authenticated via X-API-KEY (server)');
    return next();
  }

  // Neither JWT nor API key valid
  return res.status(401).json({
    success: false,
    error: { code: 'UNAUTHORIZED', message: 'Authentication required (Bearer token or X-API-KEY).' },
  });
}

/**
 * Middleware to require admin access
 * Must be used after requireAuth middleware
 */
export function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (!req.isAdmin) {
    logger.warn(`[Auth] Non-admin user ${req.username} (${req.userId?.substring(0, 8)}...) attempted admin operation`);
    return res.status(403).json({
      success: false,
      error: {
        code: 'FORBIDDEN',
        message: 'Administrator privileges required for this operation'
      }
    });
  }
  
  next();
}

