import { UUID } from '@elizaos/core';
import { BaseApiClient } from '../lib/base-client';
import { Entity, EntityCreateParams, EntityUpdateParams } from '../types/entities';

export class EntitiesService extends BaseApiClient {
  /**
   * Get entity by ID
   */
  async getEntity(entityId: UUID): Promise<Entity> {
    const response = await this.get<{ entity: Entity }>(`/api/entities/${entityId}`);
    return response.entity;
  }

  /**
   * Create a new entity
   */
  async createEntity(params: EntityCreateParams): Promise<Entity> {
    const response = await this.post<{ entity: Entity }>('/api/entities', params);
    return response.entity;
  }

  /**
   * Update an existing entity
   */
  async updateEntity(entityId: UUID, params: EntityUpdateParams): Promise<Entity> {
    const response = await this.patch<{ entity: Entity }>(`/api/entities/${entityId}`, params);
    return response.entity;
  }

  /**
   * Delete an entity
   * TODO: Uncomment when deleteEntity endpoint is fully implemented
   */
  /*
  async deleteEntity(entityId: UUID): Promise<{ success: boolean }> {
    return this.delete<{ success: boolean }>(`/api/entities/${entityId}`);
  }
  */
}

