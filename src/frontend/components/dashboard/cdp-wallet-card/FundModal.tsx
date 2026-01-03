import { useState } from 'react';
import { Button } from '@/frontend/components/ui/button';
import { Copy, Check } from 'lucide-react';
import { useModal } from '@/frontend/contexts/ModalContext';
import { SUPPORTED_CHAINS, CHAIN_UI_CONFIGS, getChainWalletIcon } from '@/frontend/constants/chains';

interface FundModalContentProps {
  walletAddress?: string;
  shortAddress: string;
}

export function FundModalContent({ walletAddress, shortAddress }: FundModalContentProps) {
  const { hideModal } = useModal();
  const modalId = 'fund-modal';
  const [copiedChain, setCopiedChain] = useState<string | null>(null);

  const handleCopyChainAddress = async (chain: string) => {
    if (!walletAddress) return;
    
    try {
      await navigator.clipboard.writeText(walletAddress);
      setCopiedChain(chain);
      setTimeout(() => setCopiedChain(null), 2000);
    } catch (err) {
      console.error('Failed to copy address:', err);
    }
  };

  return (
    <div className="space-y-4 w-full max-w-md mx-auto">
      <h3 className="text-lg font-semibold">Fund Your Wallet</h3>
      <p className="text-sm text-muted-foreground">
        Transfer assets to your wallet on any supported network
      </p>
      
      {/* Network Address List - Each chain in its own card */}
      <div className="flex flex-col gap-2 max-h-[400px] overflow-y-auto scrollbar-thin scrollbar-thumb-muted scrollbar-track-transparent">
        {SUPPORTED_CHAINS.map((chain) => {
          const config = CHAIN_UI_CONFIGS[chain];
          const chainWalletIcon = getChainWalletIcon(chain);
          return (
            <div
              key={chain}
              className="flex items-center justify-between gap-3 p-3 rounded-lg bg-accent hover:bg-accent/80 transition-colors border border-border/30"
            >
              {/* First Group: Icon & Name */}
              <div className="flex items-center gap-2.5 shrink-0">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center overflow-hidden bg-white">
                  {chainWalletIcon ? (
                    <img 
                      src={chainWalletIcon} 
                      alt={config.name}
                      className="w-full h-full object-contain"
                    />
                  ) : (
                    <span className="text-xs font-bold text-muted-foreground uppercase">
                      {chain.charAt(0)}
                    </span>
                  )}
                </div>
                <span className="text-sm font-medium">{config.displayName}</span>
              </div>
              
              {/* Second Group: Address & Copy Button */}
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[10px] text-muted-foreground font-mono">
                  {walletAddress ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}` : ''}
                </span>
                <Button
                  onClick={() => handleCopyChainAddress(chain)}
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0 shrink-0 text-muted-foreground hover:text-foreground"
                  title="Copy address"
                >
                  {copiedChain === chain ? (
                    <Check className="w-4 h-4 text-green-500" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Close button */}
      <Button
        onClick={() => hideModal(modalId)}
        variant="default"
        className="w-full"
      >
        Close
      </Button>
    </div>
  );
}

