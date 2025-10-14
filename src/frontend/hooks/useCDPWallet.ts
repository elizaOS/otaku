import { useIsSignedIn, useEvmAddress, useSolanaAddress, useSignOut, useIsInitialized } from "@coinbase/cdp-hooks";

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
 *   - hasWallet: boolean - Whether user has any wallet connected
 *   - isCdpConfigured: boolean - Whether CDP is properly configured
 *   - signOut: () => Promise<void> - Function to sign out the user
 * 
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { isInitialized, isSignedIn, evmAddress, hasWallet, signOut } = useCDPWallet();
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
 *       <button onClick={signOut}>Sign Out</button>
 *     </div>
 *   );
 * }
 * ```
 */
export function useCDPWallet() {
  const { isInitialized } = useIsInitialized();
  const { isSignedIn } = useIsSignedIn();
  const { evmAddress } = useEvmAddress();
  const { solanaAddress } = useSolanaAddress();
  const { signOut } = useSignOut();

  // Check if CDP is properly configured
  const cdpProjectId = import.meta.env.VITE_CDP_PROJECT_ID;
  const isCdpConfigured = Boolean(cdpProjectId && cdpProjectId !== 'your-project-id');

  // Derive additional useful states
  const hasWallet = Boolean(evmAddress || solanaAddress);

  return {
    // Loading state
    isInitialized,
    
    // Auth state
    isSignedIn,
    isCdpConfigured,
    
    // Wallet addresses
    evmAddress,
    solanaAddress,
    
    // Derived states
    hasWallet,
    
    // Actions
    signOut,
    
    // Utility helpers
    shortEvmAddress: evmAddress ? `${evmAddress.slice(0, 6)}...${evmAddress.slice(-4)}` : undefined,
    shortSolanaAddress: solanaAddress ? `${solanaAddress.slice(0, 6)}...${solanaAddress.slice(-4)}` : undefined,
  };
}

/**
 * Type definition for the wallet info returned by useCDPWallet
 */
export type CDPWalletInfo = ReturnType<typeof useCDPWallet>;

