import type { ElizaOS } from '@elizaos/core';
import {
  logger,
  customLevels,
  SOCKET_MESSAGE_TYPE,
  validateUuid,
  ChannelType,
  type UUID,
  EventType,
} from '@elizaos/core';
import type { Socket, Server as SocketIOServer } from 'socket.io';
import jwt from 'jsonwebtoken';
import type { AgentServer } from '../index';
import { attachmentsToApiUrls } from '../utils/media-transformer';
import type { AuthTokenPayload } from '../middleware/jwt';

const DEFAULT_SERVER_ID = '00000000-0000-0000-0000-000000000000' as UUID; // Single default server
const JWT_SECRET = process.env.JWT_SECRET;

/**
 * Extended Socket interface with authenticated user data
 */
interface AuthenticatedSocket extends Socket {
  userId?: string;
  userEmail?: string;
  username?: string;
  isAdmin?: boolean;
}
export class SocketIORouter {
  private elizaOS: ElizaOS;
  private connections: Map<string, UUID>; // socket.id -> agentId (for agent-specific interactions like log streaming, if any)
  private logStreamConnections: Map<string, { agentName?: string; level?: string }>;
  private serverInstance: AgentServer;

  constructor(elizaOS: ElizaOS, serverInstance: AgentServer) {
    this.elizaOS = elizaOS;
    this.connections = new Map();
    this.logStreamConnections = new Map();
    this.serverInstance = serverInstance;
    logger.info(`[SocketIO] Router initialized with ${this.elizaOS.getAgents().length} agents`);
  }

  setupListeners(io: SocketIOServer) {
    logger.info(`[SocketIO] Setting up Socket.IO event listeners`);
    const messageTypes = Object.keys(SOCKET_MESSAGE_TYPE).map(
      (key) => `${key}: ${SOCKET_MESSAGE_TYPE[key as keyof typeof SOCKET_MESSAGE_TYPE]}`
    );
    logger.info(`[SocketIO] Registered message types: ${messageTypes.join(', ')}`);

    // Authentication middleware for Socket.IO
    io.use((socket: AuthenticatedSocket, next) => {
      this.authenticateSocket(socket, next);
    });

    io.on('connection', (socket: Socket) => {
      this.handleNewConnection(socket as AuthenticatedSocket, io);
    });
  }

  /**
   * Authenticate socket connection via JWT token
   * Token can be passed in auth.token, query.token, or Authorization header
   */
  private authenticateSocket(socket: AuthenticatedSocket, next: (err?: Error) => void) {
    const token = 
      socket.handshake.auth?.token ||
      socket.handshake.query?.token ||
      socket.handshake.headers?.authorization?.replace('Bearer ', '');

    if (!token) {
      // Allow unauthenticated connections but mark them
      logger.debug(`[SocketIO] Unauthenticated connection: ${socket.id}`);
      return next();
    }

    if (!JWT_SECRET) {
      logger.warn('[SocketIO] JWT_SECRET not configured - cannot verify tokens');
      return next();
    }

    try {
      const decoded = jwt.verify(token, JWT_SECRET) as AuthTokenPayload;
      socket.userId = decoded.userId;
      socket.userEmail = decoded.email;
      socket.username = decoded.username;
      socket.isAdmin = decoded.isAdmin || false;
      logger.info(`[SocketIO] Authenticated socket ${socket.id} as user ${decoded.username} (${decoded.userId.substring(0, 8)}...)`);
      next();
    } catch (error: any) {
      logger.warn(`[SocketIO] Socket auth failed for ${socket.id}: ${error.message}`);
      // Don't reject - allow connection but mark as unauthenticated
      next();
    }
  }

  /**
   * Check if user is authorized to access a channel
   */
  private async checkChannelAuthorization(
    socket: AuthenticatedSocket,
    channelId: UUID
  ): Promise<{ authorized: boolean; error?: string }> {
    // Admins can access everything
    if (socket.isAdmin) {
      return { authorized: true };
    }

    // Unauthenticated users cannot access channels
    if (!socket.userId) {
      return { authorized: false, error: 'Authentication required to access channels' };
    }

    try {
      // Check if user is a participant of the channel
      const participants = await this.serverInstance.getChannelParticipants(channelId);
      if (participants.includes(socket.userId as UUID)) {
        return { authorized: true };
      }

      return { authorized: false, error: 'You are not a participant of this channel' };
    } catch (error: any) {
      // If channel doesn't exist yet, allow (it will be created)
      if (error.message?.includes('not found') || error.message?.includes('does not exist')) {
        return { authorized: true };
      }
      logger.error(`[SocketIO] Error checking channel authorization: ${error.message}`);
      return { authorized: false, error: 'Unable to verify channel access' };
    }
  }

  private handleNewConnection(socket: AuthenticatedSocket, _io: SocketIOServer) {
    const authInfo = socket.userId 
      ? `authenticated as ${socket.username} (${socket.userId.substring(0, 8)}...)` 
      : 'unauthenticated';
    logger.info(`[SocketIO] New connection: ${socket.id} - ${authInfo}`);

    socket.on(String(SOCKET_MESSAGE_TYPE.ROOM_JOINING), (payload) => {
      logger.debug(
        `[SocketIO] Channel joining event received directly: ${JSON.stringify(payload)}`
      );
      this.handleChannelJoining(socket, payload);
    });

    socket.on(String(SOCKET_MESSAGE_TYPE.SEND_MESSAGE), (payload) => {
      const messagePreview =
        payload.message?.substring(0, 50) + (payload.message?.length > 50 ? '...' : '');
      const channelId = payload.channelId || payload.roomId;
      logger.info(
        `[SocketIO] SEND_MESSAGE event received directly: ${JSON.stringify({
          senderId: payload.senderId,
          channelId: channelId,
          messagePreview,
        })}`
      );
      this.handleMessageSubmission(socket, payload);
    });

    socket.on('message', (data) => {
      logger.info(
        `[SocketIO] Generic 'message' event received: ${JSON.stringify(data)} (SocketID: ${socket.id})`
      );
      this.handleGenericMessage(socket, data);
    });

    socket.on('subscribe_logs', () => this.handleLogSubscription(socket));
    socket.on('unsubscribe_logs', () => this.handleLogUnsubscription(socket));
    socket.on('update_log_filters', (filters) => this.handleLogFilterUpdate(socket, filters));
    socket.on('disconnect', () => this.handleDisconnect(socket));
    socket.on('error', (error) => {
      logger.error(
        `[SocketIO] Socket error for ${socket.id}: ${error.message}`,
        error instanceof Error ? error.message : String(error)
      );
    });

    if (process.env.NODE_ENV === 'development') {
      socket.onAny((event, ...args) => {
        logger.info(`[SocketIO DEBUG ${socket.id}] Event '${event}': ${JSON.stringify(args)}`);
      });
    }

    socket.emit('connection_established', {
      message: 'Connected to Eliza Socket.IO server',
      socketId: socket.id,
      authenticated: !!socket.userId,
      userId: socket.userId,
      username: socket.username,
    });
  }

  private handleGenericMessage(socket: AuthenticatedSocket, data: any) {
    try {
      if (!(data && typeof data === 'object' && 'type' in data && 'payload' in data)) {
        logger.warn(
          `[SocketIO ${socket.id}] Malformed 'message' event data: ${JSON.stringify(data)}`
        );
        return;
      }
      const { type, payload } = data;

      switch (type) {
        case SOCKET_MESSAGE_TYPE.ROOM_JOINING:
          logger.info(`[SocketIO ${socket.id}] Handling channel joining via 'message' event`);
          this.handleChannelJoining(socket, payload);
          break;
        case SOCKET_MESSAGE_TYPE.SEND_MESSAGE:
          logger.info(`[SocketIO ${socket.id}] Handling message sending via 'message' event`);
          this.handleMessageSubmission(socket, payload);
          break;
        default:
          logger.warn(
            `[SocketIO ${socket.id}] Unknown message type received in 'message' event: ${type}`
          );
          break;
      }
    } catch (error: any) {
      logger.error(
        `[SocketIO ${socket.id}] Error processing 'message' event: ${error.message}`,
        error
      );
    }
  }

  private async handleChannelJoining(socket: AuthenticatedSocket, payload: any) {
    const channelId = payload.channelId || payload.roomId; // Support both for backward compatibility
    const { agentId, entityId, serverId, metadata } = payload;

    logger.debug(
      `[SocketIO] handleChannelJoining called with payload:`,
      JSON.stringify(payload, null, 2)
    );

    if (!channelId) {
      this.sendErrorResponse(socket, `channelId is required for joining.`);
      return;
    }

    const validChannelId = validateUuid(channelId);
    if (!validChannelId) {
      this.sendErrorResponse(socket, `Invalid channelId format.`);
      return;
    }

    // Authorization: Check if user can access this channel
    const authResult = await this.checkChannelAuthorization(socket, validChannelId);
    if (!authResult.authorized) {
      logger.warn(`[SocketIO] User ${socket.userId || 'unauthenticated'} denied access to channel ${channelId}`);
      this.sendErrorResponse(socket, authResult.error || 'Access denied to this channel');
      socket.emit('channel_join_denied', {
        channelId,
        error: authResult.error || 'Access denied',
      });
      return;
    }

    if (agentId) {
      const agentUuid = validateUuid(agentId);
      if (agentUuid) {
        this.connections.set(socket.id, agentUuid);
        logger.info(`[SocketIO] Socket ${socket.id} associated with agent ${agentUuid}`);
      }
    }

    socket.join(channelId);
    logger.info(`[SocketIO] Socket ${socket.id} (user: ${socket.userId || 'unauthenticated'}) joined Socket.IO channel: ${channelId}`);

    // Emit ENTITY_JOINED event for bootstrap plugin to handle world/entity creation
    if (entityId && (serverId || DEFAULT_SERVER_ID)) {
      const finalServerId = serverId || DEFAULT_SERVER_ID;
      const isDm = metadata?.isDm || metadata?.channelType === ChannelType.DM;

      logger.info(
        `[SocketIO] Emitting ENTITY_JOINED event for entityId: ${entityId}, serverId: ${finalServerId}, isDm: ${isDm}`
      );

      // Get the first available runtime (there should typically be one)
      const runtime = this.elizaOS.getAgents()[0];
      if (runtime) {
        runtime.emitEvent(EventType.ENTITY_JOINED as any, {
          entityId: entityId as UUID,
          runtime,
          worldId: finalServerId, // Use serverId as worldId identifier
          roomId: channelId as UUID,
          metadata: {
            type: isDm ? ChannelType.DM : ChannelType.GROUP,
            isDm,
            ...metadata,
          },
          source: 'socketio',
        });

        logger.info(`[SocketIO] ENTITY_JOINED event emitted successfully for ${entityId}`);
      } else {
        logger.warn(`[SocketIO] No runtime available to emit ENTITY_JOINED event`);
      }
    } else {
      logger.debug(
        `[SocketIO] Missing entityId (${entityId}) or serverId (${serverId || DEFAULT_SERVER_ID}) - not emitting ENTITY_JOINED event`
      );
    }

    const successMessage = `Socket ${socket.id} successfully joined channel ${channelId}.`;
    const responsePayload = {
      message: successMessage,
      channelId,
      roomId: channelId, // Keep for backward compatibility
      ...(agentId && { agentId: validateUuid(agentId) || agentId }),
    };
    socket.emit('channel_joined', responsePayload);
    socket.emit('room_joined', responsePayload); // Keep for backward compatibility
    logger.info(`[SocketIO] ${successMessage}`);
  }

  private async handleMessageSubmission(socket: AuthenticatedSocket, payload: any) {
    const channelId = payload.channelId || payload.roomId; // Support both for backward compatibility
    const { senderId, senderName, message, serverId, source, metadata, attachments } = payload;

    logger.info(
      `[SocketIO ${socket.id}] Received SEND_MESSAGE for central submission: channel ${channelId} from ${senderName || senderId}`
    );
    logger.info(
      `[SocketIO ${socket.id}] Full payload for debugging:`,
      JSON.stringify(payload, null, 2)
    );

    // Special handling for default server ID "0"
    const isValidServerId = serverId === DEFAULT_SERVER_ID || validateUuid(serverId);

    if (!validateUuid(channelId) || !isValidServerId || !validateUuid(senderId) || !message) {
      this.sendErrorResponse(
        socket,
        `For SEND_MESSAGE: channelId, serverId (server_id), senderId (author_id), and message are required.`
      );
      return;
    }

    // Authorization: Verify the authenticated user matches the senderId
    // This prevents impersonation attacks where someone sends messages as another user
    if (socket.userId && socket.userId !== senderId) {
      logger.warn(
        `[SocketIO ${socket.id}] User ${socket.userId} attempted to send message as ${senderId} - impersonation blocked`
      );
      this.sendErrorResponse(socket, 'Cannot send messages as another user');
      return;
    }

    // Authorization: Check if user can send to this channel
    const validChannelId = validateUuid(channelId);
    if (validChannelId) {
      const authResult = await this.checkChannelAuthorization(socket, validChannelId);
      if (!authResult.authorized) {
        logger.warn(`[SocketIO ${socket.id}] User ${socket.userId || senderId} denied sending to channel ${channelId}`);
        this.sendErrorResponse(socket, authResult.error || 'Not authorized to send to this channel');
        return;
      }
    }

    try {
      // Check if this is a DM channel and emit ENTITY_JOINED for proper world setup
      const isDmForWorldSetup = metadata?.isDm || metadata?.channelType === ChannelType.DM;
      if (isDmForWorldSetup && senderId) {
        logger.info(
          `[SocketIO] Detected DM channel during message submission, emitting ENTITY_JOINED for proper world setup`
        );

        const runtime = this.elizaOS.getAgents()[0];
        if (runtime) {
          runtime.emitEvent(EventType.ENTITY_JOINED as any, {
            entityId: senderId as UUID,
            runtime,
            worldId: serverId, // Use serverId as worldId identifier
            roomId: channelId as UUID,
            metadata: {
              type: ChannelType.DM,
              isDm: true,
              ...metadata,
            },
            source: 'socketio_message',
          });

          logger.info(`[SocketIO] ENTITY_JOINED event emitted for DM channel setup: ${senderId}`);
        }
      }

      // Ensure the channel exists before creating the message
      logger.info(
        `[SocketIO ${socket.id}] Checking if channel ${channelId} exists before creating message`
      );
      let channelExists = false;
      try {
        const existingChannel = await this.serverInstance.getChannelDetails(channelId as UUID);
        channelExists = !!existingChannel;
        logger.info(`[SocketIO ${socket.id}] Channel ${channelId} exists: ${channelExists}`);
      } catch (error: any) {
        logger.info(
          `[SocketIO ${socket.id}] Channel ${channelId} does not exist, will create it. Error: ${error.message}`
        );
      }

      if (!channelExists) {
        // Auto-create the channel if it doesn't exist
        logger.info(
          `[SocketIO ${socket.id}] Auto-creating channel ${channelId} with serverId ${serverId}`
        );
        try {
          // First verify the server exists
          const servers = await this.serverInstance.getServers();
          const serverExists = servers.some((s) => s.id === serverId);
          logger.info(
            `[SocketIO ${socket.id}] Server ${serverId} exists: ${serverExists}. Available servers: ${servers.map((s) => s.id).join(', ')}`
          );

          if (!serverExists) {
            logger.error(
              `[SocketIO ${socket.id}] Server ${serverId} does not exist, cannot create channel`
            );
            this.sendErrorResponse(socket, `Server ${serverId} does not exist`);
            return;
          }

          // Determine if this is likely a DM based on the context
          const isDmChannel = metadata?.isDm || metadata?.channelType === ChannelType.DM;

          const channelData = {
            id: channelId as UUID, // Use the specific channel ID from the client
            messageServerId: serverId as UUID,
            name: isDmChannel
              ? `DM ${channelId.substring(0, 8)}`
              : `Chat ${channelId.substring(0, 8)}`,
            type: isDmChannel ? ChannelType.DM : ChannelType.GROUP,
            sourceType: 'auto_created',
            metadata: {
              created_by: 'socketio_auto_creation',
              created_for_user: senderId,
              created_at: new Date().toISOString(),
              channel_type: isDmChannel ? ChannelType.DM : ChannelType.GROUP,
              ...metadata,
            },
          };

          logger.info(
            `[SocketIO ${socket.id}] Creating channel with data:`,
            JSON.stringify(channelData, null, 2)
          );

          // For DM channels, we need to determine the participants
          let participants = [senderId as UUID];
          if (isDmChannel) {
            // Try to extract the other participant from metadata or payload
            const otherParticipant =
              metadata?.targetUserId || metadata?.recipientId || payload.targetUserId;
            if (otherParticipant && validateUuid(otherParticipant)) {
              participants.push(otherParticipant as UUID);
              logger.info(
                `[SocketIO ${socket.id}] DM channel will include participants: ${participants.join(', ')}`
              );
            } else {
              logger.warn(
                `[SocketIO ${socket.id}] DM channel missing second participant, only adding sender: ${senderId}`
              );
            }
          }

          await this.serverInstance.createChannel(channelData, participants);
          logger.info(
            `[SocketIO ${socket.id}] Auto-created ${isDmChannel ? ChannelType.DM : ChannelType.GROUP} channel ${channelId} for message submission with ${participants.length} participants`
          );
        } catch (createError: any) {
          logger.error(
            `[SocketIO ${socket.id}] Failed to auto-create channel ${channelId}:`,
            createError
          );
          this.sendErrorResponse(socket, `Failed to create channel: ${createError.message}`);
          return;
        }
      } else {
        logger.info(
          `[SocketIO ${socket.id}] Channel ${channelId} already exists, proceeding with message creation`
        );
      }

      const newRootMessageData = {
        channelId: channelId as UUID,
        authorId: senderId as UUID,
        content: message as string,
        rawMessage: payload,
        metadata: {
          ...(metadata || {}),
          user_display_name: senderName,
          socket_id: socket.id,
          serverId: serverId as UUID,
          attachments,
        },
        sourceType: source || 'socketio_client',
      };

      const createdRootMessage = await this.serverInstance.createMessage(newRootMessageData);

      logger.info(
        `[SocketIO ${socket.id}] Message from ${senderId} (msgId: ${payload.messageId || 'N/A'}) submitted to central store (central ID: ${createdRootMessage.id}). It will be processed by agents and broadcasted upon their reply.`
      );

      // Transform attachments for web client
      const transformedAttachments = attachmentsToApiUrls(attachments);

      // Immediately broadcast the message to all clients in the channel
      const messageBroadcast = {
        id: createdRootMessage.id,
        senderId: senderId,
        senderName: senderName || 'User',
        text: message,
        channelId: channelId,
        roomId: channelId, // Keep for backward compatibility
        serverId: serverId, // Use serverId at message server layer
        createdAt: new Date(createdRootMessage.createdAt).getTime(),
        source: source || 'socketio_client',
        attachments: transformedAttachments,
      };

      // Broadcast to everyone in the channel except the sender
      socket.to(channelId).emit('messageBroadcast', messageBroadcast);

      // Also send back to the sender with the server-assigned ID
      socket.emit('messageBroadcast', {
        ...messageBroadcast,
        clientMessageId: payload.messageId,
      });

      socket.emit('messageAck', {
        clientMessageId: payload.messageId,
        messageId: createdRootMessage.id,
        status: 'received_by_server_and_processing',
        channelId,
        roomId: channelId, // Keep for backward compatibility
      });
    } catch (error: any) {
      logger.error(
        `[SocketIO ${socket.id}] Error during central submission for message: ${error.message}`,
        error
      );
      this.sendErrorResponse(socket, `[SocketIO] Error processing your message: ${error.message}`);
    }
  }

  private sendErrorResponse(socket: Socket, errorMessage: string) {
    logger.error(`[SocketIO ${socket.id}] Sending error to client: ${errorMessage}`);
    socket.emit('messageError', {
      error: errorMessage,
    });
  }

  private handleLogSubscription(socket: Socket) {
    this.logStreamConnections.set(socket.id, {});
    logger.info(`[SocketIO ${socket.id}] Client subscribed to log stream`);
    socket.emit('log_subscription_confirmed', {
      subscribed: true,
      message: 'Successfully subscribed to log stream',
    });
  }

  private handleLogUnsubscription(socket: Socket) {
    this.logStreamConnections.delete(socket.id);
    logger.info(`[SocketIO ${socket.id}] Client unsubscribed from log stream`);
    socket.emit('log_subscription_confirmed', {
      subscribed: false,
      message: 'Successfully unsubscribed from log stream',
    });
  }

  private handleLogFilterUpdate(socket: Socket, filters: { agentName?: string; level?: string }) {
    const existingFilters = this.logStreamConnections.get(socket.id);
    if (existingFilters !== undefined) {
      this.logStreamConnections.set(socket.id, { ...existingFilters, ...filters });
      logger.info(`[SocketIO ${socket.id}] Updated log filters:`, JSON.stringify(filters));
      socket.emit('log_filters_updated', {
        success: true,
        filters: this.logStreamConnections.get(socket.id),
      });
    } else {
      logger.warn(`[SocketIO ${socket.id}] Cannot update filters: not subscribed to log stream`);
      socket.emit('log_filters_updated', {
        success: false,
        error: 'Not subscribed to log stream',
      });
    }
  }

  public broadcastLog(io: SocketIOServer, logEntry: any) {
    if (this.logStreamConnections.size === 0) return;
    const logData = { type: 'log_entry', payload: logEntry };
    this.logStreamConnections.forEach((filters, socketId) => {
      const socket = io.sockets.sockets.get(socketId);
      if (socket) {
        let shouldBroadcast = true;
        if (filters.agentName && filters.agentName !== 'all') {
          shouldBroadcast = shouldBroadcast && logEntry.agentName === filters.agentName;
        }
        if (filters.level && filters.level !== 'all') {
          // Use logger levels directly from @elizaos/core
          const numericLevel =
            typeof filters.level === 'string'
              ? customLevels[filters.level.toLowerCase()] || 70
              : filters.level;
          shouldBroadcast = shouldBroadcast && logEntry.level >= numericLevel;
        }
        if (shouldBroadcast) {
          socket.emit('log_stream', logData);
        }
      }
    });
  }

  private handleDisconnect(socket: AuthenticatedSocket) {
    const agentIdAssociated = this.connections.get(socket.id);
    this.connections.delete(socket.id);
    this.logStreamConnections.delete(socket.id);
    
    const userInfo = socket.userId ? ` (user: ${socket.username || socket.userId.substring(0, 8)})` : '';
    const agentInfo = agentIdAssociated ? ` (agent: ${agentIdAssociated})` : '';
    
    logger.info(`[SocketIO] Client ${socket.id}${userInfo}${agentInfo} disconnected.`);
  }
}
