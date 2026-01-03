import { UUID } from '@elizaos/core';
import { BaseApiClient } from '../lib/base-client';

/**
 * Leaderboard entry - sanitized, no raw userIds exposed
 */
export interface LeaderboardEntry {
  rank: number;
  points: number;
  level: number;
  levelName: string;
  username: string;
  avatar?: string;
}

export interface LeaderboardResponse {
  scope: 'weekly' | 'all_time';
  entries: LeaderboardEntry[];
  /** Current user's rank (0 if not authenticated or not ranked) */
  userRank: number;
  limit: number;
}

/**
 * User summary - returned for authenticated user only
 * Note: userId is not included as it's implicit from auth
 */
export interface UserSummary {
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

export interface ReferralStats {
  totalReferrals: number;
  activatedReferrals: number;
  totalPointsEarned: number;
}

export interface ReferralCodeResponse {
  code: string;
  stats: ReferralStats;
  referralLink: string;
}

export class GamificationService extends BaseApiClient {
  /**
   * Get leaderboard data (public endpoint)
   * User's rank is automatically included if authenticated via Bearer token
   * 
   * @param agentId Agent ID to route the request to
   * @param scope Leaderboard scope ('weekly' or 'all_time')
   * @param limit Number of entries to return (default: 50, max: 100)
   */
  async getLeaderboard(
    agentId: UUID,
    scope: 'weekly' | 'all_time' = 'weekly',
    limit: number = 50
  ): Promise<LeaderboardResponse> {
    const params: Record<string, string> = {
      scope,
      limit: limit.toString(),
    };

    return this.get<LeaderboardResponse>(
      `/api/agents/${agentId}/plugins/gamification/leaderboard`,
      { params }
    );
  }

  /**
   * Get authenticated user's summary with points, level, streak, and swap count
   * Requires Bearer token authentication
   * 
   * @param agentId Agent ID to route the request to
   */
  async getUserSummary(agentId: UUID): Promise<UserSummary> {
    return this.get<UserSummary>(
      `/api/agents/${agentId}/plugins/gamification/summary`
    );
  }

  /**
   * Get or create referral code for authenticated user
   * Requires Bearer token authentication
   * 
   * @param agentId Agent ID to route the request to
   */
  async getReferralCode(agentId: UUID): Promise<ReferralCodeResponse> {
    return this.get<ReferralCodeResponse>(
      `/api/agents/${agentId}/plugins/gamification/referral`
    );
  }
}
