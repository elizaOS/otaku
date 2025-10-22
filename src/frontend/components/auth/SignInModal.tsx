import { useState } from 'react';
import { useSignInWithEmail, useVerifyEmailOTP } from "@coinbase/cdp-hooks";
import { SignInModal as CDPSignInModal } from '@coinbase/cdp-react';
import { useCDPWallet } from '@/hooks/useCDPWallet';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Bullet } from '../ui/bullet';

interface SignInModalProps {
  isOpen: boolean;
}

/**
 * Sign In Modal Component
 * 
 * A full-screen modal that requires users to sign in with CDP wallet
 * before they can access the chat interface.
 * 
 * Features:
 * - Email-based authentication with OTP
 * - "More Options" button to access CDP's native modal (Google OAuth, SMS, etc.)
 * - Full-screen overlay with dimmed background
 * - Cannot be dismissed until authenticated
 * - Clear step-by-step flow
 */
export function SignInModal({ isOpen }: SignInModalProps) {
  // Get CDP initialization state
  const { isInitialized } = useCDPWallet();
  
  // CDP hooks for authentication
  const { signInWithEmail } = useSignInWithEmail();
  const { verifyEmailOTP } = useVerifyEmailOTP();

  // Local state for auth flow
  const [flowId, setFlowId] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showCDPModal, setShowCDPModal] = useState(false);

  // Don't render if not open
  if (!isOpen) return null;


  // Handle email submission (first step)
  const handleEmailSubmit = async () => {
    if (!email || isLoading) return;
    setError('');
    setIsLoading(true);
    try {
      const result = await signInWithEmail({ email });
      setFlowId(result.flowId);
      console.log("✉️ OTP sent to:", email);
    } catch (err: any) {
      setError(err.message || 'Failed to send OTP');
      console.error("CDP sign in failed:", err);
    } finally {
      setIsLoading(false);
    }
  };

  // Handle OTP verification (second step)
  const handleOtpSubmit = async () => {
    if (!flowId || !otp || isLoading) return;
    setError('');
    setIsLoading(true);
    try {
      const { user } = await verifyEmailOTP({ flowId, otp });
      console.log("✅ CDP wallet connected!", user.evmAccounts?.[0]);
      
      // Reset form
      setFlowId(null);
      setEmail('');
      setOtp('');
    } catch (err: any) {
      setError(err.message || 'Invalid OTP code');
      console.error("CDP OTP verification failed:", err);
    } finally {
      setIsLoading(false);
    }
  };

  // Handle going back to email input
  const handleBack = () => {
    setFlowId(null);
    setOtp('');
    setError('');
  };

  // Handle CDP modal success
  const handleCDPModalSuccess = () => {
    console.log("✅ CDP modal authentication successful");
    setShowCDPModal(false);
    // The authentication state will be picked up by App.tsx useEffect
  };

  return (
    <>
      {/* Custom Email OTP Modal - Hide when CDP modal is open */}
      {!showCDPModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
       <Card className="w-full max-w-md mx-4 bg-background">
         <CardHeader className="flex items-center justify-between pl-3 pr-1">
            <CardTitle className="flex items-center gap-2.5 text-sm font-medium uppercase">
                <Bullet />
                Sign In
            </CardTitle>
         </CardHeader>
        <CardContent className="bg-pop">
          {/* Error message */}
          {error && (
            <div className="text-xs text-red-500 bg-red-500/10 p-3 rounded border border-red-500/20">
              {error}
            </div>
          )}
          
          {/* OTP verification step */}
          {flowId ? (
            <div className="space-y-4">
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium">
                  Verification Code
                </label>
                <Input
                  type="text"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                  placeholder="000000"
                  className="font-mono text-center text-lg tracking-wider"
                  maxLength={6}
                  disabled={isLoading}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleOtpSubmit();
                    }
                  }}
                  autoFocus
                />
                <span className="text-xs text-muted-foreground text-center">
                  Check your email <span className="font-mono text-primary">{email}</span> for the 6-digit code
                </span>
              </div>
              <Button 
                onClick={handleOtpSubmit} 
                className="w-full" 
                disabled={!otp || otp.length !== 6 || isLoading}
              >
                {isLoading ? 'Verifying...' : 'Verify & Sign In'}
              </Button>
              <Button 
                onClick={handleBack} 
                variant="ghost" 
                className="w-full"
                disabled={isLoading}
              >
                Use Different Email
              </Button>
            </div>
          ) : (
            /* Email input step */
            <div className="space-y-4">
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium">
                  Email Address
                </label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  disabled={isLoading}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleEmailSubmit();
                    }
                  }}
                  autoFocus
                />
              </div>
              <Button 
                onClick={handleEmailSubmit} 
                className="w-full" 
                disabled={!email || isLoading}
              >
                {isLoading ? 'Sending...' : 'Send Verification Code'}
              </Button>

              {/* Divider */}
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-border" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-pop px-2 text-muted-foreground">
                    Or
                  </span>
                </div>
              </div>

              {/* More Options Button - Opens CDP Modal with Google OAuth */}
              <Button 
                onClick={() => setShowCDPModal(true)} 
                variant="outline"
                className="w-full"
                disabled={!isInitialized || isLoading}
              >
                {!isInitialized ? 'Initializing...' : 'More Options (Google, SMS)'}
              </Button>
            </div>
          )}

          {/* Info section */}
          <div className="pt-4 border-t border-border">
            <div className="flex items-center justify-center gap-2">
              <div className="text-xs text-muted-foreground">
                Protected by 
              </div>
              <img 
                src="/assets/Coinbase_Wordmark.svg" 
                alt="Coinbase" 
                className="h-3 w-auto"
              />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
      )}

      {/* CDP Native Modal - Opens when "More Options" is clicked */}
      {showCDPModal && (
        <CDPSignInModal 
          open={showCDPModal}
          setIsOpen={setShowCDPModal}
          onSuccess={handleCDPModalSuccess}
        />
      )}
    </>
  );
}

