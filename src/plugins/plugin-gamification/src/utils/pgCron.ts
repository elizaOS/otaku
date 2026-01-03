/**
 * Drizzle-compatible pg_cron helper utilities
 * 
 * Provides typed wrappers for pg_cron extension operations.
 * Requires pg_cron extension to be enabled in PostgreSQL.
 */

import { sql } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';

export interface CronJob {
  jobid: number;
  jobname: string;
  schedule: string;
  command: string;
  nodename: string;
  nodeport: number;
  database: string;
  username: string;
  active: boolean;
}

export interface CronJobRunDetail {
  runid: number;
  jobid: number;
  jobname: string;
  status: 'starting' | 'running' | 'sending' | 'connecting' | 'succeeded' | 'failed';
  return_message: string;
  start_time: Date;
  end_time: Date | null;
}

type Db = PgDatabase<PgQueryResultHKT>;

export const pgCron = {
  /**
   * Check if pg_cron extension is available
   */
  async isAvailable(db: Db): Promise<boolean> {
    try {
      const [result] = await db.execute<{ exists: boolean }>(sql`
        SELECT EXISTS (
          SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'
        ) as exists
      `);
      return result?.exists ?? false;
    } catch {
      return false;
    }
  },

  /**
   * Install pg_cron extension (requires superuser privileges)
   */
  async install(db: Db): Promise<boolean> {
    try {
      await db.execute(sql`CREATE EXTENSION IF NOT EXISTS pg_cron`);
      return true;
    } catch {
      return false;
    }
  },

  /**
   * Schedule a new cron job
   * @param name - Unique job identifier
   * @param schedule - Cron expression (e.g., '*/5 * * * *')
   * @param command - SQL command to execute
   */
  async schedule(db: Db, name: string, schedule: string, command: string): Promise<number | null> {
    try {
      const [result] = await db.execute<{ schedule: number }>(
        sql`SELECT cron.schedule(${name}, ${schedule}, ${command}) as schedule`
      );
      return result?.schedule ?? null;
    } catch (error) {
      console.error(`[pgCron] Failed to schedule job '${name}':`, error);
      return null;
    }
  },

  /**
   * Unschedule a cron job by name
   */
  async unschedule(db: Db, name: string): Promise<boolean> {
    try {
      await db.execute(sql`SELECT cron.unschedule(${name})`);
      return true;
    } catch {
      return false;
    }
  },

  /**
   * Unschedule a cron job by ID
   */
  async unscheduleById(db: Db, jobId: number): Promise<boolean> {
    try {
      await db.execute(sql`SELECT cron.unschedule(${jobId})`);
      return true;
    } catch {
      return false;
    }
  },

  /**
   * List all scheduled cron jobs
   */
  async listJobs(db: Db): Promise<CronJob[]> {
    try {
      const jobs = await db.execute<CronJob>(sql`
        SELECT jobid, jobname, schedule, command, nodename, nodeport, database, username, active 
        FROM cron.job 
        ORDER BY jobname
      `);
      return jobs as unknown as CronJob[];
    } catch {
      return [];
    }
  },

  /**
   * Get a specific job by name
   */
  async getJob(db: Db, name: string): Promise<CronJob | null> {
    try {
      const [job] = await db.execute<CronJob>(sql`
        SELECT jobid, jobname, schedule, command, nodename, nodeport, database, username, active 
        FROM cron.job 
        WHERE jobname = ${name}
        LIMIT 1
      `);
      return job ?? null;
    } catch {
      return null;
    }
  },

  /**
   * Get job run history
   */
  async getRunHistory(db: Db, limit = 20): Promise<CronJobRunDetail[]> {
    try {
      const history = await db.execute<CronJobRunDetail>(sql`
        SELECT runid, jobid, job_run_details.jobname, status, return_message, start_time, end_time 
        FROM cron.job_run_details 
        ORDER BY start_time DESC 
        LIMIT ${limit}
      `);
      return history as unknown as CronJobRunDetail[];
    } catch {
      return [];
    }
  },

  /**
   * Get run history for a specific job
   */
  async getJobRunHistory(db: Db, name: string, limit = 20): Promise<CronJobRunDetail[]> {
    try {
      const history = await db.execute<CronJobRunDetail>(sql`
        SELECT runid, jobid, job_run_details.jobname, status, return_message, start_time, end_time 
        FROM cron.job_run_details 
        WHERE jobname = ${name}
        ORDER BY start_time DESC 
        LIMIT ${limit}
      `);
      return history as unknown as CronJobRunDetail[];
    } catch {
      return [];
    }
  },

  /**
   * Enable or disable a job
   */
  async setActive(db: Db, name: string, active: boolean): Promise<boolean> {
    try {
      await db.execute(sql`
        UPDATE cron.job 
        SET active = ${active} 
        WHERE jobname = ${name}
      `);
      return true;
    } catch {
      return false;
    }
  },

  /**
   * Update a job's schedule
   */
  async updateSchedule(db: Db, name: string, newSchedule: string): Promise<boolean> {
    try {
      await db.execute(sql`
        UPDATE cron.job 
        SET schedule = ${newSchedule} 
        WHERE jobname = ${name}
      `);
      return true;
    } catch {
      return false;
    }
  },

  /**
   * Schedule or update a job (upsert behavior)
   * Returns 'created' | 'updated' | 'unchanged' | 'error'
   */
  async upsert(
    db: Db, 
    name: string, 
    schedule: string, 
    command: string
  ): Promise<'created' | 'updated' | 'unchanged' | 'error'> {
    try {
      const existing = await pgCron.getJob(db, name);
      
      if (!existing) {
        const jobId = await pgCron.schedule(db, name, schedule, command);
        return jobId ? 'created' : 'error';
      }

      // Compare to see if update needed
      const normalizeSQL = (s: string) => s.replace(/\s+/g, ' ').trim();
      const scheduleMatch = existing.schedule === schedule;
      const commandMatch = normalizeSQL(existing.command) === normalizeSQL(command);

      if (scheduleMatch && commandMatch) {
        return 'unchanged';
      }

      // Need to unschedule and reschedule (pg_cron doesn't support direct update of command)
      // Use atomic replacement: if schedule fails, restore the old job
      try {
        await pgCron.unschedule(db, name);
        const jobId = await pgCron.schedule(db, name, schedule, command);
        if (jobId) {
          return 'updated';
        }
        // Schedule returned null - try to restore old job
        await pgCron.schedule(db, name, existing.schedule, existing.command);
        return 'error';
      } catch {
        // Schedule failed - try to restore old job to prevent job loss
        try {
          await pgCron.schedule(db, name, existing.schedule, existing.command);
        } catch {
          // Restore also failed - job is lost
        }
        return 'error';
      }
    } catch {
      return 'error';
    }
  },
};

export default pgCron;
