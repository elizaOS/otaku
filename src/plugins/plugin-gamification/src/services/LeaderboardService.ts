import {
  logger,
  Service,
  type IAgentRuntime,
} from '@elizaos/core';
import { desc, eq, sql } from 'drizzle-orm';
import { leaderboardSnapshotsTable, pointBalancesTable } from '../schema';

export class LeaderboardService extends Service {
  static serviceType = 'leaderboard-sync';
  capabilityDescription = 'Aggregates leaderboard snapshots and handles weekly resets';

  private snapshotInterval: NodeJS.Timeout | null = null;
  private weeklyResetInterval: NodeJS.Timeout | null = null;
  private readonly SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

  private getDb() {
    return (this.runtime as any).db;
  }

  static async start(runtime: IAgentRuntime): Promise<LeaderboardService> {
    const service = new LeaderboardService(runtime);
    service.startSnapshotWorker();
    service.scheduleWeeklyReset();
    logger.info('[LeaderboardService] Initialized');
    return service;
  }

  /**
   * Start snapshot aggregation worker
   */
  private startSnapshotWorker(): void {
    this.snapshotInterval = setInterval(async () => {
      try {
        await this.aggregateSnapshots();
      } catch (error) {
        logger.error({ error }, '[LeaderboardService] Error aggregating snapshots');
      }
    }, this.SNAPSHOT_INTERVAL_MS);
  }

  /**
   * Aggregate leaderboard snapshots
   */
  private async aggregateSnapshots(): Promise<void> {
    const db = this.getDb();
    if (!db) {
      logger.error('[LeaderboardService] Database not available');
      return;
    }

    // Aggregate all-time leaderboard
    const allTimeBalances = await db
      .select({
        userId: pointBalancesTable.userId,
        points: pointBalancesTable.allTimePoints,
      })
      .from(pointBalancesTable)
      .orderBy(desc(pointBalancesTable.allTimePoints))
      .limit(100);

    // Clear old snapshots
    await db.delete(leaderboardSnapshotsTable).where(eq(leaderboardSnapshotsTable.scope, 'all_time'));

    // Insert new snapshots
    for (let i = 0; i < allTimeBalances.length; i++) {
      await db.insert(leaderboardSnapshotsTable).values({
        scope: 'all_time',
        rank: i + 1,
        userId: allTimeBalances[i].userId,
        points: allTimeBalances[i].points,
      });
    }

    // Aggregate weekly leaderboard
    const weeklyBalances = await db
      .select({
        userId: pointBalancesTable.userId,
        points: pointBalancesTable.weeklyPoints,
      })
      .from(pointBalancesTable)
      .orderBy(desc(pointBalancesTable.weeklyPoints))
      .limit(100);

    // Clear old snapshots
    await db.delete(leaderboardSnapshotsTable).where(eq(leaderboardSnapshotsTable.scope, 'weekly'));

    // Insert new snapshots
    for (let i = 0; i < weeklyBalances.length; i++) {
      await db.insert(leaderboardSnapshotsTable).values({
        scope: 'weekly',
        rank: i + 1,
        userId: weeklyBalances[i].userId,
        points: weeklyBalances[i].points,
      });
    }

    logger.debug('[LeaderboardService] Snapshots aggregated');
  }

  /**
   * Schedule weekly reset
   */
  private scheduleWeeklyReset(): void {
    const now = new Date();
    const nextMonday = this.getNextMonday(now);
    const msUntilReset = nextMonday.getTime() - now.getTime();

    setTimeout(async () => {
      await this.resetWeeklyPoints();
      // Schedule recurring weekly resets
      this.weeklyResetInterval = setInterval(() => {
        this.resetWeeklyPoints();
      }, 7 * 24 * 60 * 60 * 1000);
    }, msUntilReset);

    logger.info(`[LeaderboardService] Weekly reset scheduled for ${nextMonday.toISOString()}`);
  }

  /**
   * Reset weekly points
   */
  private async resetWeeklyPoints(): Promise<void> {
    const db = this.getDb();
    if (!db) {
      logger.error('[LeaderboardService] Database not available');
      return;
    }

    await db
      .update(pointBalancesTable)
      .set({ weeklyPoints: 0 })
      .where(sql`1=1`); // Update all rows

    logger.info('[LeaderboardService] Weekly points reset completed');
  }

  /**
   * Get next Monday at 00:00 UTC
   */
  private getNextMonday(date: Date): Date {
    const monday = new Date(date);
    monday.setUTCHours(0, 0, 0, 0);
    const dayOfWeek = monday.getUTCDay();
    const daysUntilMonday = dayOfWeek === 0 ? 1 : (8 - dayOfWeek) % 7 || 7;
    monday.setUTCDate(monday.getUTCDate() + daysUntilMonday);
    return monday;
  }

  /**
   * Stop service
   */
  async stop(): Promise<void> {
    if (this.snapshotInterval) {
      clearInterval(this.snapshotInterval);
      this.snapshotInterval = null;
    }
    if (this.weeklyResetInterval) {
      clearInterval(this.weeklyResetInterval);
      this.weeklyResetInterval = null;
    }
    logger.info('[LeaderboardService] Stopped');
  }
}

