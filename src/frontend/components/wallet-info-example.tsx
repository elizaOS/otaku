import { useCDPWallet } from '@/hooks/useCDPWallet';

/**
 * Example component demonstrating how to use the useCDPWallet hook
 * 
 * This component can be placed anywhere in the app (within CDPReactProvider)
 * and will have access to the user's wallet information.
 * 
 * You can use this pattern in any component that needs wallet info:
 * - Chat interface (to show user's wallet)
 * - Transaction buttons (to check if user is signed in)
 * - Profile pages (to display wallet address)
 * - Any component that needs to know wallet state
 */
export function WalletInfoExample() {
  const { 
    isSignedIn, 
    evmAddress, 
    solanaAddress,
    hasWallet,
    shortEvmAddress,
    isCdpConfigured,
    signOut 
  } = useCDPWallet();

  // Early return if CDP is not configured
  if (!isCdpConfigured) {
    return (
      <div className="p-4 bg-yellow-500/10 rounded">
        <p className="text-sm text-yellow-600">
          CDP wallet is not configured. Check .env file.
        </p>
      </div>
    );
  }

  // Show sign-in prompt if not authenticated
  if (!isSignedIn) {
    return (
      <div className="p-4 bg-blue-500/10 rounded">
        <p className="text-sm text-blue-600">
          Please sign in with CDP wallet to access wallet features.
        </p>
      </div>
    );
  }

  // Show wallet information
  return (
    <div className="p-4 bg-green-500/10 rounded space-y-2">
      <h3 className="text-sm font-semibold text-green-600">Wallet Connected</h3>
      
      {evmAddress && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">EVM Address:</p>
          <code className="text-xs font-mono">{shortEvmAddress}</code>
        </div>
      )}
      
      {solanaAddress && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Solana Address:</p>
          <code className="text-xs font-mono">{solanaAddress}</code>
        </div>
      )}
      
      {hasWallet && (
        <p className="text-xs text-green-600">✓ Wallet ready for transactions</p>
      )}
      
      <button
        onClick={signOut}
        className="text-xs text-red-600 hover:text-red-700 underline mt-2"
      >
        Sign Out
      </button>
    </div>
  );
}

/**
 * Another example: A button that only shows when wallet is connected
 */
export function WalletActionButton() {
  const { isSignedIn, evmAddress } = useCDPWallet();

  if (!isSignedIn || !evmAddress) {
    return null; // Don't show button if no wallet
  }

  const handleAction = () => {
    console.log('Performing action with wallet:', evmAddress);
    // Your transaction logic here
  };

  return (
    <button 
      onClick={handleAction}
      className="px-4 py-2 bg-primary text-white rounded hover:bg-primary/90"
    >
      Send Transaction
    </button>
  );
}

/**
 * Example: Show wallet address in header/navbar
 */
export function WalletAddressDisplay() {
  const { isSignedIn, shortEvmAddress } = useCDPWallet();

  if (!isSignedIn) {
    return <span className="text-sm text-muted-foreground">Not connected</span>;
  }

  return (
    <div className="flex items-center gap-2">
      <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
      <code className="text-xs font-mono">{shortEvmAddress}</code>
    </div>
  );
}

