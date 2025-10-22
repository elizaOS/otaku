import { useEffect, useState, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CDPReactProvider } from "@coinbase/cdp-react";
import { useCDPWallet } from './hooks/useCDPWallet';
import { elizaClient } from './lib/elizaClient';
import { socketManager } from './lib/socketManager';
import { ChatInterface } from './components/chat/chat-interface';
import { SidebarProvider } from './components/ui/sidebar';
import { DashboardSidebar } from './components/dashboard/sidebar';
import Widget from './components/dashboard/widget';
import { CDPWalletCard } from './components/dashboard/cdp-wallet-card';
import CollapsibleNotifications from './components/dashboard/notifications/collapsible-notifications';
import AccountPage from './components/dashboard/account/page';
import { SignInModal } from './components/auth/SignInModal';
import { MobileHeader } from './components/dashboard/mobile-header';
import { LoadingPanelProvider, useLoadingPanel } from './contexts/LoadingPanelContext';
import { ModalProvider } from './contexts/ModalContext';
import { MessageSquare } from 'lucide-react';
import mockDataJson from './mock.json';
import type { MockData } from './types/dashboard';
import { resolveCdpUserInfo } from '@/lib/cdpUser';
import { UUID } from '@elizaos/core';

const mockData = mockDataJson as MockData;

/**
 * Authenticate with backend and get JWT token
 * Uses CDP's userId as the primary identifier
 * 
 * @param email User's email from CDP authentication
 * @param username User's display name from CDP
 * @param currentUser CDP currentUser object (to extract userId)
 */
async function authenticateUser(
  email: string,
  username: string, 
  currentUser?: any
): Promise<{ userId: string; token: string }> {
  try {
    console.log('🔐 Authenticating with backend...');
    
    // Extract CDP userId
    const cdpUserId = currentUser?.userId;
    
    if (!cdpUserId) {
      throw new Error('CDP userId not available - user may not be authenticated with CDP');
    }

    // Login with backend - send email, username, and CDP userId
    const { token, userId } = await elizaClient.auth.login({
      email,
      username,
      cdpUserId, // Use CDP's userId directly
    });
    
    // Store token in localStorage
    localStorage.setItem('auth-token', token);
    
    // Set token for all API calls
    elizaClient.setAuthToken(token);
    
    return { userId, token };
  } catch (error) {
    console.error('❌ Authentication failed:', error);
    throw error;
  }
}

interface Channel {
  id: string;
  name: string;
  createdAt?: number;
}

function App() {
  const { isInitialized, isSignedIn, userEmail, userName, signOut, currentUser } = useCDPWallet();
  const { showLoading, hide } = useLoadingPanel();
  const [userId, setUserId] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [isLoadingChannels, setIsLoadingChannels] = useState(true);
  const [isCreatingChannel, setIsCreatingChannel] = useState(false);
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const [currentView, setCurrentView] = useState<'chat' | 'account'>('chat');
  const [totalBalance, setTotalBalance] = useState(0);
  const [isLoadingUserProfile, setIsLoadingUserProfile] = useState(true);
  const [isNewChatMode, setIsNewChatMode] = useState(false); // Track if we're in "new chat" mode (no channel yet)

  // Determine loading state and message
  const getLoadingMessage = (): string[] | null => {
    if (!isInitialized && import.meta.env.VITE_CDP_PROJECT_ID) {
      return ['Connecting to Coinbase...', 'Setting up secure authentication'];
    }
    if (isSignedIn && isLoadingUserProfile) {
      return ['Loading Profile...', 'Syncing user profile...'];
    }
    return null;
  };

  const loadingMessage = getLoadingMessage();
  const [userProfile, setUserProfile] = useState<{
    avatarUrl: string;
    displayName: string;
    bio: string;
    email: string;
    walletAddress: string;
    memberSince: string;
  } | null>(null);
  const hasInitialized = useRef(false);

  // Control global loading panel based on app state
  useEffect(() => {
    const loadingPanelId = 'app-loading';
    
    if (loadingMessage && loadingMessage.length > 0) {
      showLoading('Initializing...', loadingMessage, loadingPanelId);
    } else if (currentView === 'chat' && isSignedIn && (!userId || !connected || isLoadingChannels || (!activeChannelId && !isNewChatMode))) {
      // Only show loading panel if user is signed in - otherwise let the sign-in modal display
      const message = !userId ? 'Initializing user...' : 
                     !connected ? 'Connecting to server...' :
                     isLoadingChannels ? 'Loading channels...' : 
                     'Select a chat';
      showLoading('Loading Chat...', message, loadingPanelId);
    } else {
      hide(loadingPanelId);
    }
  }, [loadingMessage, currentView, userId, connected, isLoadingChannels, activeChannelId, isNewChatMode, isSignedIn, showLoading, hide]);

  // Initialize authentication when CDP sign-in completes
  useEffect(() => {
    // If CDP is not configured, show error (authentication required)
    if (!import.meta.env.VITE_CDP_PROJECT_ID) {
      console.error('❌ CDP_PROJECT_ID not configured - authentication unavailable');
      return;
    }

    // Wait for CDP to initialize
    if (!isInitialized) {
      console.log('⏳ Waiting for CDP wallet to initialize...');
      return;
    }

    // If user is not signed in, clear state and show sign-in modal
    if (!isSignedIn || !userEmail) {
      console.log('🚫 User not signed in, waiting for authentication...');
      setUserId(null);
      elizaClient.clearAuthToken();
      return;
    }

    // User is signed in with CDP, authenticate with backend
    async function initAuth() {
      try {
        const { userId, token } = await authenticateUser(userEmail as string, userName || 'User', currentUser);
        setUserId(userId);
      } catch (error) {
        console.error('❌ Failed to authenticate:', error);
        setUserId(null);
      }
    }
    initAuth();
  }, [isInitialized, isSignedIn, userEmail, userName, currentUser]); // Re-run when CDP state changes

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

  // Sync user entity whenever userId, wallet address, or email changes
  useEffect(() => {
    if (!userId || !agentId || !userEmail) {
      // If any required data is missing, keep loading
      setIsLoadingUserProfile(true);
      return;
    }

    const syncUserEntity = async () => {
      try {
        setIsLoadingUserProfile(true);
        console.log('🔄 Syncing user entity for userId:', userId);

        const wallet = await elizaClient.cdp.getOrCreateWallet(userId);
        const walletAddress = wallet.address;
        
        // Try to get existing entity
        let entity;
        try {
          entity = await elizaClient.entities.getEntity(userId as any);
          console.log('✅ Found existing user entity in database');
        } catch (error: any) {
          // Entity doesn't exist, create it
          if (error?.status === 404 || error?.code === 'NOT_FOUND') {
            console.log('📝 Creating new user entity in database...');
            
            // Extract email and username using shared helper (DRY)
            const { email: cdpEmail, username: cdpUsername } = resolveCdpUserInfo(currentUser as any, { isSignedIn: true });
            
            // Use extracted values with fallbacks
            const finalEmail = cdpEmail || userEmail || `${currentUser?.userId}@cdp.local`;
            const finalUsername = cdpUsername || (cdpEmail ? cdpEmail.split('@')[0] : userName) || 'User';
            
            console.log('👤 CDP provided username:', cdpUsername || '(not found)');
            console.log('📧 CDP provided email:', cdpEmail || '(not found)');
            console.log('💾 Saving to database - Username:', finalUsername);
            console.log('💾 Saving to database - Email:', finalEmail);
            
            entity = await elizaClient.entities.createEntity({
              id: userId as any,
              agentId: agentId as any,
              names: [finalUsername],
              metadata: {
                avatarUrl: '/avatars/user_krimson.png',
                email: finalEmail,
                walletAddress,
                displayName: finalUsername,
                bio: 'DeFi Enthusiast • Blockchain Explorer',
                createdAt: new Date().toISOString(),
              },
            });
            
            // Set user profile state
            setUserProfile({
              avatarUrl: entity.metadata?.avatarUrl || '/avatars/user_krimson.png',
              displayName: entity.metadata?.displayName || finalUsername,
              bio: entity.metadata?.bio || 'DeFi Enthusiast • Blockchain Explorer',
              email: entity.metadata?.email || finalEmail,
              walletAddress,
              memberSince: entity.metadata?.createdAt || new Date().toISOString(),
            });
            setIsLoadingUserProfile(false);
            return;
          }
          throw error;
        }

        // Entity exists, check if metadata needs updating
        const needsUpdate = 
          !entity.metadata?.avatarUrl ||
          !entity.metadata?.email ||
          !entity.metadata?.walletAddress ||
          !entity.metadata?.bio ||
          (walletAddress && entity.metadata?.walletAddress !== walletAddress) ||
          (userEmail && entity.metadata?.email !== userEmail);

        if (needsUpdate) {
          console.log('📝 Updating user entity metadata...');
          const updated = await elizaClient.entities.updateEntity(userId as any, {
            metadata: {
              ...entity.metadata,
              avatarUrl: entity.metadata?.avatarUrl || '/avatars/user_krimson.png',
              email: userEmail || entity.metadata?.email || '',
              walletAddress: walletAddress || entity.metadata?.walletAddress || '',
              displayName: entity.metadata?.displayName || userName || 'User',
              bio: entity.metadata?.bio || 'DeFi Enthusiast • Blockchain Explorer',
              updatedAt: new Date().toISOString(),
            },
          });
          console.log('✅ Updated user entity:', updated);
          entity = updated; // Use updated entity
        } else {
          console.log('✅ User entity is up to date');
        }
        
        // Set user profile state from entity
        setUserProfile({
          avatarUrl: entity.metadata?.avatarUrl || '/avatars/user_krimson.png',
          displayName: entity.metadata?.displayName || userName || 'User',
          bio: entity.metadata?.bio || 'DeFi Enthusiast • Blockchain Explorer',
          email: userEmail || '',
          walletAddress: walletAddress || '',
          memberSince: entity.metadata?.createdAt || new Date().toISOString(),
        });
        setIsLoadingUserProfile(false);
      } catch (error) {
        console.error('❌ Error syncing user entity:', error);
      }
    };

    syncUserEntity();
  }, [userId, userEmail, agentId]); // Re-sync when any of these change


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
      isNewChatMode,
      willJoin: !!(activeChannelId && userId && connected && !isNewChatMode)
    });
    
    if (!activeChannelId || !userId || !connected || isNewChatMode) {
      console.log('⏸️ Skipping channel join - waiting for:', {
        needsChannelId: !activeChannelId,
        needsUserId: !userId,
        needsConnection: !connected,
        isNewChat: isNewChatMode
      });
      return;
    }
    
    console.log('🔌 Joining channel:', activeChannelId, 'with userId as serverId:', userId);
    socketManager.joinChannel(activeChannelId, userId, { isDm: true });

    return () => {
      console.log('🔌 Leaving channel:', activeChannelId);
      socketManager.leaveChannel(activeChannelId);
    };
  }, [activeChannelId, userId, connected, isNewChatMode]); // Join when active channel, userId, connection, or new chat mode changes

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
            id: userId as UUID,
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
              return {
                id: ch.id,
                name: ch.name || `Chat ${ch.id.substring(0, 8)}`,
                createdAt: createdAt || Date.now(),
              };
            })
        );

        const sortedChannels = dmChannels.sort((a: Channel, b: Channel) => (b.createdAt || 0) - (a.createdAt || 0));
        setChannels(sortedChannels);
        
        console.log(`✅ Loaded ${sortedChannels.length} DM channels (sorted by creation time)`);
        sortedChannels.forEach((ch: Channel, i: number) => {
          const createdDate = ch.createdAt ? new Date(ch.createdAt).toLocaleString() : 'Unknown';
          console.log(`  ${i + 1}. ${ch.name} (${ch.id.substring(0, 8)}...) - Created: ${createdDate}`);
        });
        
        // If no channels exist and user hasn't seen channels yet, enter new chat mode
        if (sortedChannels.length === 0 && !hasInitialized.current) {
          console.log('📝 No channels found, entering new chat mode...');
          hasInitialized.current = true;
          setIsNewChatMode(true);
          setActiveChannelId(null);
        } else if (sortedChannels.length > 0) {
          // Always select the first (latest) channel after loading
          setActiveChannelId(sortedChannels[0].id);
          setIsNewChatMode(false);
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
    if (!agent?.id || !userId) return;

    // Simply enter "new chat" mode - no channel is created yet
    // Channel will be created when user sends first message
    console.log('📝 Entering new chat mode (no channel created yet)');
    setIsNewChatMode(true);
    setActiveChannelId(null);
  };

  const handleChannelSelect = async (newChannelId: string) => {
    if (newChannelId === activeChannelId) return;

    if (activeChannelId) {
      socketManager.leaveChannel(activeChannelId);
    }

    setActiveChannelId(newChannelId);
    setIsNewChatMode(false); // Exit new chat mode when selecting existing channel
  };

  // Update user profile (avatar, displayName, bio)
  const updateUserProfile = async (updates: {
    avatarUrl?: string;
    displayName?: string;
    bio?: string;
  }) => {
    if (!userId || !userProfile) {
      throw new Error('User not initialized');
    }

    try {
      console.log('🔄 Updating user profile:', updates);
      
      const updated = await elizaClient.entities.updateEntity(userId as UUID, {
        metadata: {
          avatarUrl: updates.avatarUrl ?? userProfile.avatarUrl,
          displayName: updates.displayName ?? userProfile.displayName,
          bio: updates.bio ?? userProfile.bio,
          email: userProfile.email,
          walletAddress: userProfile.walletAddress,
          memberSince: userProfile.memberSince,
          updatedAt: new Date().toISOString(),
        },
      });

      // Update local state
      setUserProfile({
        ...userProfile,
        avatarUrl: updated.metadata?.avatarUrl || userProfile.avatarUrl,
        displayName: updated.metadata?.displayName || userProfile.displayName,
        bio: updated.metadata?.bio || userProfile.bio,
      });

      console.log('✅ User profile updated successfully');
    } catch (error) {
      console.error('❌ Failed to update user profile:', error);
      throw error;
    }
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
      {/* Sign In Modal - Shows when CDP is configured and user is not signed in */}
      {import.meta.env.VITE_CDP_PROJECT_ID && (
        <SignInModal isOpen={!isSignedIn} />
      )}
      
      {/* Mobile Header */}
      <MobileHeader mockData={mockData} onHomeClick={() => setCurrentView('chat')} />

      {/* Desktop Layout - 3 columns */}
      <div className="w-full grid grid-cols-1 lg:grid-cols-12 gap-gap lg:px-sides">
        {/* Left Sidebar - Chat History */}
        <div className="hidden lg:block col-span-2 top-0 relative">
          <DashboardSidebar
            channels={channels}
            activeChannelId={activeChannelId}
            onChannelSelect={(id) => {
              handleChannelSelect(id);
              setCurrentView('chat');
            }}
            onNewChat={() => {
              handleNewChat();
              setCurrentView('chat');
            }}
            isCreatingChannel={isCreatingChannel}
            userProfile={userProfile}
            onSignOut={signOut}
            onAccountClick={() => setCurrentView('account')}
            onHomeClick={() => setCurrentView('chat')}
          />
        </div>

        {/* Center - Chat Interface / Account */}
        <div className="col-span-1 lg:col-span-7">
          {currentView === 'account' ? (
            <AccountPage 
              totalBalance={totalBalance} 
              userProfile={userProfile}
              onUpdateProfile={updateUserProfile}
            />
          ) : (
            <div className="flex flex-col relative w-full gap-1 min-h-full">
              {/* Header */}
              <div className="flex items-center lg:items-baseline gap-2.5 md:gap-4 px-4 md:px-6 py-3 md:pb-4 lg:pt-7 ring-2 ring-pop sticky top-header-mobile lg:top-0 bg-background z-10">
                {(agent as any)?.settings?.avatar ? (
                  <div className="rounded size-7 md:size-9 overflow-hidden flex-shrink-0 my-auto">
                    <img 
                      src={(agent as any).settings.avatar as string} 
                      alt={agent?.name || 'Agent'}
                      className="w-full h-full object-cover"
                    />
                  </div>
                ) : (
                  <div className="rounded bg-primary size-7 md:size-9 flex items-center justify-center my-auto flex-shrink-0">
                    <MessageSquare className="opacity-50 md:opacity-100 size-4 md:size-5" />
                  </div>
                )}
                <h1 className="text-xl lg:text-4xl font-display leading-[1] mb-1">
                  Agent
                </h1>
                <span className="ml-auto text-xs md:text-sm text-muted-foreground block uppercase">
                  Your AI DeFi Assistant
                </span>
              </div>
              
              {/* Content Area */}
              <div className="min-h-full flex-1 flex flex-col gap-8 md:gap-14 px-3 lg:px-6 py-6 md:py-10 ring-2 ring-pop bg-background">
                {userId && connected && !isLoadingChannels && (activeChannelId || isNewChatMode) && (
                  <ChatInterface
                    agent={agent}
                    userId={userId}
                    serverId={userId} // Use userId as serverId for Socket.IO-level isolation
                    channelId={activeChannelId}
                    isNewChatMode={isNewChatMode}
                    onChannelCreated={(channelId, channelName) => {
                      // Add new channel to the list and set it as active
                      const now = Date.now();
                      setChannels((prev) => [
                        {
                          id: channelId,
                          name: channelName,
                          createdAt: now,
                        },
                        ...prev,
                      ]);
                      setActiveChannelId(channelId);
                      setIsNewChatMode(false);
                    }}
                  />
                )}
              </div>
            </div>
          )}
        </div>

        {/* Right Sidebar - Widget & CDP Wallet & Notifications */}
        <div className="col-span-3 hidden lg:block">
          <div className="space-y-gap py-sides min-h-screen max-h-screen sticky top-0 overflow-clip">
            <Widget widgetData={mockData.widgetData} />
            {userId && <CDPWalletCard userId={userId} walletAddress={userProfile?.walletAddress} onBalanceChange={setTotalBalance} />}
            <CollapsibleNotifications />
          </div>
        </div>
      </div>
    </SidebarProvider>
  );
}

// Wrap App with CDP Provider (if configured) and LoadingPanelProvider
export default function AppWithCDP() {
  const cdpProjectId = import.meta.env.VITE_CDP_PROJECT_ID;
  const isCdpConfigured = cdpProjectId;

  // If CDP is not configured, just return App without the CDP provider
  if (!isCdpConfigured) {
    return (
      <LoadingPanelProvider>
        <ModalProvider>
          <App />
        </ModalProvider>
      </LoadingPanelProvider>
    );
  }

  return (
    <CDPReactProvider 
      config={{
        projectId: cdpProjectId,
        ethereum: {
          createOnLogin: "smart"
        },
        appName: "Otaku AI Agent",
        authMethods: ["email", "sms", "oauth:google", "oauth:apple", "oauth:twitter", "oauth:discord"] as any, // Enable all auth methods including Google OAuth
      }}
    >
      <LoadingPanelProvider>
        <ModalProvider>
          <App />
        </ModalProvider>
      </LoadingPanelProvider>
    </CDPReactProvider>
  );
}
