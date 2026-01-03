import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { Modal } from '@/frontend/components/ui/modal';

interface ModalState {
  isVisible: boolean;
  content: ReactNode | null;
  id: string | null;
  options?: ModalOptions;
}

interface ModalOptions {
  closeOnBackdropClick?: boolean;
  closeOnEsc?: boolean;
  showCloseButton?: boolean;
  className?: string;
}

interface ModalContextType {
  showModal: (content: ReactNode, id?: string, options?: ModalOptions) => void;
  hideModal: (id?: string) => void;
  isVisible: boolean;
}

const ModalContext = createContext<ModalContextType | undefined>(undefined);

export function ModalProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ModalState>({
    isVisible: false,
    content: null,
    id: null,
    options: undefined,
  });

  const showModal = useCallback((content: ReactNode, id?: string, options?: ModalOptions) => {
    setState({
      isVisible: true,
      content,
      id: id || null,
      options,
    });
  }, []);

  const hideModal = useCallback((id?: string) => {
    setState(prev => {
      // If an ID is provided, only hide if it matches the current ID
      // This prevents race conditions where one component hides another's modal
      if (id && prev.id !== id) {
        return prev;
      }
      return { ...prev, isVisible: false, content: null };
    });
  }, []);

  const handleClose = useCallback(() => {
    setState(prev => ({ ...prev, isVisible: false, content: null }));
  }, []);

  return (
    <ModalContext.Provider value={{ showModal, hideModal, isVisible: state.isVisible }}>
      {children}
      
      {/* Single Modal instance */}
      {state.isVisible && state.content && (
        <Modal
          onClose={handleClose}
          closeOnBackdropClick={state.options?.closeOnBackdropClick}
          closeOnEsc={state.options?.closeOnEsc}
          showCloseButton={state.options?.showCloseButton}
          className={state.options?.className}
        >
          {state.content}
        </Modal>
      )}
    </ModalContext.Provider>
  );
}

// Custom hook to use the modal
export function useModal() {
  const context = useContext(ModalContext);
  if (context === undefined) {
    throw new Error('useModal must be used within a ModalProvider');
  }
  return context;
}

