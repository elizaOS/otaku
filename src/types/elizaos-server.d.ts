declare module '@elizaos/server' {
  import type { Request, Response, NextFunction, Express } from 'express';
  import type { Server as HTTPServer } from 'http';
  import type { UUID, IAgentRuntime, Character, DatabaseAdapter, Plugin } from '@elizaos/core';
  
  export type ServerMiddleware = (req: Request, res: Response, next: NextFunction) => void;
  
  export interface ServerOptions {
    dataDir?: string;
    middlewares?: ServerMiddleware[];
    postgresUrl?: string;
  }

  export interface MessageChannel {
    id: UUID;
    name: string;
    serverId: UUID;
    type?: string;
    metadata?: Record<string, unknown>;
    createdAt?: Date;
    updatedAt?: Date;
  }

  export interface MessageServer {
    id: UUID;
    name: string;
    sourceType: string;
    metadata?: Record<string, unknown>;
    createdAt?: Date;
    updatedAt?: Date;
  }
  
  export class AgentServer {
    app: Express;
    httpServer: HTTPServer;
    agents: Map<UUID, IAgentRuntime>;
    database: DatabaseAdapter;

    // Lifecycle
    initialize(options: ServerOptions): Promise<void>;
    start(port: number): void;
    stop(): Promise<void>;

    // Agent management
    startAgents(): Promise<void>;
    registerAgent(runtime: IAgentRuntime, character: Character): Promise<void>;
    unregisterAgent(agentId: UUID): Promise<void>;
    getAgent(agentId: UUID): IAgentRuntime | undefined;
    
    // Server/Channel management
    createServer(serverId: UUID, name: string, sourceType: string, metadata?: Record<string, unknown>): Promise<MessageServer>;
    getServer(serverId: UUID): Promise<MessageServer | null>;
    createChannel(channelId: UUID, serverId: UUID, name: string, metadata?: Record<string, unknown>): Promise<MessageChannel>;
    getChannel(channelId: UUID): Promise<MessageChannel | null>;
    getChannelsForServer(serverId: UUID): Promise<MessageChannel[]>;
    
    // Agent-Server association
    addAgentToServer(agentId: UUID, serverId: UUID): Promise<void>;
    removeAgentFromServer(agentId: UUID, serverId: UUID): Promise<void>;
    getAgentsForServer(serverId: UUID): Promise<IAgentRuntime[]>;
    getServersForAgent(agentId: UUID): Promise<MessageServer[]>;

    // Middleware
    registerMiddleware(middleware: ServerMiddleware): void;
  }
}
