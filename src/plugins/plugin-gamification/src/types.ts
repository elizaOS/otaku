/**
 * TypeScript interfaces for gamification system
 */

import type { UUID } from '@elizaos/core';
import { GamificationEventType } from './constants';

/**
 * Input for recording a gamification event
 */
export interface GamificationEventInput {
  userId: UUID;
  actionType: GamificationEventType;
  metadata?: Record<string, unknown>;
  sourceEventId?: UUID;
  // For volume-based bonuses
  volumeUsd?: number;
  // For chain-specific bonuses
  chain?: string;
}

/**
 * Point balance record
 */
export interface PointBalance {
  userId: UUID;
  allTimePoints: number;
  weeklyPoints: number;
  streakDays: number;
  lastLoginDate: Date | null;
  level: number;
  levelName: string;
  updatedAt: Date;
}

/**
 * User summary with gamification stats
 */
export interface UserSummary {
  userId: UUID;
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
  lastLoginDate: Date | null;
  swapsCompleted?: number;
}

/**
 * Leaderboard entry
 */
export interface LeaderboardEntry {
  rank: number;
  userId: UUID;
  points: number;
  level: number;
  levelName: string;
  // Optional: user metadata
  username?: string;
  avatar?: string;
}

/**
 * Referral code record
 */
export interface ReferralCode {
  userId: UUID;
  code: string;
  referrerId: UUID | null;
  status: 'active' | 'inactive';
  createdAt: Date;
}

/**
 * Referral stats
 */
export interface ReferralStats {
  totalReferrals: number;
  activatedReferrals: number;
  totalPointsEarned: number;
}

/**
 * Campaign configuration
 */
export interface Campaign {
  id: string;
  name: string;
  actionType: GamificationEventType | null; // null = all actions
  multiplier: number; // e.g., 1.25 for +25% bonus
  startAt: Date;
  endAt: Date;
  active: boolean;
}

