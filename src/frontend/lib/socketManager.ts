import { io, Socket } from 'socket.io-client';

// Socket message types (must match server's SOCKET_MESSAGE_TYPE enum)
const SOCKET_MESSAGE_TYPE = {
  ROOM_JOINING: 1,
  SEND_MESSAGE: 2,
  MESSAGE: 3,
  ACK: 4,
  THINKING: 5,
  CONTROL: 6,
} as const;

class SocketManager {
  private socket: Socket | null = null;
  private userId: string | null = null;
  private userName: string | null = null;
  private activeChannels: Set<string> = new Set();

  connect(userId: string, userName?: string) {
    if (this.socket?.connected) {
      console.log('Socket already connected');
      // Update username if provided (allows updating after initial connect)
      if (userName) {
        this.userName = userName;
      }
      return this.socket;
    }
    
    this.userId = userId;
    this.userName = userName || null;
    
    // Get auth token from localStorage for Socket.IO authentication
    const token = localStorage.getItem('auth-token');
    if (!token) {
      console.warn('No auth token found for socket connection');
    }
    
    this.socket = io(window.location.origin + '/', {
      autoConnect: true,
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5,
      auth: {
        token, // Pass JWT for server-side authentication
      },
    });

    this.socket.on('connect', () => {
      console.log(' Connected to Eliza server');
    });

    this.socket.on('disconnect', (reason) => {
      console.log(' Disconnected from Eliza server:', reason);
    });

    this.socket.on('connect_error', (error) => {
      console.error('Connection error:', error);
    });

    return this.socket;
  }

  /**
   * Update the stored username (useful when user profile loads after socket connects)
   */
  setUserName(userName: string) {
    this.userName = userName;
  }

  joinChannel(channelId: string, serverId: string, metadata?: Record<string, any>) {
    if (!this.socket) {
      throw new Error('Socket not connected. Call connect() first.');
    }
    
    this.activeChannels.add(channelId);
    
    this.socket.emit('message', {
      type: SOCKET_MESSAGE_TYPE.ROOM_JOINING,
      payload: {
        channelId,
        entityId: this.userId,
        serverId, // Pass userId as serverId for user-specific world isolation
        metadata,
      },
    });
    
  }

  leaveChannel(channelId: string) {
    this.activeChannels.delete(channelId);
    console.log(`Left channel: ${channelId}`);
  }

  sendMessage(channelId: string, message: string, serverId: string, metadata?: Record<string, any>) {
    if (!this.socket) {
      throw new Error('Socket not connected');
    }
    
    // Use stored username or fallback to a short-form identifier
    const senderName = this.userName || `User-${this.userId?.substring(0, 8) || 'Unknown'}`;
    
    const payload = {
      senderId: this.userId,
      senderName,
      message,
      channelId,
      serverId,
      source: 'custom_ui',
      metadata,
    };
    
    console.log(' [SocketManager] Emitting SEND_MESSAGE:', payload);
    
    this.socket.emit('message', {
      type: SOCKET_MESSAGE_TYPE.SEND_MESSAGE,
      payload,
    });
  }

  onMessage(callback: (data: any) => void) {
    if (!this.socket) {
      throw new Error('Socket not connected');
    }
    this.socket.on('messageBroadcast', callback);
    return () => this.socket?.off('messageBroadcast', callback);
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.activeChannels.clear();
    }
  }

  isConnected(): boolean {
    return this.socket?.connected || false;
  }
}

export const socketManager = new SocketManager();

