import { useState } from 'react';
import { useSignInWithEmail, useVerifyEmailOTP } from "@coinbase/cdp-hooks";
import { useCDPWallet } from '@/hooks/useCDPWallet';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Bullet } from '@/components/ui/bullet';

/**
 * CDP Wallet Card Component
 * 
 * Handles CDP (Coinbase Developer Platform) wallet authentication and display.
 * Features:
 * - Configuration status check
 * - Email-based authentication with OTP
 * - Wallet address display when connected
 * - Proper error handling
 */
export function CDPWalletCard() {
  // Use custom CDP wallet hook for centralized wallet state
  const { isInitialized, isSignedIn, evmAddress, isCdpConfigured, signOut } = useCDPWallet();

  // CDP hooks for authentication
  const { signInWithEmail } = useSignInWithEmail();
  const { verifyEmailOTP } = useVerifyEmailOTP();

  // Local state for auth flow
  const [flowId, setFlowId] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');

  // Show configuration guide if CDP is not set up
  if (!isCdpConfigured) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2.5">
            <Bullet />
            CDP Wallet (Optional)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="text-xs text-muted-foreground space-y-2">
            <p>CDP Wallet integration is optional and currently not configured.</p>
            <p className="font-mono">To enable CDP features:</p>
            <ol className="list-decimal list-inside space-y-1 ml-2">
              <li>Get a project ID from <a href="https://portal.cdp.coinbase.com" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">CDP Portal</a></li>
              <li>Whitelist your domain at <a href="https://portal.cdp.coinbase.com/products/embedded-wallets/domains" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Domains Config</a></li>
              <li>Create a <code className="bg-muted px-1 py-0.5 rounded">.env</code> file</li>
              <li>Add: <code className="bg-muted px-1 py-0.5 rounded">VITE_CDP_PROJECT_ID=your-id</code></li>
              <li>Restart the server</li>
            </ol>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Show loading state while CDP is initializing
  if (!isInitialized) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2.5">
            <Bullet />
            CDP Wallet
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
              <p className="mt-2 text-xs text-muted-foreground">Initializing wallet...</p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Handle email submission (first step)
  const handleEmailSubmit = async () => {
    if (!email) return;
    setError('');
    try {
      const result = await signInWithEmail({ email });
      setFlowId(result.flowId);
    } catch (err: any) {
      setError(err.message || 'Sign in failed');
      console.error("CDP sign in failed:", err);
    }
  };

  // Handle OTP verification (second step)
  const handleOtpSubmit = async () => {
    if (!flowId || !otp) return;
    setError('');
    try {
      const { user } = await verifyEmailOTP({ flowId, otp });
      console.log("CDP wallet connected!", user.evmAccounts?.[0]);
      // Reset form
      setFlowId(null);
      setEmail('');
      setOtp('');
    } catch (err: any) {
      setError(err.message || 'OTP verification failed');
      console.error("CDP OTP verification failed:", err);
    }
  };

  // Handle going back to email input
  const handleBack = () => {
    setFlowId(null);
    setOtp('');
    setError('');
  };

  // Handle sign out with error handling
  const handleSignOut = async () => {
    try {
      await signOut();
      console.log("CDP wallet signed out successfully");
    } catch (err: any) {
      console.error("Sign out failed:", err);
      setError(err.message || 'Sign out failed');
    }
  };

  // Show connected state with wallet address
  if (isSignedIn) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2.5">
            <Bullet />
            CDP Wallet
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col gap-2">
            <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Status</span>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
              <span className="text-sm font-mono">Connected</span>
            </div>
          </div>
          {evmAddress && (
            <div className="flex flex-col gap-2">
              <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">EVM Address</span>
              <code className="text-xs bg-muted p-2 rounded font-mono break-all">
                {evmAddress}
              </code>
            </div>
          )}
          <Button 
            onClick={handleSignOut} 
            variant="outline" 
            className="w-full"
            size="sm"
          >
            Sign Out
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Show sign-in flow
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2.5">
          <Bullet />
          CDP Wallet Sign In
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Error message */}
        {error && (
          <div className="text-xs text-red-500 bg-red-500/10 p-2 rounded">
            {error}
          </div>
        )}
        
        {/* OTP verification step */}
        {flowId ? (
          <div className="space-y-3">
            <div className="flex flex-col gap-2">
              <label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
                Enter OTP Code
              </label>
              <Input
                type="text"
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                placeholder="000000"
                className="font-mono"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleOtpSubmit();
                  }
                }}
              />
              <span className="text-xs text-muted-foreground">
                Check your email for the verification code
              </span>
            </div>
            <Button onClick={handleOtpSubmit} className="w-full" disabled={!otp}>
              Verify OTP
            </Button>
            <Button 
              onClick={handleBack} 
              variant="outline" 
              className="w-full"
            >
              Back
            </Button>
          </div>
        ) : (
          /* Email input step */
          <div className="space-y-3">
            <div className="flex flex-col gap-2">
              <label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
                Email Address
              </label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                className="font-mono"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleEmailSubmit();
                  }
                }}
              />
            </div>
            <Button onClick={handleEmailSubmit} className="w-full" disabled={!email}>
              Send OTP
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

