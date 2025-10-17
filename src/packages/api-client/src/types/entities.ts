import { UUID } from '@elizaos/core';

export interface Entity {
  id: UUID;
  agentId: UUID;
  names: string[];
  metadata?: Record<string, any>;
}

export interface EntityCreateParams {
  id: UUID;
  agentId: UUID;
  names?: string[];
  metadata?: Record<string, any>;
}

export interface EntityUpdateParams {
  names?: string[];
  metadata?: Record<string, any>;
  agentId?: UUID;
}

