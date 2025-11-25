import {
  logger,
  Service,
  type IAgentRuntime,
  DatabaseAdapter,
  type UUID,
} from '@elizaos/core';
import { desc, eq, sql } from 'drizzle-orm';
import { leaderboardSnapshotsTable, pointBalancesTable } from '../schema';

interface RuntimeWithDb extends IAgentRuntime {
  db?: DatabaseAdapter;
}

export class LeaderboardService extends Service {
  static serviceType = 'leaderboard-sync';
  capabilityDescription = 'Aggregates leaderboard snapshots and handles weekly resets';

  private snapshotTimeout: NodeJS.Timeout | null = null;
  private weeklyResetTimeout: NodeJS.Timeout | null = null;
  private isStopped = false;
  private readonly SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

  private getDb(): DatabaseAdapter | undefined {
    return (this.runtime as RuntimeWithDb).db;
  }

  /**
   * Check if a userId belongs to an agent (not a human user)
   */
  private isAgent(userId: UUID): boolean {
    // Check if userId matches the agent's ID or character ID
    return userId === this.runtime.agentId || userId === this.runtime.character.id;
  }

  static async start(runtime: IAgentRuntime): Promise<LeaderboardService> {
    const service = new LeaderboardService(runtime);
    service.startSnapshotWorker();
    service.scheduleWeeklyReset();
    logger.info('[LeaderboardService] Initialized');
    return service;
  }

  /**
   * Start snapshot aggregation worker using recursive setTimeout
   * This prevents queue buildup if aggregation takes longer than the interval
   */
  private startSnapshotWorker(): void {
    this.runSnapshotLoop();
  }

  /**
   * Run snapshot aggregation loop with recursive setTimeout
   * Prevents memory leak from setInterval queue buildup
   */
  private async runSnapshotLoop(): Promise<void> {
    if (this.isStopped) return;

    try {
      await this.aggregateSnapshots();
    } catch (error) {
      logger.error({ error }, '[LeaderboardService] Error aggregating snapshots');
    }

    // Schedule next run only after current one completes
    if (!this.isStopped) {
      this.snapshotTimeout = setTimeout(() => this.runSnapshotLoop(), this.SNAPSHOT_INTERVAL_MS);
    }
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

    // Aggregate all-time leaderboard (excluding agents)
    const allTimeBalancesRaw = await db
      .select({
        userId: pointBalancesTable.userId,
        points: pointBalancesTable.allTimePoints,
      })
      .from(pointBalancesTable)
      .orderBy(desc(pointBalancesTable.allTimePoints));

    // Filter out agents and limit to top 100
    const allTimeBalances = allTimeBalancesRaw
      .filter((balance) => !this.isAgent(balance.userId))
      .slice(0, 100);

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

    // Aggregate weekly leaderboard (excluding agents)
    const weeklyBalancesRaw = await db
      .select({
        userId: pointBalancesTable.userId,
        points: pointBalancesTable.weeklyPoints,
      })
      .from(pointBalancesTable)
      .orderBy(desc(pointBalancesTable.weeklyPoints));

    // Filter out agents and limit to top 100
    const weeklyBalances = weeklyBalancesRaw
      .filter((balance) => !this.isAgent(balance.userId))
      .slice(0, 100);

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
   * Schedule weekly reset using recursive setTimeout
   * Prevents memory leak from setInterval queue buildup
   */
  private scheduleWeeklyReset(): void {
    const now = new Date();
    const nextMonday = this.getNextMonday(now);
    const msUntilReset = nextMonday.getTime() - now.getTime();

    this.weeklyResetTimeout = setTimeout(() => this.runWeeklyResetLoop(), msUntilReset);

    logger.info(`[LeaderboardService] Weekly reset scheduled for ${nextMonday.toISOString()}`);
  }

  /**
   * Run weekly reset loop with recursive setTimeout
   */
  private async runWeeklyResetLoop(): Promise<void> {
    if (this.isStopped) return;

    await this.resetWeeklyPoints();

    // Schedule next weekly reset only after current one completes
    if (!this.isStopped) {
      const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
      this.weeklyResetTimeout = setTimeout(() => this.runWeeklyResetLoop(), WEEK_MS);
    }
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
    this.isStopped = true;
    if (this.snapshotTimeout) {
      clearTimeout(this.snapshotTimeout);
      this.snapshotTimeout = null;
    }
    if (this.weeklyResetTimeout) {
      clearTimeout(this.weeklyResetTimeout);
      this.weeklyResetTimeout = null;
    }
    logger.info('[LeaderboardService] Stopped');
  }
}

