import { useEffect, useState, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CDPReactProvider } from "@coinbase/cdp-react";
import { useCDPWallet } from './hooks/useCDPWallet';
import { elizaClient } from './lib/elizaClient';
import { socketManager } from './lib/socketManager';
import { ChatInterface } from './components/chat/chat-interface';
import SmallChat from './components/chat';
import { SidebarProvider } from './components/ui/sidebar';
import { DashboardSidebar } from './components/dashboard/sidebar';
import Widget from './components/dashboard/widget';
import Notifications from './components/dashboard/notifications';
import { CDPWalletCard } from './components/dashboard/cdp-wallet-card';
import { MobileChat } from './components/chat/mobile-chat';
import { MobileHeader } from './components/dashboard/mobile-header';
import { MessageSquare } from 'lucide-react';
import mockDataJson from './mock.json';
import type { MockData } from './types/dashboard';

const mockData = mockDataJson as MockData;

/**
 * Generate a deterministic UUID from a wallet address
 * This ensures the same wallet always gets the same UUID
 */
async function generateDeterministicUUID(walletAddress: string): Promise<string> {
  // Hash the wallet address to get deterministic bytes
  const encoder = new TextEncoder();
  const data = encoder.encode(walletAddress.toLowerCase());
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = new Uint8Array(hashBuffer);
  
  // Take first 16 bytes for UUID (128 bits)
  const uuidBytes = hashArray.slice(0, 16);
  
  // Set version (4) and variant bits for UUID v4 format
  uuidBytes[6] = (uuidBytes[6] & 0x0f) | 0x40; // Version 4
  uuidBytes[8] = (uuidBytes[8] & 0x3f) | 0x80; // Variant 10
  
  // Convert to UUID string format
  const hex = Array.from(uuidBytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Get or generate user ID
 * - If CDP wallet is connected: Use deterministic UUID based on wallet address
 * - If not connected: Use random UUID stored in localStorage
 */
async function getUserId(walletAddress?: string): Promise<string> {
  // If wallet address is provided, generate deterministic UUID
  if (walletAddress) {
    const storageKey = `eliza-wallet-user-id-${walletAddress.toLowerCase()}`;
    const existingId = localStorage.getItem(storageKey);
    
    if (existingId) {
      return existingId;
    }
    
    // Generate new deterministic UUID from wallet address
    const userId = await generateDeterministicUUID(walletAddress);
    localStorage.setItem(storageKey, userId);
    console.log(`Generated deterministic user ID for wallet ${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}: ${userId}`);
    return userId;
  }
  
  // Fallback to random UUID for non-wallet users
  const storageKey = 'eliza-user-id';
  const existingId = localStorage.getItem(storageKey);
  
  if (existingId) {
    return existingId;
  }
  
  const userId = crypto.randomUUID();
  localStorage.setItem(storageKey, userId);
  console.log(`Generated random user ID: ${userId}`);
  return userId;
}

interface Channel {
  id: string;
  name: string;
  createdAt?: number;
  lastMessageAt?: number;
}

function App() {
  // Get CDP wallet info (will be undefined if not configured or not signed in)
  const { isInitialized, evmAddress } = useCDPWallet();
  
  const [userId, setUserId] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [isLoadingChannels, setIsLoadingChannels] = useState(true);
  const [isCreatingChannel, setIsCreatingChannel] = useState(false);
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const hasInitialized = useRef(false);

  // Initialize or update user ID when wallet address changes
  // Wait for CDP to initialize before generating user ID
  useEffect(() => {
    // If CDP is not configured, initialize immediately
    if (!import.meta.env.VITE_CDP_PROJECT_ID || import.meta.env.VITE_CDP_PROJECT_ID === 'your-project-id') {
      async function initUserId() {
        const id = await getUserId(undefined);
        setUserId(id);
      }
      initUserId();
      return;
    }

    // If CDP is configured, wait for it to initialize
    if (!isInitialized) {
      console.log('⏳ Waiting for CDP wallet to initialize...');
      return;
    }

    async function initUserId() {
      const id = await getUserId(evmAddress || undefined);
      setUserId(id);
    }
    initUserId();
  }, [isInitialized, evmAddress]); // Re-run when CDP initializes or wallet address changes

  // Fetch the agent list first to get the ID
  const { data: agentsData } = useQuery({
    queryKey: ['agents'],
    queryFn: async () => {
      const result = await elizaClient.agents.listAgents();
      return result.agents;
    },
    refetchInterval: 10000,
  });

  const agentId = agentsData?.[0]?.id;

  // Fetch full agent details (including settings with avatar)
  const { data: agent, isLoading } = useQuery({
    queryKey: ['agent', agentId],
    queryFn: async () => {
      if (!agentId) return null;
      return await elizaClient.agents.getAgent(agentId);
    },
    enabled: !!agentId,
    refetchInterval: 10000,
  });

  // Connect to socket
  useEffect(() => {
    if (!userId) return; // Wait for userId to be initialized
    
    console.log('🔌 Connecting socket with userId:', userId);
    const socket = socketManager.connect(userId);
    
    socket.on('connect', () => {
      setConnected(true);
      console.log('✅ Socket connected to server');
    });
    
    socket.on('disconnect', () => {
      setConnected(false);
      console.log('❌ Socket disconnected from server');
    });

    return () => {
      console.log('🔌 Cleaning up socket connection');
      setConnected(false); // Set to false BEFORE disconnecting to prevent race conditions
      socketManager.disconnect();
    };
  }, [userId]); // Re-connect when userId changes

  // Join active channel when it changes (this creates the user-specific server via Socket.IO)
  useEffect(() => {
    console.log('🔌 Channel join useEffect triggered:', {
      activeChannelId,
      userId,
      connected,
      willJoin: !!(activeChannelId && userId && connected)
    });
    
    if (!activeChannelId || !userId || !connected) {
      console.log('⏸️ Skipping channel join - waiting for:', {
        needsChannelId: !activeChannelId,
        needsUserId: !userId,
        needsConnection: !connected
      });
      return;
    }
    
    console.log('🔌 Joining channel:', activeChannelId, 'with userId as serverId:', userId);
    socketManager.joinChannel(activeChannelId, userId, { isDm: true });

    return () => {
      console.log('🔌 Leaving channel:', activeChannelId);
      socketManager.leaveChannel(activeChannelId);
    };
  }, [activeChannelId, userId, connected]); // Join when active channel, userId, or connection changes

  // Load channels when user ID or agent changes
  useEffect(() => {
    // Reset state when userId changes to show fresh data for the new user
    console.log('🔄 User ID changed, refreshing chat content...');
    setChannels([]);
    setActiveChannelId(null);
    setIsLoadingChannels(true);
    hasInitialized.current = false; // Allow auto-create for new user
    
    async function ensureUserServerAndLoadChannels() {
      if (!agent?.id || !userId) {
        setIsLoadingChannels(false);
        return;
      }

      try {
        // STEP 1: Create message server FIRST (before any channels)
        // This ensures the server_id exists for the foreign key constraint
        console.log('📝 Creating message server for user:', userId);
        try {
          const serverResult = await elizaClient.messaging.createServer({
            id: userId as any,
            name: `${userId.substring(0, 8)}'s Server`,
            sourceType: 'custom_ui',
            sourceId: userId,
            metadata: {
              createdBy: 'custom_ui',
              userId: userId,
              userType: 'chat_user',
            },
          });
          console.log('✅ Message server created/ensured:', serverResult.id);
          
          // STEP 1.5: Associate agent with the user's server
          // This is CRITICAL - without this, the agent won't process messages from this server
          console.log('🔗 Associating agent with user server...');
          try {
            await elizaClient.messaging.addAgentToServer(userId as any, agent.id as any);
            console.log('✅ Agent associated with user server:', userId);
          } catch (assocError: any) {
            console.warn('⚠️ Failed to associate agent with server (may already be associated):', assocError.message);
          }
        } catch (serverError: any) {
          // Server might already exist - that's fine
          console.log('⚠️ Server creation failed (may already exist):', serverError.message);
        }

        // STEP 2: Now load channels from the user-specific server
        const serverIdForQuery = userId;
        console.log('📂 Loading channels from user-specific server:', serverIdForQuery);
        console.log('👤 Agent ID:', agent.id);
        const response = await elizaClient.messaging.getServerChannels(serverIdForQuery as any);
        const dmChannels = await Promise.all(
          response.channels
            .filter((ch: any) => {
              if (ch.type !== 'DM') return false;
              
              // Check if this channel belongs to the current user
              // Match by user1 or user2 in metadata
              const isForUser = ch.metadata?.user1 === userId || ch.metadata?.user2 === userId;
              
              // Also check if it's for this specific agent
              const isForAgent = ch.metadata?.forAgent === agent.id || ch.metadata?.user2 === agent.id;
              
              return isForUser && isForAgent;
            })
            .map(async (ch: any) => {
              let createdAt = 0;
              if (ch.createdAt instanceof Date) {
                createdAt = ch.createdAt.getTime();
              } else if (typeof ch.createdAt === 'number') {
                createdAt = ch.createdAt;
              } else if (typeof ch.createdAt === 'string') {
                createdAt = Date.parse(ch.createdAt);
              } else if (ch.metadata?.createdAt) {
                // Try metadata.createdAt as fallback
                if (typeof ch.metadata.createdAt === 'string') {
                  createdAt = Date.parse(ch.metadata.createdAt);
                } else if (typeof ch.metadata.createdAt === 'number') {
                  createdAt = ch.metadata.createdAt;
                }
              }

              let lastMessageAt = 0;
              try {
                const msgs = await elizaClient.messaging.getChannelMessages(ch.id, { limit: 1 });
                if (msgs.messages.length > 0) {
                  const msg = msgs.messages[0];
                  if (msg.createdAt instanceof Date) {
                    lastMessageAt = msg.createdAt.getTime();
                  } else if (typeof msg.createdAt === 'number') {
                    lastMessageAt = msg.createdAt;
                  } else if (typeof msg.createdAt === 'string') {
                    lastMessageAt = Date.parse(msg.createdAt);
                  }
                }
              } catch (err) {
                console.warn(`Could not load last message for channel ${ch.id}`);
              }

              return {
                id: ch.id,
                name: ch.name || `Chat ${ch.id.substring(0, 8)}`,
                createdAt: createdAt || Date.now(),
                lastMessageAt,
              };
            })
        );

        const sortedChannels = dmChannels.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        setChannels(sortedChannels);
        
        console.log(`✅ Loaded ${sortedChannels.length} DM channels (sorted by creation time)`);
        sortedChannels.forEach((ch, i) => {
          const createdDate = ch.createdAt ? new Date(ch.createdAt).toLocaleString() : 'Unknown';
          console.log(`  ${i + 1}. ${ch.name} (${ch.id.substring(0, 8)}...) - Created: ${createdDate}`);
        });
        
        // If no channels exist, create one automatically
        // Note: hasInitialized prevents multiple auto-creates during the same session
        if (sortedChannels.length === 0 && !hasInitialized.current) {
          console.log('📝 No channels found, creating default channel...');
          hasInitialized.current = true;
          
          // Create default channel
          const timestamp = new Date().toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          });
          const channelName = `Chat - ${timestamp}`;
          const now = Date.now();
          
          try {
            const newChannel = await elizaClient.messaging.createGroupChannel({
              name: channelName,
              participantIds: [userId as any, agent.id as any],
              metadata: {
                server_id: userId,
                type: 'DM',
                isDm: true,
                user1: userId,
                user2: agent.id,
                forAgent: agent.id,
                createdAt: new Date(now).toISOString(),
              },
            });
            
            const newChannelData = {
              id: newChannel.id,
              name: newChannel.name,
              createdAt: now,
              lastMessageAt: 0,
            };
            
            setChannels([newChannelData]);
            setActiveChannelId(newChannel.id);
            console.log('✅ Default channel created and selected:', newChannel.id);
          } catch (error: any) {
            console.error('❌ Failed to create default channel:', error);
          }
        } else if (sortedChannels.length > 0) {
          // Always select the first (latest) channel after loading
          setActiveChannelId(sortedChannels[0].id);
          hasInitialized.current = true;
          console.log(`✅ Auto-selected latest channel: ${sortedChannels[0].name} (${sortedChannels[0].id.substring(0, 8)}...)`);
        }
      } catch (error: any) {
        console.warn('⚠️ Could not load channels:', error.message);
      } finally {
        setIsLoadingChannels(false);
      }
    }

    ensureUserServerAndLoadChannels();
  }, [agent?.id, userId]);

  const handleNewChat = async () => {
    if (isCreatingChannel || !agent?.id || !userId) return;

    setIsCreatingChannel(true);
    try {
      const timestamp = new Date().toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
      const channelName = `Chat - ${timestamp}`;

      const now = Date.now();
      
      // Use userId directly as server_id - Socket.IO creates the world/server automatically
      console.log('Creating channel with serverId:', userId);
      
      const newChannel = await elizaClient.messaging.createGroupChannel({
        name: channelName,
        participantIds: [userId as any, agent.id as any],
        metadata: {
          server_id: userId, // Socket.IO will auto-create this server when joining
          type: 'DM',
          isDm: true,
          user1: userId,
          user2: agent.id,
          forAgent: agent.id,
          createdAt: new Date(now).toISOString(),
        },
      });

      setChannels((prev) => [
        {
          id: newChannel.id,
          name: newChannel.name,
          createdAt: now,
          lastMessageAt: 0,
        },
        ...prev,
      ]);

      setActiveChannelId(newChannel.id);
    } catch (error: any) {
      console.error('❌ Failed to create new chat:', error);
    } finally {
      setIsCreatingChannel(false);
    }
  };

  const handleChannelSelect = async (newChannelId: string) => {
    if (newChannelId === activeChannelId) return;

    if (activeChannelId) {
      socketManager.leaveChannel(activeChannelId);
    }

    setActiveChannelId(newChannelId);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-muted flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-muted-foreground uppercase tracking-wider text-sm font-mono">
            Loading agent...
          </p>
        </div>
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="min-h-screen bg-muted flex items-center justify-center">
        <div className="text-center">
          <p className="text-xl text-foreground font-mono uppercase tracking-wider">No agent available</p>
          <p className="text-sm text-muted-foreground mt-2 font-mono">
            Please start the server with an agent configured.
          </p>
        </div>
      </div>
    );
  }

  return (
    <SidebarProvider>
      {/* Mobile Header */}
      <MobileHeader mockData={mockData} />

      {/* Desktop Layout - 3 columns */}
      <div className="w-full grid grid-cols-1 lg:grid-cols-12 gap-gap lg:px-sides">
        {/* Left Sidebar - Chat History */}
        <div className="hidden lg:block col-span-2 top-0 relative">
          <DashboardSidebar
            channels={channels}
            activeChannelId={activeChannelId}
            onChannelSelect={handleChannelSelect}
            onNewChat={handleNewChat}
            isCreatingChannel={isCreatingChannel}
            agentName={agent.name}
            agentAvatar={agent.settings?.avatar as string | undefined}
          />
                </div>

        {/* Center - Chat Interface */}
        <div className="col-span-1 lg:col-span-7">
          <div className="flex flex-col relative w-full gap-1 min-h-full">
            {/* Header */}
            <div className="flex items-center lg:items-baseline gap-2.5 md:gap-4 px-4 md:px-6 py-3 md:pb-4 lg:pt-7 ring-2 ring-pop sticky top-header-mobile lg:top-0 bg-background z-10">
              <div className="max-lg:contents rounded bg-primary size-7 md:size-9 flex items-center justify-center my-auto">
                <MessageSquare className="ml-1 lg:ml-0 opacity-50 md:opacity-100 size-5" />
              </div>
              <h1 className="text-xl lg:text-4xl font-display leading-[1] mb-1">
                AI Chat
              </h1>
              <span className="ml-auto text-xs md:text-sm text-muted-foreground block">
                Communicate with advanced language models
              </span>
            </div>
            
            {/* Content Area */}
            <div className="min-h-full flex-1 flex flex-col gap-8 md:gap-14 px-3 lg:px-6 py-6 md:py-10 ring-2 ring-pop bg-background">
              {!userId || !connected || isLoadingChannels || !activeChannelId ? (
                <div className="flex items-center justify-center h-[calc(100vh-12rem)]">
                  <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
                    <p className="mt-4 text-muted-foreground uppercase tracking-wider text-sm font-mono">
                      {!isInitialized && import.meta.env.VITE_CDP_PROJECT_ID && import.meta.env.VITE_CDP_PROJECT_ID !== 'your-project-id' ? 'Initializing wallet...' :
                       !userId ? 'Initializing user...' : 
                       !connected ? 'Connecting to server...' :
                       isLoadingChannels ? 'Loading channels...' : 
                       'Select a chat'}
                    </p>
                  </div>
                </div>
              ) : (
                <ChatInterface
                  agent={agent}
                  userId={userId}
                  serverId={userId} // Use userId as serverId for Socket.IO-level isolation
                  channelId={activeChannelId}
                />
              )}
            </div>
          </div>
        </div>

        {/* Right Sidebar - Widget, CDP Auth, Notifications, Small Chat */}
        <div className="col-span-3 hidden lg:block">
          <div className="space-y-gap py-sides min-h-screen max-h-screen sticky top-0 overflow-clip">
            <Widget widgetData={mockData.widgetData} />
            <CDPWalletCard />
            <Notifications initialNotifications={mockData.notifications} />
            <SmallChat />
          </div>
            </div>
          </div>

      {/* Mobile Chat */}
      <MobileChat />
    </SidebarProvider>
  );
}

// Wrap App with CDP Provider (if configured)
export default function AppWithCDP() {
  const cdpProjectId = import.meta.env.VITE_CDP_PROJECT_ID;
  const isCdpConfigured = cdpProjectId && cdpProjectId !== 'your-project-id';

  // If CDP is not configured, just return App without the provider
  if (!isCdpConfigured) {
    return <App />;
  }

  return (
    <CDPReactProvider 
      config={{
        projectId: cdpProjectId,
        ethereum: {
          createOnLogin: "eoa"
        },
        solana: {
          createOnLogin: true
        },
        appName: "Otaku AI Agent"
      }}
    >
      <App />
    </CDPReactProvider>
  );
}
