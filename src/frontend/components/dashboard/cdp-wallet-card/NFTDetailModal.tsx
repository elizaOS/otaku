import { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Copy, Check, Send, ExternalLink } from 'lucide-react';
import { Button } from '../../ui/button';
import { elizaClient } from '../../../lib/elizaClient';

// NFT interface
interface NFT {
  tokenId: string;
  name: string;
  description: string;
  image: string;
  contractAddress: string;
  contractName: string;
  tokenType: string; // ERC721, ERC1155
  chain: string;
  balance?: string;
  attributes?: Array<{
    trait_type: string;
    value: string | number;
  }>;
}

interface NFTDetailModalProps {
  nft: NFT;
  isOpen: boolean;
  onClose: () => void;
  userId: string;
  onSuccess?: () => void;
}

export function NFTDetailModal({ nft, isOpen, onClose, userId, onSuccess }: NFTDetailModalProps) {
  const [isCopied, setIsCopied] = useState(false);
  const [showSendForm, setShowSendForm] = useState(false);
  const [recipientAddress, setRecipientAddress] = useState('');
  const [amount, setAmount] = useState('1');
  const [isLoading, setIsLoading] = useState(false);
  const [txHash, setTxHash] = useState('');
  const [error, setError] = useState('');

  // Get chain name for display
  const getChainName = (chain: string) => {
    const names: Record<string, string> = {
      base: 'Base',
      ethereum: 'Ethereum',
      polygon: 'Polygon',
    };
    return names[chain] || chain;
  };

  // Get explorer URL for NFT
  const getExplorerUrl = (chain: string, address: string, tokenId: string) => {
    const explorers: Record<string, string> = {
      base: 'https://basescan.org',
      ethereum: 'https://etherscan.io',
      polygon: 'https://polygonscan.com',
    };
    return `${explorers[chain] || explorers.base}/nft/${address}/${tokenId}`;
  };

  // Get transaction explorer URL
  const getTxExplorerUrl = (hash: string, chain: string) => {
    const explorers: Record<string, string> = {
      base: 'https://basescan.org',
      ethereum: 'https://etherscan.io',
      polygon: 'https://polygonscan.com',
    };
    return `${explorers[chain] || explorers.base}/tx/${hash}`;
  };

  // Handle copy contract address
  const handleCopyAddress = async () => {
    try {
      await navigator.clipboard.writeText(nft.contractAddress);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy address:', err);
    }
  };

  // Handle send NFT
  const handleSend = async () => {
    if (!recipientAddress) {
      setError('Please enter a valid recipient address');
      return;
    }

    // Validate address format
    if (!recipientAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
      setError('Invalid recipient address');
      return;
    }

    try {
      setIsLoading(true);
      setError('');

      console.log('🎨 Sending NFT:', {
        contract: nft.contractAddress,
        tokenId: nft.tokenId,
        to: recipientAddress,
        type: nft.tokenType,
      });

      const result = await elizaClient.cdp.sendNFT({
        network: nft.chain,
        to: recipientAddress,
        contractAddress: nft.contractAddress,
        tokenId: nft.tokenId,
      });

      console.log('✅ NFT sent successfully:', result);
      setTxHash(result.transactionHash);
      
      // Call success callback after a short delay
      if (onSuccess) {
        setTimeout(() => {
          onSuccess();
        }, 2000);
      }
    } catch (err: any) {
      console.error('❌ NFT send failed:', err);
      setError(err.message || 'Failed to send NFT');
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  // Success screen
  if (txHash) {
    return createPortal(
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={onClose}>
        <div className="bg-background rounded-lg max-w-md w-full max-h-[90vh] overflow-hidden p-1.5" onClick={(e) => e.stopPropagation()}>
          <div className="bg-pop rounded-lg p-4 sm:p-6 space-y-4 max-h-[calc(90vh-0.75rem)] overflow-y-auto">
            <div className="text-center space-y-4">
              <div className="w-16 h-16 bg-green-500/10 rounded-full flex items-center justify-center mx-auto">
                <Check className="w-8 h-8 text-green-500" />
              </div>
              <div>
                <h3 className="text-lg font-semibold mb-2">NFT Sent Successfully!</h3>
                <p className="text-sm text-muted-foreground">
                  Your {nft.name || `${nft.contractName} #${nft.tokenId}`} has been sent
                </p>
              </div>
              
              <div className="bg-muted rounded-lg p-3 space-y-2">
                <div className="text-xs text-muted-foreground">Transaction Hash</div>
                <code className="text-xs font-mono break-all block">{txHash}</code>
              </div>

              <Button
                onClick={() => window.open(getTxExplorerUrl(txHash, nft.chain), '_blank')}
                variant="outline"
                className="w-full"
              >
                <ExternalLink className="w-4 h-4 mr-2" />
                View on Explorer
              </Button>

              <Button onClick={onClose} className="w-full">
                Close
              </Button>
            </div>
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
            <div className="text-center space-y-4">
              <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-primary mx-auto"></div>
              <div>
                <h3 className="text-lg font-semibold mb-2">Sending NFT...</h3>
                <p className="text-sm text-muted-foreground">
                  Please wait while your transaction is being processed
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>,
      document.body
    );
  }

  // Main modal
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-background rounded-lg max-w-2xl w-full mx-4 shadow-xl max-h-[90vh] overflow-hidden p-1.5" onClick={(e) => e.stopPropagation()}>
        <div className="bg-pop rounded-lg max-h-[calc(90vh-0.75rem)] overflow-y-auto">
          {/* Header */}
          <div className="sticky top-0 bg-background border-b border-border p-4 flex items-center justify-between z-10">
            <div className="flex items-center gap-3 min-w-0">
              <div className="min-w-0 flex-1">
                <h2 className="text-xl font-semibold truncate">
                  {nft.name || `${nft.contractName} #${nft.tokenId}`}
                </h2>
                <p className="text-sm text-muted-foreground truncate">{nft.contractName}</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
            >
              <X className="w-6 h-6" />
            </button>
          </div>

          {/* Content */}
          <div className="p-4 space-y-6">
            {/* NFT Image */}
            <div className="bg-accent rounded-lg p-3 flex items-center justify-center">
              <img
                src={nft.image}
                alt={nft.name || `Token #${nft.tokenId}`}
                className="max-w-full max-h-[250px] rounded-lg object-contain"
                onError={(e) => {
                  e.currentTarget.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="200" height="200"%3E%3Crect fill="%23ddd" width="200" height="200"/%3E%3Ctext fill="%23999" x="50%25" y="50%25" text-anchor="middle" dy=".3em"%3ENo Image%3C/text%3E%3C/svg%3E';
                }}
              />
            </div>

             {/* Send Section */}
             {!showSendForm ? (
              <Button
                onClick={() => setShowSendForm(true)}
                className="w-full"
                size="lg"
              >
                <Send className="w-4 h-4 mr-2" />
                Send NFT
              </Button>
            ) : (
              <div className="bg-muted rounded-lg p-4 space-y-4">
                <h3 className="text-sm font-semibold uppercase text-muted-foreground">Send NFT</h3>
                
                {error && (
                  <div className="text-xs text-red-500 bg-red-500/10 p-2 rounded border border-red-500/20">
                    {error}
                  </div>
                )}

                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">Recipient Address</label>
                  <input
                    type="text"
                    value={recipientAddress}
                    onChange={(e) => setRecipientAddress(e.target.value)}
                    placeholder="0x..."
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>

                {nft.tokenType === 'ERC1155' && (
                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground">Amount</label>
                    <input
                      type="number"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      min="1"
                      max={nft.balance || '1'}
                      className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                )}

                <div className="flex gap-2">
                  <Button
                    onClick={() => {
                      setShowSendForm(false);
                      setRecipientAddress('');
                      setAmount('1');
                      setError('');
                    }}
                    variant="outline"
                    className="flex-1"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleSend}
                    className="flex-1"
                  >
                    <Send className="w-4 h-4 mr-2" />
                    Send
                  </Button>
                </div>
              </div>
            )}

            {/* Description */}
            {nft.description && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold uppercase text-muted-foreground">Description</h3>
                <p className="text-sm">{nft.description}</p>
              </div>
            )}

            {/* Details Grid */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-muted rounded-lg p-3">
                <div className="text-xs text-muted-foreground mb-1">Token ID</div>
                <div className="text-sm font-medium font-mono">{nft.tokenId}</div>
              </div>
              <div className="bg-muted rounded-lg p-3">
                <div className="text-xs text-muted-foreground mb-1">Token Type</div>
                <div className="text-sm font-medium">{nft.tokenType}</div>
              </div>
              <div className="bg-muted rounded-lg p-3">
                <div className="text-xs text-muted-foreground mb-1">Network</div>
                <div className="text-sm font-medium">{getChainName(nft.chain)}</div>
              </div>
              {nft.balance && nft.tokenType === 'ERC1155' && (
                <div className="bg-muted rounded-lg p-3">
                  <div className="text-xs text-muted-foreground mb-1">Balance</div>
                  <div className="text-sm font-medium">{nft.balance}</div>
                </div>
              )}
            </div>

            {/* Contract Address */}
            <div className="bg-muted rounded-lg p-3 space-y-2">
              <div className="text-xs text-muted-foreground uppercase font-medium">Contract Address</div>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs bg-background p-2 rounded border border-border overflow-x-auto scrollbar-thin font-mono">
                  {nft.contractAddress}
                </code>
                <Button
                  onClick={handleCopyAddress}
                  variant="ghost"
                  size="sm"
                  className="shrink-0"
                  title="Copy address"
                >
                  {isCopied ? (
                    <Check className="w-4 h-4 text-green-500" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </Button>
                <Button
                  onClick={() => window.open(getExplorerUrl(nft.chain, nft.contractAddress, nft.tokenId), '_blank')}
                  variant="ghost"
                  size="sm"
                  className="shrink-0"
                  title="View on explorer"
                >
                  <ExternalLink className="w-4 h-4" />
                </Button>
              </div>
            </div>

            {/* Attributes */}
            {nft.attributes && nft.attributes.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-sm font-semibold uppercase text-muted-foreground">Attributes</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {nft.attributes.map((attr, index) => (
                    <div key={index} className="bg-muted rounded-lg p-2 text-center">
                      <div className="text-xs text-muted-foreground uppercase mb-1">{attr.trait_type}</div>
                      <div className="text-sm font-medium truncate">{attr.value}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
