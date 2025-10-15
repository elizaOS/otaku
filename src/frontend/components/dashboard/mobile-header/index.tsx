import * as React from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Sheet, SheetContent, SheetTrigger, SheetClose, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import MonkeyIcon from "@/components/icons/monkey";
import { CDPWalletCard } from "@/components/dashboard/cdp-wallet-card";
import type { MockData } from "@/types/dashboard";
import { Wallet } from "lucide-react";

interface MobileHeaderProps {
  mockData: MockData;
}

export function MobileHeader({ mockData }: MobileHeaderProps) {

  return (
    <div className="lg:hidden h-header-mobile sticky top-0 z-40 bg-background/95 backdrop-blur-sm border-b border-border">
      <div className="flex items-center justify-between px-4 py-3">
        {/* Left: Sidebar Menu */}
        <SidebarTrigger />

        {/* Center: Monkey Logo + Time */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="h-8 w-16 bg-primary rounded flex items-center justify-center">
              <MonkeyIcon className="size-6 text-primary-foreground" />
            </div>
          </div>
        </div>

        <Sheet>
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
                <CDPWalletCard />
              </div>
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </div>
  );
}
