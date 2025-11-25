import type * as React from "react"
import { useState } from "react"

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import DotsVerticalIcon from "@/components/icons/dots-vertical"
import { Bullet } from "@/components/ui/bullet"
import PlusIcon from "@/components/icons/plus"
import { LogOut, Trophy, User } from "lucide-react"

interface Channel {
  id: string
  name: string
  createdAt?: number
  lastMessageAt?: number
}

interface DashboardSidebarProps extends React.ComponentProps<typeof Sidebar> {
  channels?: Channel[]
  activeChannelId?: string | null
  onChannelSelect?: (channelId: string) => void
  onNewChat?: () => void
  isCreatingChannel?: boolean
  userProfile?: {
    avatarUrl: string
    displayName: string
    bio: string
    email: string
    walletAddress: string
    memberSince: string
  } | null
  onSignOut?: () => void
  onAccountClick?: () => void
  onChatClick?: () => void
  onLeaderboardClick?: () => void
  onHomeClick?: () => void
}

export function DashboardSidebar({ 
  className,
  channels = [],
  activeChannelId = null,
  onChannelSelect = () => {},
  onNewChat = () => {},
  isCreatingChannel = false,
  userProfile,
  onSignOut,
  onAccountClick,
  onChatClick,
  onLeaderboardClick,
  onHomeClick,
  ...props
}: DashboardSidebarProps) {
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);

  // Group channels by date
  const groupChannelsByDate = (channels: Channel[]) => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const lastWeek = new Date(today);
    lastWeek.setDate(lastWeek.getDate() - 7);
    const lastMonth = new Date(today);
    lastMonth.setDate(lastMonth.getDate() - 30);

    const groups: {
      today: Channel[];
      yesterday: Channel[];
      lastWeek: Channel[];
      lastMonth: Channel[];
      older: Map<string, Channel[]>; // Map of date string to channels
    } = {
      today: [],
      yesterday: [],
      lastWeek: [],
      lastMonth: [],
      older: new Map(),
    };

    channels.forEach(channel => {
      const timestamp = channel.lastMessageAt || channel.createdAt;
      if (!timestamp || timestamp <= 0) {
        const dateKey = 'Unknown Date';
        if (!groups.older.has(dateKey)) {
          groups.older.set(dateKey, []);
        }
        groups.older.get(dateKey)!.push(channel);
        return;
      }

      const channelDate = new Date(timestamp);
      
      if (channelDate >= today) {
        groups.today.push(channel);
      } else if (channelDate >= yesterday) {
        groups.yesterday.push(channel);
      } else if (channelDate >= lastWeek) {
        groups.lastWeek.push(channel);
      } else if (channelDate >= lastMonth) {
        groups.lastMonth.push(channel);
      } else {
        // Format date as "MMM DD, YYYY" for items older than 30 days
        const dateKey = channelDate.toLocaleDateString('en-US', { 
          month: 'short', 
          day: '2-digit', 
          year: 'numeric' 
        });
        if (!groups.older.has(dateKey)) {
          groups.older.set(dateKey, []);
        }
        groups.older.get(dateKey)!.push(channel);
      }
    });

    // Sort older dates in descending order (most recent first)
    const sortedOlderEntries = Array.from(groups.older.entries()).sort((a, b) => {
      // Get the first channel's timestamp from each group
      const aTime = a[1][0]?.lastMessageAt || a[1][0]?.createdAt || 0;
      const bTime = b[1][0]?.lastMessageAt || b[1][0]?.createdAt || 0;
      return bTime - aTime;
    });
    
    groups.older = new Map(sortedOlderEntries);

    return groups;
  };

  const groupedChannels = groupChannelsByDate(channels);

  return (
    <Sidebar {...props} className={cn("py-sides", className)}>
      <SidebarHeader className="rounded-t-lg flex gap-3 flex-row rounded-b-none">
        <button 
          onClick={onHomeClick}
          className="flex gap-3 flex-row flex-1 group cursor-pointer hover:opacity-80 transition-opacity"
        >
          <div className="flex overflow-clip size-12 shrink-0 items-center justify-center rounded bg-sidebar-primary-foreground/10 transition-colors group-hover:bg-sidebar-primary text-sidebar-primary-foreground">
            <img src="/avatars/otaku-pfp.png" alt="Otaku" className="size-11.5 group-hover:scale-[1.7] origin-top-left transition-transform bg-transparent" />
          </div>
          <div className="grid flex-1 text-left text-sm leading-tight">
            <span className="text-2xl font-display">OTAKU</span>
            <span className="text-xs uppercase">DEFI TRADING AGENT</span>
          </div>
        </button>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup className="rounded-t-none">
          <SidebarGroupLabel className="flex items-center justify-between">
            <div className="flex items-center">
              <Bullet className="mr-2" />
              <span>Chat History</span>
            </div>
            <Button
              onClick={onNewChat}
              disabled={isCreatingChannel}
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 hover:bg-sidebar-accent"
            >
              {isCreatingChannel ? (
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              ) : (
                <PlusIcon className="size-4" />
              )}
            </Button>
          </SidebarGroupLabel>
          
          <SidebarGroupContent>
            <div className="max-h-[calc(100vh-24rem)] overflow-y-auto">
              <SidebarMenu>
                {channels.length === 0 ? (
                  <div className="px-2 py-8 text-center">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider">
                      No conversations yet
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Click + to start a new chat
                    </p>
                  </div>
                ) : (
                  <>
                    {/* Today */}
                    {groupedChannels.today.length > 0 && (
                      <>
                        <div className="sticky top-0 z-10 bg-background text-[10px] font-mono text-muted-foreground mb-1.5 uppercase tracking-wider border-b border-border/50 pb-1 px-2">
                          Today
                        </div>
                        {groupedChannels.today.map((channel) => (
                          <SidebarMenuItem key={channel.id}>
                            <SidebarMenuButton
                              onClick={() => onChannelSelect(channel.id)}
                              isActive={activeChannelId === channel.id}
                              className="w-full"
                            >
                              <span className="font-medium text-sm truncate w-full">
                                {channel.name}
                              </span>
                            </SidebarMenuButton>
                          </SidebarMenuItem>
                        ))}
                      </>
                    )}

                    {/* Yesterday */}
                    {groupedChannels.yesterday.length > 0 && (
                      <>
                        <div className="sticky top-0 z-10 bg-background text-[10px] font-mono text-muted-foreground mb-1.5 uppercase tracking-wider border-b border-border/50 pb-1 px-2 mt-2">
                          Yesterday
                        </div>
                        {groupedChannels.yesterday.map((channel) => (
                          <SidebarMenuItem key={channel.id}>
                            <SidebarMenuButton
                              onClick={() => onChannelSelect(channel.id)}
                              isActive={activeChannelId === channel.id}
                              className="w-full"
                            >
                              <span className="font-medium text-sm truncate w-full">
                                {channel.name}
                              </span>
                            </SidebarMenuButton>
                          </SidebarMenuItem>
                        ))}
                      </>
                    )}

                    {/* Last 7 Days */}
                    {groupedChannels.lastWeek.length > 0 && (
                      <>
                        <div className="sticky top-0 z-10 bg-background text-[10px] font-mono text-muted-foreground mb-1.5 uppercase tracking-wider border-b border-border/50 pb-1 px-2 mt-2">
                          Last 7 Days
                        </div>
                        {groupedChannels.lastWeek.map((channel) => (
                          <SidebarMenuItem key={channel.id}>
                            <SidebarMenuButton
                              onClick={() => onChannelSelect(channel.id)}
                              isActive={activeChannelId === channel.id}
                              className="w-full"
                            >
                              <span className="font-medium text-sm truncate w-full">
                                {channel.name}
                              </span>
                            </SidebarMenuButton>
                          </SidebarMenuItem>
                        ))}
                      </>
                    )}

                    {/* Last 30 Days */}
                    {groupedChannels.lastMonth.length > 0 && (
                      <>
                        <div className="sticky top-0 z-10 bg-background text-[10px] font-mono text-muted-foreground mb-1.5 uppercase tracking-wider border-b border-border/50 pb-1 px-2 mt-2">
                          Last 30 Days
                        </div>
                        {groupedChannels.lastMonth.map((channel) => (
                          <SidebarMenuItem key={channel.id}>
                            <SidebarMenuButton
                              onClick={() => onChannelSelect(channel.id)}
                              isActive={activeChannelId === channel.id}
                              className="w-full"
                            >
                              <span className="font-medium text-sm truncate w-full">
                                {channel.name}
                              </span>
                            </SidebarMenuButton>
                          </SidebarMenuItem>
                        ))}
                      </>
                    )}

                    {/* Older - Group by exact date */}
                    {groupedChannels.older.size > 0 && (
                      <>
                        {Array.from(groupedChannels.older.entries()).map(([date, channels]) => (
                          <div key={date}>
                            <div className="sticky top-0 z-10 bg-background text-[10px] font-mono text-muted-foreground mb-1.5 uppercase tracking-wider border-b border-border/50 pb-1 px-2 mt-2">
                              {date}
                            </div>
                            {channels.map((channel) => (
                              <SidebarMenuItem key={channel.id}>
                                <SidebarMenuButton
                                  onClick={() => onChannelSelect(channel.id)}
                                  isActive={activeChannelId === channel.id}
                                  className="w-full"
                                >
                                  <span className="font-medium text-sm truncate w-full">
                                    {channel.name}
                                  </span>
                                </SidebarMenuButton>
                              </SidebarMenuItem>
                            ))}
                          </div>
                        ))}
                      </>
                    )}
                  </>
                )}
              </SidebarMenu>
            </div>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-0">
        {onLeaderboardClick && (
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    onClick={onLeaderboardClick}
                    className="w-full"
                  >
                    <Trophy className="mr-2 h-4 w-4" />
                    <span className="font-medium text-sm">Leaderboard</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
        <SidebarGroup>
          <SidebarGroupLabel>
            <Bullet className="mr-2" />
            User
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
                  <PopoverTrigger className="flex gap-0.5 w-full group cursor-pointer">
                    <div className="shrink-0 flex size-14 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground overflow-clip">
                      <img
                        src={userProfile?.avatarUrl || '/avatars/user_krimson.png'}
                        alt={userProfile?.displayName || 'User'}
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div className="group/item pl-3 pr-1.5 pt-2 pb-1.5 flex-1 flex bg-sidebar-accent hover:bg-sidebar-accent-active/75 items-center rounded group-data-[state=open]:bg-sidebar-accent-active group-data-[state=open]:hover:bg-sidebar-accent-active group-data-[state=open]:text-sidebar-accent-foreground">
                      <div className="grid flex-1 text-left text-sm leading-tight">
                        <span className="truncate text-xl font-display">{userProfile?.displayName || 'KRIMSON'}</span>
                        <span className="truncate text-xs uppercase opacity-50 group-hover/item:opacity-100">
                          {userProfile?.email || ''}
                        </span>
                      </div>
                      <DotsVerticalIcon className="ml-auto size-4" />
                    </div>
                  </PopoverTrigger>
                  <PopoverContent className="w-56 p-0" side="bottom" align="end" sideOffset={4}>
                    <div className="flex flex-col">
                      {onAccountClick && (
                        <button 
                          onClick={() => {
                            onAccountClick();
                            setIsPopoverOpen(false);
                          }}
                          className="flex items-center px-4 py-2 text-sm hover:bg-accent text-left w-full"
                        >
                          <User className="mr-2 h-4 w-4" />
                          Account
                        </button>
                      )}
                      {onLeaderboardClick && (
                        <button 
                          onClick={() => {
                            onLeaderboardClick();
                            setIsPopoverOpen(false);
                          }}
                          className="flex items-center px-4 py-2 text-sm hover:bg-accent text-left w-full"
                        >
                          <Trophy className="mr-2 h-4 w-4" />
                          Leaderboard
                        </button>
                      )}
                      {onSignOut && (
                        <button 
                          onClick={() => {
                            onSignOut();
                            setIsPopoverOpen(false);
                          }}
                          className="flex items-center px-4 py-2 text-sm hover:bg-accent text-left w-full"
                        >
                          <LogOut className="mr-2 h-4 w-4" />
                          Sign Out
                        </button>
                      )}
                    </div>
                  </PopoverContent>
                </Popover>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  )
}
