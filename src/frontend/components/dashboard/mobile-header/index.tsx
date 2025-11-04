import * as React from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Sheet, SheetContent, SheetTrigger, SheetClose, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { CDPWalletCard } from "@/components/dashboard/cdp-wallet-card";
import { useCDPWallet } from "@/hooks/useCDPWallet";
import { Wallet } from "lucide-react";

interface MobileHeaderProps {
  onHomeClick?: () => void;
}

export const MobileHeader = React.forwardRef<HTMLDivElement, MobileHeaderProps>(function MobileHeader({ onHomeClick }: MobileHeaderProps, ref) {
  const { currentUser } = useCDPWallet();
  const userId = currentUser?.userId || '';
  const [isSheetOpen, setIsSheetOpen] = React.useState(false);

  return (
    <div ref={ref} className="lg:hidden h-header-mobile sticky top-0 z-40 bg-background/95  border-b border-border">
      <div className="flex items-center justify-between px-4 py-3">
        {/* Left: Sidebar Menu */}
        <SidebarTrigger />

        {/* Center: Otaku Logo + Time */}
        <button 
          onClick={onHomeClick}
          className="flex items-center gap-3 hover:opacity-80 transition-opacity cursor-pointer"
        >
          <div className="flex items-center gap-2">
            <div className="h-8 w-16 bg-primary rounded flex items-center justify-center">
              <img src="/avatars/otaku-pfp.png" alt="Otaku" className="size-8 text-primary-foreground bg-transparent" />
            </div>
          </div>
        </button>

        <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
          {/* Right: Wallet Menu */}
          <SheetTrigger asChild>
            <Button variant="secondary" size="icon" className="relative">
              <Wallet className="size-4" />
            </Button>
          </SheetTrigger>

          {/* Wallet Sheet */}
          <SheetContent
            closeButton={false}
            side="right"
            className="w-[90%] max-w-md p-0"
          >
            <div className="h-full flex flex-col">
              {/* Accessibility Title */}
              <SheetHeader className="sr-only">
                <SheetTitle>Wallet</SheetTitle>
                <SheetDescription>View and manage your wallet</SheetDescription>
              </SheetHeader>

              {/* Header */}
              <div className="flex items-center justify-between p-4 border-b border-border">
                <h2 className="text-sm font-medium uppercase">Wallet</h2>
                <SheetClose>
                  <Badge
                    variant="secondary"
                    className="uppercase text-muted-foreground"
                  >
                    Close
                  </Badge>
                </SheetClose>
              </div>

              {/* Wallet Content */}
              <div className="flex-1 overflow-y-auto p-4 bg-muted">
                {userId && (
                  <CDPWalletCard 
                    userId={userId}
                    onActionClick={() => setIsSheetOpen(false)}
                  />
                )}
              </div>
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </div>
  );
});
