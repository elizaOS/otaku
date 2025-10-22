// Utilities for extracting normalized user info from CDP currentUser

export interface CdpAuthMethod {
  email?: string;
  name?: string;
}

export interface CdpAuthenticationMethods {
  email?: CdpAuthMethod;
  oauth?: CdpAuthMethod;
  google?: CdpAuthMethod;
}

export interface CdpUser {
  userId?: string;
  email?: string;
  name?: string;
  displayName?: string;
  authenticationMethods?: CdpAuthenticationMethods;
}

export interface CdpUserInfoOptions {
  isSignedIn?: boolean;
}

export interface CdpUserInfo {
  email?: string;
  username?: string;
}

export function extractEmailFromCdpUser(
  user: CdpUser | undefined,
  isSignedIn: boolean
): string | undefined {
  if (!user) return undefined;
  return (
    user.authenticationMethods?.email?.email ||
    user.authenticationMethods?.oauth?.email ||
    user.authenticationMethods?.google?.email ||
    user.email ||
    (isSignedIn && user.userId ? `${user.userId}@cdp.local` : undefined)
  );
}

export function extractUsernameFromCdpUser(
  user: CdpUser | undefined,
  emailForFallback?: string
): string | undefined {
  if (!user) return emailForFallback ? emailForFallback.split("@")[0] : undefined;
  return (
    user.authenticationMethods?.oauth?.name ||
    user.authenticationMethods?.google?.name ||
    user.authenticationMethods?.email?.name ||
    user.name ||
    user.displayName ||
    (emailForFallback ? emailForFallback.split("@")[0] : undefined)
  );
}

export function resolveCdpUserInfo(
  user: CdpUser | undefined,
  options?: CdpUserInfoOptions
): CdpUserInfo {
  const email = extractEmailFromCdpUser(user, Boolean(options?.isSignedIn));
  const username = extractUsernameFromCdpUser(user, email);
  return { email, username };
}


