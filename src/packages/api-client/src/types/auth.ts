/**
 * Request body for login endpoint
 * 
 * Security: Server validates UUID↔email binding
 * - First login: registers the binding (UUID claimed by this email)
 * - Subsequent logins: email must match what was registered
 * - Attacker needs BOTH correct UUID AND correct email to impersonate
 */
export interface LoginRequest {
  email: string;
  username: string; // User's display name from CDP
  cdpUserId: string; // CDP's user identifier (UUID)
}

/**
 * Response from login endpoint
 */
export interface LoginResponse {
  token: string; // JWT authentication token
  userId: string; // CDP's user ID
  username: string; // User's display name
  expiresIn: string; // Token expiration time (e.g., "24h")
}

/**
 * Response from refresh token endpoint
 */
export interface RefreshTokenResponse {
  token: string; // New JWT authentication token
  userId: string;
  username: string; // User's display name
  expiresIn: string;
}

/**
 * Response from /me endpoint (current user info)
 */
export interface CurrentUserResponse {
  userId: string;
  email: string;
  username: string; // User's display name
}

