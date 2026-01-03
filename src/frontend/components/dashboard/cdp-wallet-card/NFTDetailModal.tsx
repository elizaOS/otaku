import { useState } from 'react';
import { X, Copy, Check, Send, ExternalLink } from 'lucide-react';
import { Button } from '@/frontend/components/ui/button';
import { useModal } from '@/frontend/contexts/ModalContext';
import { useLoadingPanel } from '@/frontend/contexts/LoadingPanelContext';
import { elizaClient } from '@/frontend/lib/elizaClient';

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

interface NFTDetailModalContentProps {
  nft: NFT;
  userId: string;
  onSuccess?: () => void;
}

export function NFTDetailModalContent({ nft, userId, onSuccess }: NFTDetailModalContentProps) {
  const { hideModal, showModal } = useModal();
  const { showLoading, showSuccess, showError } = useLoadingPanel();
  const modalId = 'nft-detail-modal';
  const [isCopied, setIsCopied] = useState(false);
  const [showSendForm, setShowSendForm] = useState(false);
  const [recipientAddress, setRecipientAddress] = useState('');
  const [amount, setAmount] = useState('1');
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
      setError('');

      console.log(' Sending NFT:', {
        contract: nft.contractAddress,
        tokenId: nft.tokenId,
        to: recipientAddress,
        type: nft.tokenType,
      });

      // Show loading state
      showLoading(
        'Sending NFT...',
        'Please wait while your transaction is being processed',
        modalId
      );

      const result = await elizaClient.cdp.sendNFT({
        network: nft.chain,
        to: recipientAddress,
        contractAddress: nft.contractAddress,
        tokenId: nft.tokenId,
      });

      console.log(' NFT sent successfully:', result);
      
      // Show success state
      showSuccess(
        'NFT Sent Successfully!',
        `Your ${nft.name || `${nft.contractName} #${nft.tokenId}`} has been sent`,
        modalId,
        false // Don't auto-close
      );
      
      // Reset form
      setShowSendForm(false);
      setRecipientAddress('');
      setAmount('1');
      
      // Call success callback after a short delay
      if (onSuccess) {
        setTimeout(() => {
          onSuccess();
        }, 2000);
      }
    } catch (err: any) {
      console.error(' NFT send failed:', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to send NFT';
      showError('Transaction Failed', errorMessage, modalId);
    }
  };

  return (
    <div className="bg-pop rounded-lg max-h-[calc(90vh-0.75rem)] overflow-y-auto -m-4 sm:-m-6 -mt-4 sm:-mt-6">
      {/* Header */}
      <div className="sticky top-0 bg-background border-b border-border p-4 flex items-center justify-between z-10">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-semibold truncate">
              {nft.name || `${nft.contractName} #${nft.tokenId}`}
            </h2>
            <p className="text-sm text-muted-foreground truncate">{nft.contractName}</p>
          </div>
        </div>
        <button
          onClick={() => hideModal(modalId)}
          className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
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
  );
}
