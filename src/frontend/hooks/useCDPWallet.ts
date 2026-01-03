import { useMemo } from "react";
import { useIsSignedIn, useSignOut, useIsInitialized, useCurrentUser } from "@coinbase/cdp-hooks";
import { resolveCdpUserInfo, type CdpUser } from "@/frontend/lib/cdpUser";

/**
 * Custom hook to access CDP wallet information
 * 
 * This hook combines multiple CDP hooks and provides a unified interface
 * to access wallet state throughout the application.
 * 
 * @returns {Object} Wallet information including:
 *   - isInitialized: boolean - Whether CDP SDK has finished initializing (IMPORTANT: wait for this before using wallet data)
 *   - isSignedIn: boolean - Whether user is authenticated with CDP wallet
 *   - evmAddress: string | undefined - EVM wallet address (Ethereum, Base, etc.)
 *   - solanaAddress: string | undefined - Solana wallet address
 *   - userEmail: string | undefined - User's email address from CDP
 *   - hasWallet: boolean - Whether user has any wallet connected
 *   - isCdpConfigured: boolean - Whether CDP is properly configured
 *   - signOut: () => Promise<void> - Function to sign out the user
 * 
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { isInitialized, isSignedIn, evmAddress, userEmail, hasWallet, signOut } = useCDPWallet();
 *   
 *   // Always wait for initialization first
 *   if (!isInitialized) {
 *     return <p>Loading wallet...</p>;
 *   }
 *   
 *   if (!isSignedIn) {
 *     return <p>Please sign in to access wallet features</p>;
 *   }
 *   
 *   return (
 *     <div>
 *       <p>Your wallet: {evmAddress}</p>
 *       <p>Your email: {userEmail}</p>
 *       <button onClick={signOut}>Sign Out</button>
 *     </div>
 *   );
 * }
 * ```
 */
export function useCDPWallet() {
  const { isInitialized } = useIsInitialized();
  const { isSignedIn } = useIsSignedIn();
  const { signOut } = useSignOut();
  const { currentUser } = useCurrentUser();

  // Check if CDP is properly configured
  const cdpProjectId = import.meta.env.VITE_CDP_PROJECT_ID;
  const isCdpConfigured = Boolean(cdpProjectId);

  // Normalize user info using shared helper (DRY) - memoized to prevent excessive re-renders
  const { email: userEmail, username: userName } = useMemo(
    () => resolveCdpUserInfo(currentUser as CdpUser | undefined, { isSignedIn }),
    [currentUser, isSignedIn]
  );

  return {
    // Loading state
    isInitialized,
    
    // Auth state
    isSignedIn,
    isCdpConfigured,
    
    // User info
    userEmail,
    userName,
    currentUser: currentUser as CdpUser | undefined, // narrowed for consumers

    // Actions
    signOut,
    
  };
}

/**
 * Type definition for the wallet info returned by useCDPWallet
 */
export type CDPWalletInfo = ReturnType<typeof useCDPWallet>;

