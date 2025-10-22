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
  iat: number;
  exp: number;
}

export interface AuthenticatedRequest extends Request {
  userId?: string;
  userEmail?: string;
  username?: string;
}

/**
 * Generate JWT authentication token
 * Uses CDP's userId directly (no generation or salting needed)
 */
export function generateAuthToken(userId: string, email: string, username: string): string {
  if (!JWT_SECRET) {
    throw new Error('JWT_SECRET not configured');
  }
  
  return jwt.sign(
    { userId, email, username },
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
    
    // Log successful auth (debug level to avoid spam)
    logger.debug(`[Auth] Authenticated request from user: ${decoded.username} (${decoded.userId.substring(0, 8)}...)`);
    
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
export function optionalAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
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
  } catch (error) {
    // Ignore invalid tokens for optional auth
    logger.debug('[Auth] Optional auth - invalid token ignored');
  }
  
  next();
}

