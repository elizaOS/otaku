/**
 * Consolidated middleware for the Otaku server
 * All middleware is organized into logical modules for better maintainability
 */

// API Key authentication middleware
export { apiKeyAuthMiddleware } from './auth';

// JWT authentication middleware (user sessions, admin roles)
export {
  generateAuthToken,
  requireAuth,
  optionalAuth,
  requireAuthOrApiKey,
  requireAdmin,
  type AuthTokenPayload,
  type AuthenticatedRequest,
} from './jwt';

// Security middleware
export { securityMiddleware } from './security';

// Rate limiting middleware
export {
  createApiRateLimit,
  createFileSystemRateLimit,
  createUploadRateLimit,
  createChannelValidationRateLimit,
} from './rate-limit';

// Validation middleware (includes channel-specific auth)
export {
  agentExistsMiddleware,
  validateUuidMiddleware,
  validateChannelIdMiddleware,
  validateContentTypeMiddleware,
  requireChannelParticipant,
  requireAuthenticated,
} from './validation';
