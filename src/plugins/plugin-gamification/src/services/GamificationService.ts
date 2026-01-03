import {
  Service,
  type IAgentRuntime,
  type UUID,
  logger,
} from '@elizaos/core';
import { eq, and, gte, desc, sql } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import {
  gamificationEventsTable,
  pointBalancesTable,
  userChainHistoryTable,
  gamificationCampaignsTable,
} from '../schema';
import {
  GamificationEventType,
  BASE_POINTS,
  DAILY_CAPS,
  VOLUME_MULTIPLIERS,
  LEVEL_THRESHOLDS,
  STREAK_BONUS_PER_DAY,
  MAX_STREAK_BONUS,
} from '../constants';
import type {
  GamificationEventInput,
  PointBalance,
  UserSummary,
  LeaderboardEntry,
} from '../types';

interface RuntimeWithDb {
  db?: PgDatabase<PgQueryResultHKT>;
}

export class GamificationService extends Service {
  static serviceType = 'gamification';
  capabilityDescription = 'Records points for user actions and provides gamification state';

  private getDb(): PgDatabase<PgQueryResultHKT> | undefined {
    return (this.runtime as unknown as RuntimeWithDb).db;
  }

  /**
   * Check if a userId belongs to an agent (not a human user)
   */
  private isAgent(userId: UUID): boolean {
    // Check if userId matches the agent's ID or character ID
    return userId === this.runtime.agentId || userId === this.runtime.character.id;
  }

  static async start(runtime: IAgentRuntime): Promise<GamificationService> {
    const service = new GamificationService(runtime);
    logger.info('[GamificationService] Initialized');
    return service;
  }

  async recordEvent(event: GamificationEventInput): Promise<PointBalance | null> {
    const db = this.getDb();
    if (!db) {
      logger.error('[GamificationService] Database not available');
      return null;
    }

    // Never award points to agents
    if (this.isAgent(event.userId)) {
      logger.debug(`[GamificationService] Skipping points for agent userId: ${event.userId}`);
      return null;
    }

    try {
      if (!(await this.enforceRateLimits(event.userId, event.actionType, event.metadata))) {
        return null;
      }

      const points = await this.calculatePoints(event);
      if (points <= 0) return null;

      const finalPoints = await this.applyActiveCampaigns(event.actionType, points);

      // Validate metadata size to prevent DB bloat (max 10KB)
      const metadataSize = JSON.stringify(event.metadata || {}).length;
      if (metadataSize > 10240) {
        logger.warn(`[GamificationService] Metadata too large (${metadataSize} bytes), truncating`);
        event.metadata = { ...event.metadata, _truncated: true };
      }

      // Use transaction to ensure atomicity
      let balance: PointBalance;
      try {
        // Start transaction (if supported by adapter)
        await db.insert(gamificationEventsTable).values({
          userId: event.userId,
          actionType: event.actionType,
          points: finalPoints,
          metadata: event.metadata || {},
          sourceEventId: event.sourceEventId,
        });

        balance = await this.updateBalance(event.userId, finalPoints, event.actionType);
      } catch (error) {
        logger.error({ error }, '[GamificationService] Error in transaction, rolling back');
        throw error;
      }

      if (event.chain && event.actionType === GamificationEventType.BRIDGE_COMPLETED) {
        await this.checkFirstChainBonus(event.userId, event.chain);
      }

      await this.emitPointsAwarded(event.userId, {
        actionType: event.actionType,
        points: finalPoints,
        total: balance.allTimePoints,
        streak: balance.streakDays,
        level: balance.level,
      });

      return balance;
    } catch (error) {
      logger.error({ error }, '[GamificationService] Error recording event');
      return null;
    }
  }

  async getUserSummary(userId: UUID): Promise<UserSummary> {
    const db = this.getDb();
    if (!db) throw new Error('Database not available');

    // Agents should never have a summary (return empty summary)
    if (this.isAgent(userId)) {
      return {
        userId,
        allTimePoints: 0,
        weeklyPoints: 0,
        streakDays: 0,
        level: 0,
        levelName: 'Explorer',
        lastLoginDate: null,
        swapsCompleted: 0,
      };
    }

    const [balance] = await db
      .select()
      .from(pointBalancesTable)
      .where(eq(pointBalancesTable.userId, userId))
      .limit(1);

    // Count swaps completed
    const [swapCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(gamificationEventsTable)
      .where(
        and(
          eq(gamificationEventsTable.userId, userId),
          eq(gamificationEventsTable.actionType, GamificationEventType.SWAP_COMPLETED)
        )
      );

    if (!balance) {
      return {
        userId,
        allTimePoints: 0,
        weeklyPoints: 0,
        streakDays: 0,
        level: 0,
        levelName: 'Explorer',
        lastLoginDate: null,
        swapsCompleted: Number(swapCount?.count || 0),
      };
    }

    const levelInfo = this.getLevelInfo(balance.allTimePoints);
    return {
      userId,
      allTimePoints: balance.allTimePoints,
      weeklyPoints: balance.weeklyPoints,
      streakDays: balance.streakDays,
      level: levelInfo.level,
      levelName: levelInfo.name,
      nextMilestone: this.getNextMilestone(balance.allTimePoints),
      lastLoginDate: balance.lastLoginDate,
      swapsCompleted: Number(swapCount?.count || 0),
    };
  }

  async getLeaderboard(scope: 'weekly' | 'all_time', limit = 50): Promise<LeaderboardEntry[]> {
    const db = this.getDb();
    if (!db) throw new Error('Database not available');

    const pointsColumn = scope === 'weekly'
      ? pointBalancesTable.weeklyPoints
      : pointBalancesTable.allTimePoints;

    // Get all balances, then filter out agents
    const allBalances = await db
      .select({
        userId: pointBalancesTable.userId,
        points: pointsColumn,
        level: pointBalancesTable.level,
      })
      .from(pointBalancesTable)
      .where(gte(pointsColumn, 0))
      .orderBy(desc(pointsColumn));

    // Filter out agents and limit results
    const balances = allBalances
      .filter((balance) => !this.isAgent(balance.userId as UUID))
      .slice(0, limit);

    // Batch fetch entity data for display names and avatars (avoids N+1 queries)
    const userIds = balances.map((b) => b.userId as UUID);
    const entityMap = new Map<UUID, { displayName?: string; avatarUrl?: string }>();
    
    // Fetch all entities in parallel (single batch)
    const entityPromises = userIds.map(async (userId) => {
      try {
        const entity = await this.runtime.getEntityById(userId);
        if (entity) {
          entityMap.set(userId, {
            displayName: (entity.metadata?.displayName as string) || (entity.names?.[0] as string),
            // Check both 'avatar' and 'avatarUrl' for backwards compatibility
            avatarUrl: (entity.metadata?.avatar as string) || (entity.metadata?.avatarUrl as string) || undefined,
          });
        }
      } catch (error) {
        // Entity not found or error fetching - use fallback
        logger.debug({ userId, error }, '[GamificationService] Could not fetch entity for leaderboard entry');
      }
    });
    
    await Promise.all(entityPromises);

    // Build leaderboard entries using pre-fetched entity data
    const entries = balances.map((balance, index: number) => {
      const balanceUserId = balance.userId as UUID;
      const levelInfo = this.getLevelInfo(balance.points);
      const entityData = entityMap.get(balanceUserId);

      return {
        rank: index + 1,
        userId: balanceUserId,
        points: balance.points,
        level: levelInfo.level,
        levelName: levelInfo.name,
        username: entityData?.displayName,
        avatar: entityData?.avatarUrl,
      };
    });

    return entries;
  }

  async getUserRank(userId: UUID, scope: 'weekly' | 'all_time'): Promise<number> {
    const db = this.getDb();
    if (!db) throw new Error('Database not available');

    // Agents should never have a rank
    if (this.isAgent(userId)) {
      return 0;
    }

    const pointsColumn = scope === 'weekly'
      ? pointBalancesTable.weeklyPoints
      : pointBalancesTable.allTimePoints;

    const [userBalance] = await db
      .select({ points: pointsColumn })
      .from(pointBalancesTable)
      .where(eq(pointBalancesTable.userId, userId))
      .limit(1);

    if (!userBalance || userBalance.points === 0) return 0;

    // Count users with equal or higher points, excluding agents
    const allBalances = await db
      .select({ userId: pointBalancesTable.userId, points: pointsColumn })
      .from(pointBalancesTable)
      .where(gte(pointsColumn, userBalance.points));

    // Filter out agents and count
    const rank = allBalances.filter((balance) => !this.isAgent(balance.userId as UUID)).length;

    return rank;
  }

  private async enforceRateLimits(userId: UUID, actionType: GamificationEventType, metadata?: Record<string, any>): Promise<boolean> {
    const db = this.getDb();
    if (!db) return false;

    // One-time only events (awarded once ever per user)
    const oneTimeEvents = [
      GamificationEventType.ACCOUNT_CREATION,
      GamificationEventType.REFERRED_WELCOME,
    ];
    
    if (oneTimeEvents.includes(actionType)) {
      const existingEvents = await db
        .select({ count: sql<number>`count(*)` })
        .from(gamificationEventsTable)
        .where(
          and(
            eq(gamificationEventsTable.userId, userId),
            eq(gamificationEventsTable.actionType, actionType)
          )
        );
      return (existingEvents[0]?.count || 0) === 0;
    }

    // REFERRAL_SIGNUP should be once per referral relationship (check metadata.referredUserId)
    if (actionType === GamificationEventType.REFERRAL_SIGNUP && metadata?.referredUserId) {
      const existingEvents = await db
        .select()
        .from(gamificationEventsTable)
        .where(
          and(
            eq(gamificationEventsTable.userId, userId),
            eq(gamificationEventsTable.actionType, actionType)
          )
        );
      // Check if this referredUserId already exists in metadata
      const alreadyAwarded = existingEvents.some((event: any) => 
        event.metadata?.referredUserId === metadata.referredUserId
      );
      return !alreadyAwarded;
    }

    // REFERRAL_ACTIVATION should be once per referral relationship (check metadata.activatedUserId)
    if (actionType === GamificationEventType.REFERRAL_ACTIVATION && metadata?.activatedUserId) {
      const existingEvents = await db
        .select()
        .from(gamificationEventsTable)
        .where(
          and(
            eq(gamificationEventsTable.userId, userId),
            eq(gamificationEventsTable.actionType, actionType)
          )
        );
      // Check if this activatedUserId already exists in metadata
      const alreadyAwarded = existingEvents.some((event: any) => 
        event.metadata?.activatedUserId === metadata.activatedUserId
      );
      return !alreadyAwarded;
    }

    // DAILY_QUEST should be once per day
    if (actionType === GamificationEventType.DAILY_QUEST) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayEvents = await db
        .select({ count: sql<number>`count(*)` })
        .from(gamificationEventsTable)
        .where(
          and(
            eq(gamificationEventsTable.userId, userId),
            eq(gamificationEventsTable.actionType, actionType),
            gte(gamificationEventsTable.createdAt, today)
          )
        );
      return (todayEvents[0]?.count || 0) === 0;
    }

    const cap = DAILY_CAPS[actionType];
    if (!cap || cap === Infinity) return true;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todayEvents = await db
      .select({ count: sql<number>`count(*)` })
      .from(gamificationEventsTable)
      .where(
        and(
          eq(gamificationEventsTable.userId, userId),
          eq(gamificationEventsTable.actionType, actionType),
          gte(gamificationEventsTable.createdAt, today)
        )
      );

    return (todayEvents[0]?.count || 0) < cap;
  }

  private async calculatePoints(event: GamificationEventInput): Promise<number> {
    // For MEANINGFUL_CHAT, use tier-based points from metadata
    if (event.actionType === GamificationEventType.MEANINGFUL_CHAT && event.metadata?.tier) {
      return event.metadata.tier as number;
    }

    const basePoints = BASE_POINTS[event.actionType];
    if (!basePoints) return 0;

    if (event.volumeUsd && event.volumeUsd > 0) {
      if (event.actionType === GamificationEventType.SWAP_COMPLETED) {
        const bonus = Math.min(
          Math.floor(event.volumeUsd * VOLUME_MULTIPLIERS.SWAP.perDollar),
          VOLUME_MULTIPLIERS.SWAP.cap
        );
        return basePoints + bonus;
      }
      if (event.actionType === GamificationEventType.BRIDGE_COMPLETED) {
        const bonus = Math.min(
          Math.floor(event.volumeUsd * VOLUME_MULTIPLIERS.BRIDGE.perDollar),
          VOLUME_MULTIPLIERS.BRIDGE.cap
        );
        return basePoints + bonus;
      }
    }

    if (event.actionType === GamificationEventType.DAILY_LOGIN_STREAK) {
      const balance = await this.getBalance(event.userId);
      const streakBonus = Math.min(
        balance.streakDays * STREAK_BONUS_PER_DAY,
        MAX_STREAK_BONUS
      );
      return basePoints + streakBonus;
    }

    return basePoints;
  }

  private async applyActiveCampaigns(actionType: GamificationEventType, basePoints: number): Promise<number> {
    const db = this.getDb();
    if (!db) return basePoints;

    const now = new Date();
    const [campaign] = await db
      .select()
      .from(gamificationCampaignsTable)
      .where(
        and(
          eq(gamificationCampaignsTable.active, true),
          sql`${gamificationCampaignsTable.startAt} <= ${now}`,
          sql`${gamificationCampaignsTable.endAt} >= ${now}`,
          sql`(${gamificationCampaignsTable.actionType} IS NULL OR ${gamificationCampaignsTable.actionType} = ${actionType})`
        )
      )
      .limit(1);

    if (campaign) {
      return Math.floor(basePoints * (campaign.multiplier / 100));
    }

    return basePoints;
  }

  private async updateBalance(userId: UUID, points: number, actionType: GamificationEventType): Promise<PointBalance> {
    const db = this.getDb();
    if (!db) throw new Error('Database not available');

    const balance = await this.getBalance(userId);
    const isWeeklyReset = actionType === GamificationEventType.DAILY_LOGIN_STREAK;

    let newStreakDays = balance.streakDays;
    if (actionType === GamificationEventType.DAILY_LOGIN_STREAK) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const lastLogin = balance.lastLoginDate ? new Date(balance.lastLoginDate) : null;

      if (!lastLogin || lastLogin < today) {
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);

        if (lastLogin && lastLogin.getTime() === yesterday.getTime()) {
          newStreakDays = balance.streakDays + 1;
        } else {
          newStreakDays = 1;
        }
      }
    }

    const allTimePoints = balance.allTimePoints + points;
    const weeklyPoints = isWeeklyReset ? points : balance.weeklyPoints + points;
    const levelInfo = this.getLevelInfo(allTimePoints);

    const [updated] = await db
      .insert(pointBalancesTable)
      .values({
        userId,
        allTimePoints,
        weeklyPoints,
        streakDays: newStreakDays,
        lastLoginDate: actionType === GamificationEventType.DAILY_LOGIN_STREAK ? new Date() : balance.lastLoginDate,
        level: levelInfo.level,
      })
      .onConflictDoUpdate({
        target: pointBalancesTable.userId,
        set: {
          allTimePoints,
          weeklyPoints,
          streakDays: newStreakDays,
          lastLoginDate: actionType === GamificationEventType.DAILY_LOGIN_STREAK ? new Date() : balance.lastLoginDate,
          level: levelInfo.level,
          updatedAt: new Date(),
        },
      })
      .returning();

    return {
      userId: updated.userId as UUID,
      allTimePoints: updated.allTimePoints,
      weeklyPoints: updated.weeklyPoints,
      streakDays: updated.streakDays,
      lastLoginDate: updated.lastLoginDate,
      level: updated.level,
      levelName: levelInfo.name,
      updatedAt: updated.updatedAt,
    };
  }

  private async getBalance(userId: UUID): Promise<PointBalance> {
    const db = this.getDb();
    if (!db) throw new Error('Database not available');

    const [balance] = await db
      .select()
      .from(pointBalancesTable)
      .where(eq(pointBalancesTable.userId, userId))
      .limit(1);

    if (!balance) {
      return {
        userId,
        allTimePoints: 0,
        weeklyPoints: 0,
        streakDays: 0,
        lastLoginDate: null,
        level: 0,
        levelName: 'Explorer',
        updatedAt: new Date(),
      };
    }

    const levelInfo = this.getLevelInfo(balance.allTimePoints);
    return { ...balance, userId: balance.userId as UUID, levelName: levelInfo.name };
  }

  private async checkFirstChainBonus(userId: UUID, chain: string): Promise<void> {
    const db = this.getDb();
    if (!db) return;

    const [existing] = await db
      .select()
      .from(userChainHistoryTable)
      .where(and(eq(userChainHistoryTable.userId, userId), eq(userChainHistoryTable.chain, chain)))
      .limit(1);

    if (!existing) {
      await db.insert(userChainHistoryTable).values({ userId, chain });
      
      // Award points directly without recursion to avoid infinite loops
      const points = BASE_POINTS[GamificationEventType.FIRST_CHAIN_BONUS];
      await db.insert(gamificationEventsTable).values({
        userId,
        actionType: GamificationEventType.FIRST_CHAIN_BONUS,
        points,
        metadata: { chain },
      });
      
      const balance = await this.updateBalance(userId, points, GamificationEventType.FIRST_CHAIN_BONUS);
      
      await this.emitPointsAwarded(userId, {
        actionType: GamificationEventType.FIRST_CHAIN_BONUS,
        points,
        total: balance.allTimePoints,
        streak: balance.streakDays,
        level: balance.level,
      });
    }
  }

  private getLevelInfo(points: number): { level: number; name: string } {
    for (const threshold of LEVEL_THRESHOLDS) {
      if (points >= threshold.minPoints && points <= threshold.maxPoints) {
        return { level: threshold.level, name: threshold.name };
      }
    }
    return { level: 0, name: 'Explorer' };
  }

  private getNextMilestone(points: number): { level: number; levelName: string; pointsNeeded: number } | undefined {
    for (const threshold of LEVEL_THRESHOLDS) {
      if (points < threshold.minPoints) {
        return {
          level: threshold.level,
          levelName: threshold.name,
          pointsNeeded: threshold.minPoints - points,
        };
      }
    }
    return undefined;
  }

  private async emitPointsAwarded(
    userId: UUID,
    payload: { actionType: GamificationEventType; points: number; total: number; streak: number; level: number }
  ): Promise<void> {
    try {
      const messageBusService = this.runtime.getService('message-bus-service') as any;
      if (messageBusService?.io) {
        messageBusService.io.to(userId).emit('points.awarded', payload);
      }
    } catch (error) {
      logger.error({ error }, '[GamificationService] Error emitting points.awarded event');
    }
  }

  async stop(): Promise<void> {
    logger.info('[GamificationService] Stopped');
  }
}

