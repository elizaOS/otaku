import { useEffect, useState, useRef, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import { CDPReactProvider } from "@coinbase/cdp-react";
import { useCDPWallet } from './hooks/useCDPWallet';
import { elizaClient } from './lib/elizaClient';
import { socketManager } from './lib/socketManager';
import { ChatInterface } from './components/chat/chat-interface';
import { SidebarProvider, useSidebar } from './components/ui/sidebar';
import { DashboardSidebar } from './components/dashboard/sidebar';
import Widget from './components/dashboard/widget';
import { CDPWalletCard, type CDPWalletCardRef } from './components/dashboard/cdp-wallet-card';
import CollapsibleNotifications from './components/dashboard/notifications/collapsible-notifications';
import AccountPage from './components/dashboard/account/page';
import LeaderboardPage from './components/dashboard/leaderboard/page';
import { SignInModal } from './components/auth/SignInModal';
import { MobileHeader } from './components/dashboard/mobile-header';
import { LoadingPanelProvider, useLoadingPanel } from './contexts/LoadingPanelContext';
import { ModalProvider, useModal } from './contexts/ModalContext';
import { MessageSquare, Info } from 'lucide-react';
import { resolveCdpUserInfo, type CdpUser } from '@/lib/cdpUser';
import { UUID } from '@elizaos/core';
import { AboutModalContent } from '@/components/about/about-modal-content';
import { getRandomAvatar } from '@/lib/utils';

// Available default avatars for deterministic randomization
const DEFAULT_AVATARS = [
  '/avatars/user_joyboy.png',
  '/avatars/user_krimson.png',
  '/avatars/user_mati.png',
  '/avatars/user_pek.png',
];

// Check if avatar is the default krimson avatar (early users have this)
const isKrimsonAvatar = (avatar: string | undefined): boolean => {
  if (!avatar) return false;
  return avatar.includes('user_krimson.png') || avatar.includes('user_krimson');
};

// Deterministic avatar selection based on userId (same user always gets same avatar)
const getDeterministicAvatar = (userId: string): string => {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    const char = userId.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  const index = Math.abs(hash) % DEFAULT_AVATARS.length;
  return DEFAULT_AVATARS[index];
};

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
  currentUser?: CdpUser
): Promise<{ userId: string; token: string }> {
  try {
    console.log(' Authenticating with backend...');
    
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
    console.error(' Authentication failed:', error);
    throw error;
  }
}

interface Channel {
  id: string;
  name: string;
  createdAt?: number;
}

const ABOUT_MODAL_ID = 'about-otaku-modal';

function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const { isInitialized, isSignedIn, userEmail, userName, signOut, currentUser } = useCDPWallet();
  const { showLoading, hide } = useLoadingPanel();
  const [userId, setUserId] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [isLoadingChannels, setIsLoadingChannels] = useState(true);
  const [isCreatingChannel, setIsCreatingChannel] = useState(false);
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const [totalBalance, setTotalBalance] = useState(0);
  const [isLoadingUserProfile, setIsLoadingUserProfile] = useState(true);
  const [isNewChatMode, setIsNewChatMode] = useState(false); // Track if we're in "new chat" mode (no channel yet)
  
  // Derive currentView from URL pathname
  const getCurrentView = (): 'chat' | 'account' | 'leaderboard' => {
    const path = location.pathname;
    if (path === '/account') return 'account';
    if (path === '/leaderboard') return 'leaderboard';
    if (path === '/chat' || path === '/') return 'chat'; // Chat mode at /chat or /
    return 'chat'; // Default to chat for any other path
  };
  
  const currentView = getCurrentView();
  
  // Redirect root path to /chat when logged in
  useEffect(() => {
    if (isSignedIn && location.pathname === '/') {
      navigate('/chat', { replace: true });
    }
  }, [isSignedIn, location.pathname, navigate]);
  
  // Ref to access wallet's refresh functions
  const walletRef = useRef<CDPWalletCardRef>(null);
  
  // Stabilize balance change callback to prevent wallet re-renders
  const handleBalanceChange = useCallback((balance: number) => {
    setTotalBalance(balance);
  }, []);

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
    phoneNumber?: string;
    walletAddress: string;
    memberSince: string;
  } | null>(null);
  const hasInitialized = useRef(false);

  // Capture referral code from URL and persist it
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const refCode = params.get('ref') || params.get('referral');
    if (refCode) {
      console.log(' Captured referral code:', refCode);
      localStorage.setItem('referral_code', refCode);
    }
  }, []);

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
      console.error(' CDP_PROJECT_ID not configured - authentication unavailable');
      return;
    }

    // Wait for CDP to initialize
    if (!isInitialized) {
      console.log(' Waiting for CDP wallet to initialize...');
      return;
    }

    // If user is not signed in, clear state and show sign-in modal
    if (!isSignedIn) {
      console.log(' User not signed in, waiting for authentication...');
      setUserId(null);
      elizaClient.clearAuthToken();
      return;
    }

    // User is signed in with CDP, authenticate with backend
    async function initAuth() {
      try {
        // Resolve email/username for auth, with robust fallbacks for SMS-only users
        const { email: resolvedEmail, username: resolvedUsername } = resolveCdpUserInfo(currentUser as CdpUser | undefined, { isSignedIn: true });
        const emailForAuth = resolvedEmail || `${currentUser?.userId}@cdp.local`;
        const usernameForAuth = resolvedUsername || (emailForAuth ? emailForAuth.split('@')[0] : 'User');

        const { userId, token } = await authenticateUser(emailForAuth, usernameForAuth, currentUser);
        setUserId(userId);
      } catch (error) {
        console.error(' Failed to authenticate:', error);
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
    staleTime: 5 * 60 * 1000, // Consider data fresh for 5 minutes
  });

  const agentId = agentsData?.[0]?.id;

  // Sync user entity whenever userId or agent changes
  useEffect(() => {
    if (!userId || !agentId) {
      // If any required data is missing, keep loading
      setIsLoadingUserProfile(true);
      return;
    }

    const syncUserEntity = async () => {
      try {
        setIsLoadingUserProfile(true);
        console.log(' Syncing user entity for userId:', userId);

        const wallet = await elizaClient.cdp.getOrCreateWallet(userId);
        const walletAddress = wallet.address;
        // Resolve CDP user info with fallbacks (works for SMS-only signups)
        const { email: cdpEmail, username: cdpUsername, phoneNumber } = resolveCdpUserInfo(currentUser as CdpUser | undefined, { isSignedIn: true });
        const finalEmail = cdpEmail || userEmail || `${currentUser?.userId}@cdp.local`;
        const finalUsername = cdpUsername || (cdpEmail ? cdpEmail.split('@')[0] : userName) || 'User';
        
        // Try to get existing entity
        let entity;
        try {
          entity = await elizaClient.entities.getEntity(userId as UUID);
          console.log(' Found existing user entity in database');
        } catch (error: any) {
          // Entity doesn't exist, create it
          if (error?.status === 404 || error?.code === 'NOT_FOUND') {
            console.log(' Creating new user entity in database...');
            
            // Get referral code from storage
            const referralCode = localStorage.getItem('referral_code');
            if (referralCode) {
              console.log(' Applying referral code to new user:', referralCode);
            }

            const randomAvatar = getRandomAvatar();
            entity = await elizaClient.entities.createEntity({
              id: userId as UUID,
              agentId: agentId as UUID,
              names: [finalUsername],
              metadata: {
                avatarUrl: randomAvatar,
                email: finalEmail,
                phoneNumber,
                walletAddress,
                displayName: finalUsername,
                bio: 'DeFi Enthusiast • Blockchain Explorer',
                createdAt: new Date().toISOString(),
                referredBy: referralCode || undefined,
              },
            });
            
            // Set user profile state
            setUserProfile({
              avatarUrl: entity.metadata?.avatarUrl || randomAvatar,
              displayName: entity.metadata?.displayName || finalUsername,
              bio: entity.metadata?.bio || 'DeFi Enthusiast • Blockchain Explorer',
              email: entity.metadata?.email || finalEmail,
              phoneNumber: entity.metadata?.phoneNumber || phoneNumber,
              walletAddress,
              memberSince: entity.metadata?.createdAt || new Date().toISOString(),
            });
            setIsLoadingUserProfile(false);
            return;
          }
          throw error;
        }

        // Check if avatar needs randomization (missing or is krimson.png)
        const currentAvatar = entity.metadata?.avatarUrl;
        const shouldRandomizeAvatar = !currentAvatar || isKrimsonAvatar(currentAvatar);
        
        // Entity exists, check if metadata needs updating
        const needsUpdate = 
          shouldRandomizeAvatar ||
          !entity.metadata?.email ||
          !entity.metadata?.walletAddress ||
          !entity.metadata?.bio ||
          !entity.metadata?.displayName ||
          (phoneNumber && entity.metadata?.phoneNumber !== phoneNumber) ||
          (walletAddress && entity.metadata?.walletAddress !== walletAddress) ||
          (finalEmail && entity.metadata?.email !== finalEmail);

        if (needsUpdate) {
          console.log(' Updating user entity metadata...');
          // If user doesn't have an avatar or has krimson.png, assign a deterministic random one
          const avatarUrl = shouldRandomizeAvatar 
            ? getDeterministicAvatar(userId)
            : (entity.metadata?.avatarUrl || getRandomAvatar());
          
          if (shouldRandomizeAvatar) {
            console.log(` Randomizing avatar for user (was: ${currentAvatar || 'none'}, now: ${avatarUrl})`);
          }
          
          const updated = await elizaClient.entities.updateEntity(userId as UUID, {
            metadata: {
              ...entity.metadata,
              avatarUrl,
              email: finalEmail || entity.metadata?.email || '',
              phoneNumber: phoneNumber || entity.metadata?.phoneNumber || undefined,
              walletAddress: walletAddress || entity.metadata?.walletAddress || '',
              displayName: entity.metadata?.displayName || finalUsername || 'User',
              bio: entity.metadata?.bio || 'DeFi Enthusiast • Blockchain Explorer',
              updatedAt: new Date().toISOString(),
            },
          });
          console.log(' Updated user entity:', updated);
          entity = updated; // Use updated entity
        } else {
          console.log(' User entity is up to date');
        }
        
        // Set user profile state from entity
        setUserProfile({
          avatarUrl: entity.metadata?.avatarUrl || getRandomAvatar(),
          displayName: entity.metadata?.displayName || finalUsername || 'User',
          bio: entity.metadata?.bio || 'DeFi Enthusiast • Blockchain Explorer',
          email: finalEmail || '',
          phoneNumber: entity.metadata?.phoneNumber || '',
          walletAddress: walletAddress || '',
          memberSince: entity.metadata?.createdAt || new Date().toISOString(),
        });
        setIsLoadingUserProfile(false);
      } catch (error) {
        console.error(' Error syncing user entity:', error);
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
    staleTime: 5 * 60 * 1000, // Consider data fresh for 5 minutes
  });

  // Connect to socket
  useEffect(() => {
    if (!userId) return; // Wait for userId to be initialized
    
    console.log(' Connecting socket with userId:', userId);
    const socket = socketManager.connect(userId);
    
    socket.on('connect', () => {
      setConnected(true);
      console.log(' Socket connected to server');
    });
    
    socket.on('disconnect', () => {
      setConnected(false);
      console.log(' Socket disconnected from server');
    });

    return () => {
      console.log(' Cleaning up socket connection');
      setConnected(false); // Set to false BEFORE disconnecting to prevent race conditions
      socketManager.disconnect();
    };
  }, [userId]); // Re-connect when userId changes

  // Join active channel when it changes (this creates the user-specific server via Socket.IO)
  useEffect(() => {
    console.log(' Channel join useEffect triggered:', {
      activeChannelId,
      userId,
      connected,
      isNewChatMode,
      willJoin: !!(activeChannelId && userId && connected && !isNewChatMode)
    });
    
    if (!activeChannelId || !userId || !connected || isNewChatMode) {
      console.log(' Skipping channel join - waiting for:', {
        needsChannelId: !activeChannelId,
        needsUserId: !userId,
        needsConnection: !connected,
        isNewChat: isNewChatMode
      });
      return;
    }
    
    console.log(' Joining channel:', activeChannelId, 'with userId as serverId:', userId);
    socketManager.joinChannel(activeChannelId, userId, { isDm: true });

    return () => {
      console.log(' Leaving channel:', activeChannelId);
      socketManager.leaveChannel(activeChannelId);
    };
  }, [activeChannelId, userId, connected, isNewChatMode]); // Join when active channel, userId, connection, or new chat mode changes

  // Load channels when user ID or agent changes
  useEffect(() => {
    // Reset state when userId changes to show fresh data for the new user
    console.log(' User ID changed, refreshing chat content...');
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
        console.log(' Creating message server for user:', userId);
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
          console.log(' Message server created/ensured:', serverResult.id);
          
          // STEP 1.5: Associate agent with the user's server
          // This is CRITICAL - without this, the agent won't process messages from this server
          console.log(' Associating agent with user server...');
          try {
            await elizaClient.messaging.addAgentToServer(userId as UUID, agent.id as UUID);
            console.log(' Agent associated with user server:', userId);
          } catch (assocError: any) {
            console.warn(' Failed to associate agent with server (may already be associated):', assocError.message);
          }
        } catch (serverError: any) {
          // Server might already exist - that's fine
          console.log(' Server creation failed (may already exist):', serverError.message);
        }

        // STEP 2: Now load channels from the user-specific server
        const serverIdForQuery = userId;
        console.log(' Loading channels from user-specific server:', serverIdForQuery);
        console.log(' Agent ID:', agent.id);
        const response = await elizaClient.messaging.getServerChannels(serverIdForQuery as UUID);
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
        
        console.log(` Loaded ${sortedChannels.length} DM channels (sorted by creation time)`);
        sortedChannels.forEach((ch: Channel, i: number) => {
          const createdDate = ch.createdAt ? new Date(ch.createdAt).toLocaleString() : 'Unknown';
          console.log(`  ${i + 1}. ${ch.name} (${ch.id.substring(0, 8)}...) - Created: ${createdDate}`);
        });
        
        // If no channels exist and user hasn't seen channels yet, enter new chat mode
        if (sortedChannels.length === 0 && !hasInitialized.current) {
          console.log(' No channels found, entering new chat mode...');
          hasInitialized.current = true;
          setIsNewChatMode(true);
          setActiveChannelId(null);
        } else if (sortedChannels.length > 0) {
          // Always select the first (latest) channel after loading
          setActiveChannelId(sortedChannels[0].id);
          setIsNewChatMode(false);
          hasInitialized.current = true;
          console.log(` Auto-selected latest channel: ${sortedChannels[0].name} (${sortedChannels[0].id.substring(0, 8)}...)`);
        }
      } catch (error: any) {
        console.warn(' Could not load channels:', error.message);
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
    console.log(' Entering new chat mode (no channel created yet)');
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
      console.log(' Updating user profile:', updates);
      
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

      console.log(' User profile updated successfully');
    } catch (error) {
      console.error(' Failed to update user profile:', error);
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
      <AppContent
        agent={agent}
        userId={userId}
        connected={connected}
        channels={channels}
        activeChannelId={activeChannelId}
        isCreatingChannel={isCreatingChannel}
        isNewChatMode={isNewChatMode}
        currentView={currentView}
        userProfile={userProfile}
        totalBalance={totalBalance}
        isLoadingChannels={isLoadingChannels}
        walletRef={walletRef}
        handleNewChat={handleNewChat}
        handleChannelSelect={handleChannelSelect}
        handleBalanceChange={handleBalanceChange}
        setChannels={setChannels}
        setActiveChannelId={setActiveChannelId}
        setIsNewChatMode={setIsNewChatMode}
        updateUserProfile={updateUserProfile}
        signOut={signOut}
        isSignedIn={isSignedIn}
        agentId={agentId}
        navigate={navigate}
      />
    </SidebarProvider>
  );
}

// Inner component that has access to useSidebar
function AppContent({
  agent,
  userId,
  connected,
  channels,
  activeChannelId,
  isCreatingChannel,
  isNewChatMode,
  currentView,
  userProfile,
  totalBalance,
  isLoadingChannels,
  walletRef,
  handleNewChat,
  handleChannelSelect,
  handleBalanceChange,
  setChannels,
  setActiveChannelId,
  setIsNewChatMode,
  updateUserProfile,
  signOut,
  isSignedIn,
  agentId,
  navigate,
}: any) {
  const { setOpenMobile } = useSidebar();
  const { showModal, hideModal } = useModal();

  useEffect(() => {
    setOpenMobile(false);
  }, [currentView])

  const handleOpenAbout = () => {
    showModal(
      <AboutModalContent onClose={() => hideModal(ABOUT_MODAL_ID)} />,
      ABOUT_MODAL_ID,
      {
        closeOnBackdropClick: true,
        closeOnEsc: true,
        showCloseButton: false,
        className: 'max-w-5xl w-full',
      }
    );
  };

  const onNewChat = () => {
    handleNewChat();
    navigate('/chat');
    setOpenMobile(false);
  };

  const onChannelSelect = (id: string) => {
    handleChannelSelect(id);
    navigate('/chat');
    setOpenMobile(false);
  };
  
  const onChatClick = () => {
    navigate('/chat');
    setOpenMobile(false);
  };
  
  const onAccountClick = () => {
    navigate('/account');
    setOpenMobile(false);
  };
  
  const onLeaderboardClick = () => {
    navigate('/leaderboard');
    setOpenMobile(false);
  };
  
  const onHomeClick = () => {
    navigate('/chat');
    setOpenMobile(false);
  };

  return (
    <>
      {/* Sign In Modal - Shows when CDP is configured and user is not signed in */}
      {import.meta.env.VITE_CDP_PROJECT_ID && (
        <SignInModal isOpen={!isSignedIn} />
      )}
      
      {/* Mobile Header */}
      <MobileHeader onHomeClick={() => navigate('/chat')} />

      {/* Desktop Layout - 3 columns */}
      <div className="w-full min-h-[100dvh] h-[100dvh] lg:min-h-screen lg:h-screen grid grid-cols-1 lg:grid-cols-12 gap-gap lg:px-sides">
        {/* Left Sidebar - Chat History */}
        <div className="hidden lg:block col-span-2 top-0 relative">
          <DashboardSidebar
            channels={channels}
            activeChannelId={activeChannelId}
            onChannelSelect={onChannelSelect}
            onNewChat={onNewChat}
            isCreatingChannel={isCreatingChannel}
            userProfile={userProfile}
            onSignOut={signOut}
            onChatClick={onChatClick}
            onAccountClick={onAccountClick}
            onLeaderboardClick={onLeaderboardClick}
            onHomeClick={onHomeClick}
          />
        </div>

        {/* Center - Chat Interface / Account / Leaderboard */}
        <div className="col-span-1 lg:col-span-7 h-full overflow-auto lg:overflow-hidden">
          {currentView === 'account' ? (
            <AccountPage 
              totalBalance={totalBalance} 
              userProfile={userProfile}
              onUpdateProfile={updateUserProfile}
              agentId={agentId as UUID | undefined}
              userId={userId as UUID | undefined}
            />
          ) : currentView === 'leaderboard' ? (
            agentId ? (
              <LeaderboardPage 
                agentId={agentId as UUID}
                userId={userId as UUID | undefined}
              />
            ) : (
              <div className="flex items-center justify-center h-full">
                <p className="text-muted-foreground">Loading agent...</p>
              </div>
            )
          ) : (
            <div className="flex flex-col relative w-full gap-1 min-h-0 h-full">
              {/* Header */}
              <div className="flex items-center lg:items-baseline gap-2.5 md:gap-4 px-4 md:px-6 py-3 md:pb-4 lg:pt-7 ring-2 ring-pop sticky top-header-mobile lg:top-0 bg-background z-10">
               <h1 className="text-xl lg:text-4xl font-display leading-none mb-1">
                  CHAT
                </h1>
                <button 
                  className="ml-auto rounded-full px-3 py-2 transition-colors hover:bg-accent flex items-center gap-2"
                  title="About"
                  onClick={handleOpenAbout}
                >
                  <Info className="size-4 md:size-5 text-muted-foreground" />
                  <span className="text-sm md:text-base text-muted-foreground uppercase">ABOUT</span>
                </button>
              </div>
              
              {/* Content Area */}
              <div className="min-h-0 flex-1 flex flex-col gap-8 md:gap-14 px-3 lg:px-6 pt-10 md:pt-6 ring-2 ring-pop bg-background">
                {userId && connected && !isLoadingChannels && (activeChannelId || isNewChatMode) && (
                  <div className="flex-1 min-h-0">
                    <ChatInterface
                      agent={agent}
                      userId={userId}
                      serverId={userId} // Use userId as serverId for Socket.IO-level isolation
                      channelId={activeChannelId}
                      isNewChatMode={isNewChatMode}
                      onChannelCreated={(channelId, channelName) => {
                        // Add new channel to the list and set it as active
                        const now = Date.now();
                        setChannels((prev: Channel[]) => [
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
                      onActionCompleted={async () => {
                        // Refresh wallet data when agent completes an action
                        console.log(' Agent action completed - refreshing wallet...');
                        await walletRef.current?.refreshAll();
                      }}
                    />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Right Sidebar - Widget & CDP Wallet & Notifications */}
        <div className="col-span-3 hidden lg:block">
          <div className="space-y-gap py-sides min-h-screen max-h-screen sticky top-0 overflow-clip">
            <Widget />
            {userId && <CDPWalletCard ref={walletRef} userId={userId} walletAddress={userProfile?.walletAddress} onBalanceChange={handleBalanceChange} />}
            <CollapsibleNotifications />
          </div>
        </div>
      </div>
    </>
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
