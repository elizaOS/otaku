import { useEffect, ReactNode } from 'react';
import { useIsMobile } from '@/frontend/hooks/use-mobile';

interface ModalProps {
  children: ReactNode;
  onClose: () => void;
  closeOnBackdropClick?: boolean;
  closeOnEsc?: boolean;
  showCloseButton?: boolean;
  className?: string;
}

export function Modal({ 
  children, 
  onClose, 
  closeOnBackdropClick = true,
  closeOnEsc = true,
  showCloseButton = true,
  className = ''
}: ModalProps) {
  const isMobile = useIsMobile();

  // Handle ESC key
  useEffect(() => {
    if (!closeOnEsc) return;

    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [closeOnEsc, onClose]);

  // Prevent body scroll when modal is open
  useEffect(() => {
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, []);

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (!isMobile && closeOnBackdropClick && e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div 
      className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/80  p-4" 
      onClick={handleBackdropClick}
      style={{ pointerEvents: 'auto' }}
    >
      <div className={`bg-background rounded-lg w-full max-h-[90vh] p-1.5 relative ${className}`} style={{ overflow: 'visible' }}>
        {/* Close button - positioned above content with better visibility */}
        {showCloseButton && (
          <button 
            onClick={onClose}
            className="absolute top-6 right-6 z-[100] text-muted-foreground hover:text-foreground transition-colors text-xl leading-none"
            aria-label="Close modal"
          >
            
          </button>
        )}
        
        {/* Modal content - with proper overflow handling, allow dropdowns to extend beyond */}
        <div className="bg-pop rounded-lg p-4 sm:p-6" style={{ overflow: 'visible' }}>
          {children}
        </div>
      </div>
    </div>
  );
}

