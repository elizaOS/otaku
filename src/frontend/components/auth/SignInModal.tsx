import { useState, useEffect } from 'react';
import { 
  useSignInWithEmail, 
  useVerifyEmailOTP,
  useSignInWithSms,
  useVerifySmsOTP,
  useSignInWithOAuth,
} from "@coinbase/cdp-hooks";
import type { OAuth2ProviderType } from "@coinbase/cdp-hooks";
import { useCDPWallet } from '@/frontend/hooks/useCDPWallet';
import { Card, CardContent, CardHeader, CardTitle } from '@/frontend/components/ui/card';
import { Input } from '@/frontend/components/ui/input';
import { Button } from '@/frontend/components/ui/button';
import { Bullet } from '@/frontend/components/ui/bullet';

interface SignInModalProps {
  isOpen: boolean;
}

type AuthMethod = 'email' | 'sms' | 'google';
type AuthStep = 'credentials' | 'verification';

/**
 * Sign In Modal Component
 * 
 * A full-screen modal that requires users to sign in with CDP wallet
 * before they can access the chat interface.
 * 
 * Features:
 * - Email-based authentication with OTP
 * - SMS-based authentication with OTP
 * - Google OAuth authentication
 * - Full-screen overlay with dimmed background
 * - Cannot be dismissed until authenticated
 * - Clear step-by-step flow
 */
export function SignInModal({ isOpen }: SignInModalProps) {
  // Get CDP initialization state
  const { isInitialized } = useCDPWallet();
  
  // Primary auth hooks (always available)
  const emailHook = useSignInWithEmail();
  const emailOtpHook = useVerifyEmailOTP();
  
  // Optional auth hooks - destructure safely
  const smsHook = useSignInWithSms();
  const smsOtpHook = useVerifySmsOTP();
  const oauthHook = useSignInWithOAuth();

  // Local state for auth flow
  const [authMethod, setAuthMethod] = useState<AuthMethod>('email');
  const [authStep, setAuthStep] = useState<AuthStep>('credentials');
  const [flowId, setFlowId] = useState<string | null>(null);
  
  // Email auth state
  const [email, setEmail] = useState('');
  
  // SMS auth state
  const [phoneNumber, setPhoneNumber] = useState('');
  const [countryCode, setCountryCode] = useState('+1');
  
  // OTP state (shared between email and SMS)
  const [otp, setOtp] = useState('');
  
  // UI state
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Monitor OAuth state - MUST BE CALLED BEFORE ANY RETURN
  useEffect(() => {
    if (oauthHook?.oauthState?.status === 'success') {
      console.log(" Google OAuth successful!");
      resetForm();
    } else if (oauthHook?.oauthState?.status === 'error') {
      setError('Google sign-in failed. Please try again.');
      setIsLoading(false);
    }
  }, [oauthHook?.oauthState]);

  // Reset form to initial state
  const resetForm = () => {
    setAuthStep('credentials');
    setFlowId(null);
    setEmail('');
    setPhoneNumber('');
    setOtp('');
    setError('');
    setIsLoading(false);
  };

  // Don't render if not open - MUST BE AFTER ALL HOOKS
  if (!isOpen) return null;

  // Handle email submission (first step)
  const handleEmailSubmit = async () => {
    if (!email || isLoading || !emailHook) return;
    setError('');
    setIsLoading(true);
    try {
      console.log(" Attempting email sign-in with:", email);
      const result = await emailHook.signInWithEmail({ email });
      console.log(" Sign-in successful, flowId:", result.flowId);
      setFlowId(result.flowId);
      setAuthStep('verification');
      console.log(" OTP sent to:", email);
    } catch (err: any) {
      console.error(" CDP email sign in failed:", err);
      console.error("Error details:", JSON.stringify(err, null, 2));
      const errorMessage = err?.message || err?.errorMessage || 'Failed to send OTP';
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  // Handle SMS submission (first step)
  const handleSmsSubmit = async () => {
    if (!phoneNumber || isLoading || !smsHook) return;
    setError('');
    setIsLoading(true);
    try {
      const fullPhoneNumber = `${countryCode}${phoneNumber}`;
      console.log(" Attempting SMS sign-in with:", fullPhoneNumber);
      const result = await smsHook.signInWithSms({ phoneNumber: fullPhoneNumber });
      setFlowId(result.flowId);
      setAuthStep('verification');
      console.log(" OTP sent to:", fullPhoneNumber);
    } catch (err: any) {
      console.error(" CDP SMS sign in failed:", err);
      const errorMessage = err?.message || err?.errorMessage || 'Failed to send SMS OTP';
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  // Handle email OTP verification (second step)
  const handleEmailOtpSubmit = async () => {
    if (!flowId || !otp || isLoading || !emailOtpHook) return;
    setError('');
    setIsLoading(true);
    try {
      const { user } = await emailOtpHook.verifyEmailOTP({ flowId, otp });
      console.log(" CDP wallet connected via email!", user.evmAccounts?.[0]);
      resetForm();
    } catch (err: any) {
      console.error(" CDP email OTP verification failed:", err);
      const errorMessage = err?.message || err?.errorMessage || 'Invalid OTP code';
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  // Handle SMS OTP verification (second step)
  const handleSmsOtpSubmit = async () => {
    if (!flowId || !otp || isLoading || !smsOtpHook) return;
    setError('');
    setIsLoading(true);
    try {
      const { user } = await smsOtpHook.verifySmsOTP({ flowId, otp });
      console.log(" CDP wallet connected via SMS!", user.evmAccounts?.[0]);
      resetForm();
    } catch (err: any) {
      console.error(" CDP SMS OTP verification failed:", err);
      const errorMessage = err?.message || err?.errorMessage || 'Invalid OTP code';
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  // Handle Google OAuth
  const handleGoogleSignIn = async () => {
    if (isLoading || !oauthHook) return;
    setError('');
    setIsLoading(true);
    try {
      await oauthHook.signInWithOAuth('google' as OAuth2ProviderType);
      console.log(" Redirecting to Google OAuth...");
      // OAuth will redirect, so we don't need to do anything else
    } catch (err: any) {
      console.error(" CDP Google OAuth failed:", err);
      const errorMessage = err?.message || err?.errorMessage || 'Failed to start Google sign-in';
      setError(errorMessage);
      setIsLoading(false);
    }
  };

  // Handle going back to credentials input
  const handleBack = () => {
    setAuthMethod('email');
    setAuthStep('credentials');
    setFlowId(null);
    setOtp('');
    setError('');
  };

  // Handle method change
  const handleMethodChange = (method: AuthMethod) => {
    setAuthMethod(method);
    setError('');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 ">
      <Card className="w-full max-w-md mx-4 bg-background">
        <CardHeader className="flex items-center justify-between pl-3 pr-1">
          <CardTitle className="flex items-center gap-2.5 text-sm font-medium uppercase">
            <Bullet />
            Sign In
          </CardTitle>
        </CardHeader>
        <CardContent className="bg-pop space-y-4">
          {/* Error message */}
          {error && (
            <div className="text-xs text-red-500 bg-red-500/10 p-3 rounded border border-red-500/20">
              {error}
            </div>
          )}
          
          {/* OTP verification step (for email and SMS) */}
          {authStep === 'verification' && (authMethod === 'email' || authMethod === 'sms') && (
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
                      authMethod === 'email' ? handleEmailOtpSubmit() : handleSmsOtpSubmit();
                    }
                  }}
                  autoFocus
                />
                <span className="text-xs text-muted-foreground text-center">
                  {authMethod === 'email' ? (
                    <>Check your email <span className="font-mono text-primary">{email}</span> for the 6-digit code</>
                  ) : (
                    <>Check your phone <span className="font-mono text-primary">{countryCode}{phoneNumber}</span> for the 6-digit code</>
                  )}
                </span>
              </div>
              <Button 
                onClick={authMethod === 'email' ? handleEmailOtpSubmit : handleSmsOtpSubmit} 
                className="w-full font-medium" 
                disabled={!otp || otp.length !== 6 || isLoading}
              >
                {isLoading ? 'Verifying...' : 'Verify & sign in'}
              </Button>
              <Button 
                onClick={handleBack} 
                variant="ghost" 
                className="w-full font-medium"
                disabled={isLoading}
              >
                Back to sign in
              </Button>
            </div>
          )}

          {/* SMS credentials step */}
          {authStep === 'credentials' && authMethod === 'sms' && (
            <div className="space-y-4">
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium">
                  Phone Number
                </label>
                <div className="flex gap-2">
                  <select
                    value={countryCode}
                    onChange={(e) => setCountryCode(e.target.value)}
                    className="pl-3 pr-8 py-2 bg-background border border-input rounded-md text-sm appearance-none bg-size-[16px] bg-position-[right_0.5rem_center] bg-no-repeat"
                    style={{ backgroundImage: "url(\"data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e\")" }}
                    disabled={isLoading}
                  >
                    <option value="+1"> +1</option>
                    <option value="+55"> +55</option>
                    <option value="+57"> +57</option>
                    <option value="+91"> +91</option>
                    <option value="+254"> +254</option>
                    <option value="+52"> +52</option>
                    <option value="+63"> +63</option>
                    <option value="+971"> +971</option>
                    <option value="+44"> +44</option>
                  </select>
                  <Input
                    type="tel"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value.replace(/[^0-9]/g, ''))}
                    placeholder="5551234567"
                    disabled={isLoading}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleSmsSubmit();
                      }
                    }}
                    className="flex-1"
                    autoFocus
                  />
                </div>
              </div>
              <Button 
                onClick={handleSmsSubmit} 
                className="w-full font-medium" 
                disabled={!phoneNumber || phoneNumber.length < 7 || isLoading}
              >
                {isLoading ? 'Sending...' : 'Send verification code'}
              </Button>
              <Button 
                onClick={handleBack} 
                variant="ghost" 
                className="w-full font-medium"
                disabled={isLoading}
              >
                Back to sign in
              </Button>
            </div>
          )}

          {/* Main credentials screen - All options visible */}
          {authStep === 'credentials' && authMethod === 'email' && (
            <div className="space-y-4">
              {/* Email input section */}
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium">
                  Email address
                </label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
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
                className="w-full font-medium" 
                disabled={!email || isLoading}
              >
                {isLoading ? 'Sending...' : 'Continue'}
              </Button>

              {/* OR divider */}
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-border"></div>
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-pop px-2 text-muted-foreground">OR</span>
                </div>
              </div>

              {/* Continue with phone button */}
              <Button 
                onClick={() => handleMethodChange('sms')}
                variant="outline"
                className="w-full font-medium"
                disabled={isLoading}
              >
                <svg 
                  className="w-5 h-5 mr-2" 
                  fill="none" 
                  stroke="currentColor" 
                  viewBox="0 0 24 24"
                >
                  <path 
                    strokeLinecap="round" 
                    strokeLinejoin="round" 
                    strokeWidth={2} 
                    d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" 
                  />
                </svg>
                Continue with phone
              </Button>

              {/* Continue with Google button */}
              <Button 
                onClick={handleGoogleSignIn}
                variant="outline"
                className="w-full font-medium"
                disabled={!isInitialized || isLoading}
              >
                <svg 
                  className="w-5 h-5 mr-2" 
                  viewBox="0 0 48 48"
                >
                  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                  <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
                  <path fill="none" d="M0 0h48v48H0z"/>
                </svg>
                Continue with Google
              </Button>
            </div>
          )}

          {/* Info section */}
          <div className="pt-4 border-t border-border">
            <div className="flex items-center justify-center gap-2">
              <div className="text-xs text-muted-foreground">
                Secured by 
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
  );
}

