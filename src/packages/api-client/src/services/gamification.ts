import { UUID } from '@elizaos/core';
import { BaseApiClient } from '../lib/base-client';

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  points: number;
  level: number;
  levelName: string;
  username?: string;
  avatar?: string;
}

export interface LeaderboardResponse {
  scope: 'weekly' | 'all_time';
  entries: LeaderboardEntry[];
  userRank: number;
  limit: number;
}

export interface UserSummary {
  userId: string;
  allTimePoints: number;
  weeklyPoints: number;
  streakDays: number;
  level: number;
  levelName: string;
  nextMilestone?: {
    level: number;
    levelName: string;
    pointsNeeded: number;
  };
  lastLoginDate: string | null;
  swapsCompleted?: number;
}

export class GamificationService extends BaseApiClient {
  /**
   * Get leaderboard data
   * @param agentId Agent ID to route the request to
   * @param scope Leaderboard scope ('weekly' or 'all_time')
   * @param limit Number of entries to return (default: 50)
   * @param userId Optional user ID to get user's rank
   */
  async getLeaderboard(
    agentId: UUID,
    scope: 'weekly' | 'all_time' = 'weekly',
    limit: number = 50,
    userId?: UUID
  ): Promise<LeaderboardResponse> {
    const params: Record<string, string> = {
      scope,
      limit: limit.toString(),
    };
    
    if (userId) {
      params.userId = userId;
    }

    return this.get<LeaderboardResponse>(
      `/api/agents/${agentId}/plugins/gamification/leaderboard`,
      { params }
    );
  }

  /**
   * Get user summary with points, level, streak, and swap count
   * @param agentId Agent ID to route the request to
   * @param userId User ID to get summary for
   */
  async getUserSummary(
    agentId: UUID,
    userId: UUID
  ): Promise<UserSummary> {
    return this.get<UserSummary>(
      `/api/agents/${agentId}/plugins/gamification/summary`,
      { params: { userId } }
    );
  }
}

