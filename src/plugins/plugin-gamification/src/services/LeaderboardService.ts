import {
  logger,
  Service,
  type IAgentRuntime,
  type UUID,
} from '@elizaos/core';
import { and, desc, eq, gt, isNull, or } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { leaderboardSnapshotsTable, pointBalancesTable } from '../schema';

interface RuntimeWithDb {
  db?: PgDatabase<PgQueryResultHKT>;
}

/**
 * LeaderboardService - Read-only service for leaderboard queries
 * 
 * SCHEDULING: Aggregation and weekly resets are handled by pg_cron jobs.
 * See: migrations/001_pg_cron_setup.sql
 * 
 * This service provides:
 * - Reading from pre-aggregated leaderboard snapshots (fast)
 * - Manual aggregation methods for testing/one-off runs
 */
export class LeaderboardService extends Service {
  static serviceType = 'leaderboard-sync';
  capabilityDescription = 'Reads leaderboard snapshots aggregated by pg_cron';

  private getDb(): PgDatabase<PgQueryResultHKT> | undefined {
    return (this.runtime as unknown as RuntimeWithDb).db;
  }

  /**
   * Check if a userId belongs to an agent (not a human user)
   */
  private isAgent(userId: UUID): boolean {
    return userId === this.runtime.agentId || userId === this.runtime.character.id;
  }

  static async start(runtime: IAgentRuntime): Promise<LeaderboardService> {
    const service = new LeaderboardService(runtime);
    
    // Mark agent user IDs in the database so pg_cron jobs can filter them
    await service.markAgentUserIds();
    
    logger.info('[LeaderboardService] Initialized (pg_cron handles scheduling)');
    return service;
  }

  /**
   * Mark agent user IDs in point_balances table with is_agent=TRUE
   * This ensures pg_cron jobs correctly filter out agent accounts from leaderboards
   */
  private async markAgentUserIds(): Promise<void> {
    const db = this.getDb();
    if (!db) return;

    const agentIds = [
      this.runtime.agentId,
      this.runtime.character.id,
    ].filter((id): id is UUID => !!id);

    // Remove duplicates
    const uniqueAgentIds = [...new Set(agentIds)];
    
    for (const agentId of uniqueAgentIds) {
      try {
        // Upsert: create with is_agent=TRUE or update existing to is_agent=TRUE
        await db
          .insert(pointBalancesTable)
          .values({
            userId: agentId,
            allTimePoints: 0,
            weeklyPoints: 0,
            streakDays: 0,
            level: 0,
            isAgent: true,
          })
          .onConflictDoUpdate({
            target: pointBalancesTable.userId,
            set: {
              isAgent: true,
              updatedAt: new Date(),
            },
          });
        logger.debug(`[LeaderboardService] Marked agent ${agentId} as is_agent=TRUE`);
      } catch (err) {
        logger.warn(`[LeaderboardService] Failed to mark agent ${agentId}: ${err}`);
      }
    }
  }

  /**
   * Get cached leaderboard from snapshots (fast - reads from pre-aggregated table)
   */
  async getCachedLeaderboard(scope: 'weekly' | 'all_time', limit = 100): Promise<Array<{
    rank: number;
    userId: string;
    points: number;
  }>> {
    const db = this.getDb();
    if (!db) {
      logger.error('[LeaderboardService] Database not available');
      return [];
    }

    const snapshots = await db
      .select({
        rank: leaderboardSnapshotsTable.rank,
        userId: leaderboardSnapshotsTable.userId,
        points: leaderboardSnapshotsTable.points,
      })
      .from(leaderboardSnapshotsTable)
      .where(eq(leaderboardSnapshotsTable.scope, scope))
      .orderBy(leaderboardSnapshotsTable.rank)
      .limit(limit);

    return snapshots.map(s => ({
      rank: s.rank,
      userId: s.userId,
      points: s.points,
    }));
  }

  /**
   * Get last snapshot timestamp
   */
  async getLastSnapshotTime(scope: 'weekly' | 'all_time'): Promise<Date | null> {
    const db = this.getDb();
    if (!db) return null;

    const [result] = await db
      .select({ snapshotAt: leaderboardSnapshotsTable.snapshotAt })
      .from(leaderboardSnapshotsTable)
      .where(eq(leaderboardSnapshotsTable.scope, scope))
      .orderBy(desc(leaderboardSnapshotsTable.snapshotAt))
      .limit(1);

    return result?.snapshotAt || null;
  }

  /**
   * Manual aggregation - useful for testing or one-off runs
   * In production, pg_cron handles this every 5 minutes
   * 
   * Uses same filtering as pg_cron: is_agent = FALSE OR is_agent IS NULL
   */
  async aggregateSnapshots(): Promise<void> {
    const db = this.getDb();
    if (!db) {
      logger.error('[LeaderboardService] Database not available');
      return;
    }

    try {
      // Filter: exclude agents (is_agent = FALSE OR is_agent IS NULL) - matches pg_cron behavior
      const notAgentFilter = or(
        eq(pointBalancesTable.isAgent, false),
        isNull(pointBalancesTable.isAgent)
      );

      // Aggregate all-time leaderboard (excluding agents, points > 0)
      const allTimeBalances = await db
        .select({
          userId: pointBalancesTable.userId,
          points: pointBalancesTable.allTimePoints,
        })
        .from(pointBalancesTable)
        .where(and(gt(pointBalancesTable.allTimePoints, 0), notAgentFilter))
        .orderBy(desc(pointBalancesTable.allTimePoints))
        .limit(100);

      // Aggregate weekly leaderboard (excluding agents, points > 0)
      const weeklyBalances = await db
        .select({
          userId: pointBalancesTable.userId,
          points: pointBalancesTable.weeklyPoints,
        })
        .from(pointBalancesTable)
        .where(and(gt(pointBalancesTable.weeklyPoints, 0), notAgentFilter))
        .orderBy(desc(pointBalancesTable.weeklyPoints))
        .limit(100);

      // Prepare batch inserts
      const allTimeSnapshots = allTimeBalances.map((balance, i) => ({
        scope: 'all_time' as const,
        rank: i + 1,
        userId: balance.userId,
        points: balance.points,
      }));

      const weeklySnapshots = weeklyBalances.map((balance, i) => ({
        scope: 'weekly' as const,
        rank: i + 1,
        userId: balance.userId,
        points: balance.points,
      }));

      // Use transaction for atomicity
      await db.transaction(async (tx) => {
        await tx.delete(leaderboardSnapshotsTable).where(eq(leaderboardSnapshotsTable.scope, 'all_time'));
        await tx.delete(leaderboardSnapshotsTable).where(eq(leaderboardSnapshotsTable.scope, 'weekly'));

        if (allTimeSnapshots.length > 0) {
          await tx.insert(leaderboardSnapshotsTable).values(allTimeSnapshots);
        }
        if (weeklySnapshots.length > 0) {
          await tx.insert(leaderboardSnapshotsTable).values(weeklySnapshots);
        }
      });

      logger.debug('[LeaderboardService] Manual snapshot aggregation completed');
    } catch (error) {
      logger.error({ error }, '[LeaderboardService] Error in aggregateSnapshots');
      throw error;
    }
  }

  /**
   * Manual weekly reset - useful for testing
   * In production, pg_cron handles this every Monday at 00:00 UTC
   * Note: Mirrors the cron job behavior (updates updatedAt)
   */
  async resetWeeklyPoints(): Promise<void> {
    const db = this.getDb();
    if (!db) {
      logger.error('[LeaderboardService] Database not available');
      return;
    }

    await db
      .update(pointBalancesTable)
      .set({ 
        weeklyPoints: 0,
        updatedAt: new Date(),
      });

    logger.info('[LeaderboardService] Manual weekly points reset completed');
  }

  async stop(): Promise<void> {
    logger.info('[LeaderboardService] Stopped');
  }
}
