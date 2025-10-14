import type * as React from "react"

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
import GearIcon from "@/components/icons/gear"
import MonkeyIcon from "@/components/icons/monkey"
import DotsVerticalIcon from "@/components/icons/dots-vertical"
import { Bullet } from "@/components/ui/bullet"
import PlusIcon from "@/components/icons/plus"
import { LogOut } from "lucide-react"

const data = {
  user: {
    name: "KRIMSON",
    email: "krimson@joyco.studio",
    avatar: "/avatars/user_krimson.png",
  },
}

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
  agentName?: string
  agentAvatar?: string
  userEmail?: string
  onSignOut?: () => void
}

export function DashboardSidebar({ 
  className,
  channels = [],
  activeChannelId = null,
  onChannelSelect = () => {},
  onNewChat = () => {},
  isCreatingChannel = false,
  agentName = "Loading...",
  agentAvatar,
  userEmail,
  onSignOut,
  ...props 
}: DashboardSidebarProps) {
  return (
    <Sidebar {...props} className={cn("py-sides", className)}>
      <SidebarHeader className="rounded-t-lg flex gap-3 flex-row rounded-b-none">
        <div className="flex gap-3 flex-row flex-1 group">
          <div className="flex overflow-clip size-12 shrink-0 items-center justify-center rounded bg-sidebar-primary-foreground/10 transition-colors group-hover:bg-sidebar-primary text-sidebar-primary-foreground">
            <MonkeyIcon className="size-10 group-hover:scale-[1.7] origin-top-left transition-transform" />
          </div>
          <div className="grid flex-1 text-left text-sm leading-tight">
            <span className="text-2xl font-display">M.O.N.K.Y.</span>
            <span className="text-xs uppercase">The OS for Rebels</span>
          </div>
        </div>
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
            {/* Agent Info */}
            <div className="px-2 py-3 mb-2 border-b border-sidebar-border">
              <div className="flex items-center gap-2">
                {agentAvatar ? (
                  <div className="w-8 h-8 rounded-full overflow-hidden flex-shrink-0 bg-sidebar-primary-foreground/10">
                    <img 
                      src={agentAvatar} 
                      alt={agentName}
                      className="w-full h-full object-cover"
                    />
                  </div>
                ) : (
                  <div className="w-8 h-8 rounded-full flex items-center justify-center bg-sidebar-primary-foreground/10 flex-shrink-0">
                    <span className="text-xs font-bold text-sidebar-primary-foreground">
                      {agentName.charAt(0).toUpperCase()}
                    </span>
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{agentName}</p>
                  <p className="text-xs text-muted-foreground uppercase tracking-wider">AI Agent</p>
                </div>
              </div>
            </div>

            <div className="max-h-[calc(100vh-28rem)] overflow-y-auto">
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
                  channels.map((channel) => {
                    const isActive = activeChannelId === channel.id
                    
                    return (
                      <SidebarMenuItem key={channel.id}>
                        <SidebarMenuButton
                          onClick={() => onChannelSelect(channel.id)}
                          isActive={isActive}
                          className="w-full"
                        >
                          <div className="flex flex-col items-start gap-1 w-full min-w-0">
                            <span className="font-medium text-sm truncate w-full">
                              {channel.name}
                            </span>
                            {(() => {
                              const timestamp = channel.lastMessageAt || channel.createdAt;
                              if (timestamp && timestamp > 0) {
                                return (
                                  <span className="text-xs text-muted-foreground uppercase">
                                    {new Date(timestamp).toLocaleDateString('en-US', { 
                                      month: 'short', 
                                      day: 'numeric',
                                    })}, {new Date(timestamp).toLocaleTimeString('en-US', {
                                      hour: '2-digit',
                                      minute: '2-digit',
                                      hour12: false
                                    })}
                                  </span>
                                );
                              }
                              return null;
                            })()}
                          </div>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    )
                  })
                )}
              </SidebarMenu>
            </div>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-0">
        <SidebarGroup>
          <SidebarGroupLabel>
            <Bullet className="mr-2" />
            User
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <Popover>
                  <PopoverTrigger className="flex gap-0.5 w-full group cursor-pointer">
                    <div className="shrink-0 flex size-14 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground overflow-clip">
                      <img
                        src={data.user.avatar}
                        alt={data.user.name}
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div className="group/item pl-3 pr-1.5 pt-2 pb-1.5 flex-1 flex bg-sidebar-accent hover:bg-sidebar-accent-active/75 items-center rounded group-data-[state=open]:bg-sidebar-accent-active group-data-[state=open]:hover:bg-sidebar-accent-active group-data-[state=open]:text-sidebar-accent-foreground">
                      <div className="grid flex-1 text-left text-sm leading-tight">
                        <span className="truncate text-xl font-display">{data.user.name}</span>
                        <span className="truncate text-xs uppercase opacity-50 group-hover/item:opacity-100">
                          {userEmail || data.user.email}
                        </span>
                      </div>
                      <DotsVerticalIcon className="ml-auto size-4" />
                    </div>
                  </PopoverTrigger>
                  <PopoverContent className="w-56 p-0" side="bottom" align="end" sideOffset={4}>
                    <div className="flex flex-col">
                      <a href="#account" className="flex items-center px-4 py-2 text-sm hover:bg-accent">
                        <MonkeyIcon className="mr-2 h-4 w-4" />
                        Account
                      </a>
                      <a href="#settings" className="flex items-center px-4 py-2 text-sm hover:bg-accent">
                        <GearIcon className="mr-2 h-4 w-4" />
                        Settings
                      </a>
                      {onSignOut && (
                        <button 
                          onClick={onSignOut}
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
