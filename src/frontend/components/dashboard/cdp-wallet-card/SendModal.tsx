import { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useSendUserOperation, useEvmAddress, useCurrentUser } from '@coinbase/cdp-hooks';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { parseUnits, encodeFunctionData, isAddress } from 'viem';

interface TokenBalance {
  symbol: string;
  name: string;
  balance: string;
  balanceFormatted: string;
  usdValue: number;
  icon: string;
  contractAddress?: string;
  chain: 'base' | 'ethereum' | 'polygon';
  decimals?: number;
}

interface SendModalProps {
  tokens: TokenBalance[];
  onClose: () => void;
  onSuccess?: () => void;
}

// ERC20 Transfer ABI
const ERC20_TRANSFER_ABI = [
  {
    name: 'transfer',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' }
    ],
    outputs: [{ name: '', type: 'bool' }]
  }
] as const;

// Chain ID mapping
const CHAIN_IDS = {
  base: 8453,
  ethereum: 1,
  polygon: 137,
} as const;

export function SendModal({ tokens, onClose, onSuccess }: SendModalProps) {
  const { sendUserOperation } = useSendUserOperation();
  const { evmAddress } = useEvmAddress();
  const { currentUser } = useCurrentUser();
  const [selectedToken, setSelectedToken] = useState<TokenBalance | null>(tokens[0] || null);
  const [recipientAddress, setRecipientAddress] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [txHash, setTxHash] = useState('');

  // Validate recipient address
  const isValidAddress = useMemo(() => {
    if (!recipientAddress) return null;
    return isAddress(recipientAddress);
  }, [recipientAddress]);

  // Calculate USD value of amount
  const usdValue = useMemo(() => {
    if (!amount || !selectedToken) return 0;
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount)) return 0;
    const tokenPrice = selectedToken.usdValue / parseFloat(selectedToken.balanceFormatted);
    return numAmount * tokenPrice;
  }, [amount, selectedToken]);

  // Check if amount is valid
  const isValidAmount = useMemo(() => {
    if (!amount || !selectedToken) return null;
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) return false;
    return numAmount <= parseFloat(selectedToken.balanceFormatted);
  }, [amount, selectedToken]);

  const handleMaxClick = () => {
    if (selectedToken) {
      setAmount(selectedToken.balanceFormatted);
    }
  };

  const handleSend = async () => {
    if (!selectedToken || !evmAddress || !recipientAddress || !amount) {
      setError('Missing required information');
      return;
    }
    if (!isValidAddress || !isValidAmount) {
      setError('Invalid address or amount');
      return;
    }

    setIsLoading(true);
    setError('');
    setTxHash('');

    try {
      // Ensure we have a valid Smart Account
      if (!evmAddress || evmAddress.length !== 42 || !evmAddress.startsWith('0x')) {
        throw new Error('Invalid EVM address. Please ensure your wallet is fully initialized.');
      }

      if (!currentUser?.evmSmartAccounts?.[0]) {
        throw new Error('Smart Account not found. Please ensure you are signed in and your wallet is initialized.');
      }

      const smartAccount = currentUser.evmSmartAccounts[0];
      console.log('📤 Sending transaction from Smart Account:', smartAccount);

      const decimals = selectedToken.decimals || 18;
      const amountInWei = parseUnits(amount, decimals);
      const chainId = CHAIN_IDS[selectedToken.chain];
      
      let result;

      // Prepare the call data
      let callTo: `0x${string}`;
      let callValue: bigint;
      let callData: `0x${string}`;

      if (!selectedToken.contractAddress) {
        // Native token transfer
        console.log('💸 Sending native token from Smart Account:', {
          to: recipientAddress,
          value: amountInWei.toString(),
          chain: selectedToken.chain,
        });

        callTo = recipientAddress as `0x${string}`;
        callValue = amountInWei;
        callData = '0x';
      } else {
        // ERC20 token transfer
        console.log('🪙 Sending ERC20 token from Smart Account:', {
          contract: selectedToken.contractAddress,
          to: recipientAddress,
          amount: amountInWei.toString(),
          chain: selectedToken.chain,
        });

        callTo = selectedToken.contractAddress as `0x${string}`;
        callValue = 0n;
        callData = encodeFunctionData({
          abi: ERC20_TRANSFER_ABI,
          functionName: 'transfer',
          args: [recipientAddress as `0x${string}`, amountInWei],
        });
      }

      // Send as User Operation (for Smart Account)
      result = await sendUserOperation({
        evmSmartAccount: smartAccount,
        network: selectedToken.chain,
        calls: [{
          to: callTo,
          value: callValue,
          data: callData,
        }],
      });

      console.log('✅ User Operation result:', result);
      // User Operations return userOperationHash first, then transactionHash once confirmed
      if (result?.userOperationHash) {
        // For now, we'll use the userOperationHash as the txHash
        // The actual transaction hash will be available once the operation is confirmed
        setTxHash(result.userOperationHash);
        console.log('📝 User Operation Hash:', result.userOperationHash);
      } else {
        throw new Error('No user operation hash returned');
      }
    } catch (err: any) {
      console.error('❌ Send failed:', err);
      setError(err?.message || 'Transaction failed. Please try again.');
      setIsLoading(false);
    }
  };

  const getExplorerUrl = (hash: string, chain: string) => {
    // For User Operations, we can use JiffyScan or the regular block explorer
    // JiffyScan is specifically for User Operations/Account Abstraction
    const jiffyscanExplorers = {
      base: 'https://jiffyscan.xyz/userOpHash',
      ethereum: 'https://jiffyscan.xyz/userOpHash',
      polygon: 'https://jiffyscan.xyz/userOpHash',
    };
    
    // If it looks like a userOperationHash (0x...), use JiffyScan
    // Otherwise use regular block explorer
    if (hash.startsWith('0x') && hash.length === 66) {
      return `${jiffyscanExplorers[chain as keyof typeof jiffyscanExplorers]}/${hash}?network=${chain}`;
    }
    
    const explorers = {
      base: 'https://basescan.org',
      ethereum: 'https://etherscan.io',
      polygon: 'https://polygonscan.com',
    };
    return `${explorers[chain as keyof typeof explorers]}/tx/${hash}`;
  };

  // Success screen
  if (txHash && selectedToken) {
    return createPortal(
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={onClose}>
        <div className="bg-background rounded-lg max-w-md w-full max-h-[90vh] overflow-hidden p-1.5" onClick={(e) => e.stopPropagation()}>
          <div className="bg-pop rounded-lg p-4 sm:p-6 space-y-4 max-h-[calc(90vh-0.75rem)] overflow-y-auto">
          <h3 className="text-lg font-semibold">Transaction Sent!</h3>
          
          <div className="space-y-2">
            <div className="p-3 bg-green-500/10 border border-green-500/20 rounded">
              <p className="text-sm text-green-500">✅ Successfully sent {amount} {selectedToken.symbol}</p>
              <p className="text-xs text-green-500/70 mt-1">via Smart Account</p>
            </div>
            
            <div className="text-sm space-y-1">
              <p className="text-muted-foreground">User Operation Hash:</p>
              <a 
                href={getExplorerUrl(txHash, selectedToken.chain)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline break-all"
              >
                {txHash.slice(0, 10)}...{txHash.slice(-8)}
              </a>
              <p className="text-xs text-muted-foreground mt-2">
                Note: This is a gasless transaction powered by Account Abstraction
              </p>
            </div>
          </div>

          <Button 
            onClick={() => {
              onSuccess?.();
              onClose();
            }} 
            className="w-full"
          >
            Close
          </Button>
        </div>
        </div>
      </div>,
      document.body
    );
  }

  // Loading screen
  if (isLoading) {
    return createPortal(
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
        <div className="bg-background rounded-lg max-w-md w-full overflow-hidden p-1.5">
          <div className="bg-pop rounded-lg p-4 sm:p-6 space-y-4">
          <h3 className="text-lg font-semibold">Sending Transaction...</h3>
          
          <div className="space-y-3">
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
            </div>
            
            <p className="text-sm text-muted-foreground text-center">
              Please wait while your transaction is being processed...
            </p>
            
            {selectedToken && (
              <div className="p-3 bg-muted rounded text-sm">
                <p className="font-medium">Sending:</p>
                <p className="text-muted-foreground">{amount} {selectedToken.symbol} on {selectedToken.chain}</p>
                <p className="text-xs text-muted-foreground mt-1">To: {recipientAddress.slice(0, 10)}...{recipientAddress.slice(-8)}</p>
              </div>
            )}
          </div>
        </div>
        </div>
      </div>,
      document.body
    );
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-background rounded-lg max-w-md w-full max-h-[90vh] overflow-hidden p-1.5" onClick={(e) => e.stopPropagation()}>
        <div className="bg-pop rounded-lg p-4 sm:p-6 space-y-4 max-h-[calc(90vh-0.75rem)] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Send Tokens</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            ✕
          </button>
        </div>

        {/* Token Selection */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Select Token</label>
          <div className="max-h-48 overflow-y-auto border border-border rounded-lg">
            {tokens.map((token, index) => (
              <button
                key={`${token.chain}-${token.contractAddress || token.symbol}-${index}`}
                onClick={() => {
                  setSelectedToken(token);
                  setAmount('');
                }}
                className={`w-full p-3 flex items-center justify-between hover:bg-accent/50 transition-colors ${
                  selectedToken === token ? 'bg-accent' : ''
                }`}
              >
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center overflow-hidden">
                    {token.icon.startsWith('http') || token.icon.startsWith('/assets/') ? (
                      <img src={token.icon} alt={token.symbol} className="w-full h-full object-contain p-0.5" />
                    ) : (
                      <span className="text-sm font-bold text-muted-foreground uppercase">{token.icon.charAt(0)}</span>
                    )}
                  </div>
                  <div className="text-left">
                    <p className="text-sm font-medium">{token.symbol}</p>
                    <p className="text-xs text-muted-foreground">{token.chain.toUpperCase()}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-mono">{parseFloat(token.balanceFormatted).toFixed(6)}</p>
                  <p className="text-xs text-muted-foreground">${token.usdValue.toFixed(2)}</p>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Recipient Address */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Recipient Address</label>
          <Input
            type="text"
            placeholder="0x..."
            value={recipientAddress}
            onChange={(e) => setRecipientAddress(e.target.value)}
            className={`font-mono text-sm ${
              recipientAddress && !isValidAddress ? 'border-red-500' : ''
            }`}
          />
          {recipientAddress && !isValidAddress && (
            <p className="text-xs text-red-500">Invalid address</p>
          )}
        </div>

        {/* Amount */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Amount</label>
          <div className="relative">
            <Input
              type="text"
              placeholder="0.0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className={`font-mono pr-16 ${
                amount && !isValidAmount ? 'border-red-500' : ''
              }`}
            />
            <button
              onClick={handleMaxClick}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-xs px-2 py-1 bg-primary text-primary-foreground rounded hover:bg-primary/90"
            >
              MAX
            </button>
          </div>
          {selectedToken && (
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Balance: {parseFloat(selectedToken.balanceFormatted).toFixed(6)} {selectedToken.symbol}</span>
              {amount && isValidAmount && <span>≈ ${usdValue.toFixed(2)}</span>}
            </div>
          )}
          {amount && !isValidAmount && (
            <p className="text-xs text-red-500">Insufficient balance</p>
          )}
        </div>

        {/* Error Message */}
        {error && (
          <div className="p-3 bg-red-500/10 border border-red-500/20 rounded">
            <p className="text-sm text-red-500">{error}</p>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-2">
          <Button
            onClick={onClose}
            variant="outline"
            className="flex-1"
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSend}
            className="flex-1"
            disabled={
              !selectedToken ||
              !recipientAddress ||
              !amount ||
              !isValidAddress ||
              !isValidAmount ||
              isLoading
            }
          >
            {isLoading ? 'Sending...' : 'Send'}
          </Button>
        </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

