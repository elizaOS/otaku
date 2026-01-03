#!/usr/bin/env bun
/**
 * Setup pg_cron jobs for gamification scheduled tasks
 * 
 * Usage:
 *   bun run scripts/setup-pg-cron.ts            # Quiet in dev, verbose in prod
 *   bun run scripts/setup-pg-cron.ts --verbose  # Force verbose output
 *   bun run scripts/setup-pg-cron.ts --force    # Replace existing jobs
 *   
 * Environment:
 *   DATABASE_URL     - Required for database connection
 *   NODE_ENV=production - Enables verbose output automatically
 * 
 * Runs as prestart hook - see package.json
 */

import postgres from 'postgres';

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  const forceReplace = process.argv.includes('--force');
  const isProd = process.env.NODE_ENV === 'production';
  const verbose = isProd || process.argv.includes('--verbose');
  
  if (!databaseUrl) {
    if (verbose) console.log('⏭️  pg_cron setup skipped (DATABASE_URL not set)');
    process.exit(0);
  }

  if (verbose) {
    console.log('🔧 Setting up pg_cron jobs for gamification...');
    if (forceReplace) {
      console.log('   (--force mode: will replace existing jobs)\n');
    } else {
      console.log('   (use --force to replace existing jobs)\n');
    }
  }

  const sql = postgres(databaseUrl);

  try {
    // Check if pg_cron is available
    const [{ exists }] = await sql`
      SELECT EXISTS (
        SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'
      ) as exists
    `;

    if (!exists) {
      if (verbose) console.log('📦 pg_cron extension not found, attempting to install...');
      
      try {
        await sql`CREATE EXTENSION IF NOT EXISTS pg_cron`;
        if (verbose) console.log('✅ pg_cron extension installed successfully\n');
      } catch (err: any) {
        // Handle race condition: concurrent processes may both try to create extension
        if (err.code === '42710') {
          // Extension already exists (created by concurrent process) - OK
          if (verbose) console.log('✅ pg_cron extension already installed (concurrent)\n');
        } else if (err.code === '42501' || err.message?.includes('permission denied')) {
          // Permission denied - need superuser or cloud provider dashboard
          if (verbose) {
            console.log('⏭️  Cannot install pg_cron (requires superuser privileges)');
            console.log('   For managed databases, enable via provider dashboard:');
            console.log('   • Supabase: Dashboard → Database → Extensions → pg_cron');
            console.log('   • AWS RDS: Add to shared_preload_libraries parameter group');
            console.log('   • Neon: Extensions panel in dashboard');
            console.log('   See: src/plugins/plugin-gamification/migrations/README.md\n');
          }
          process.exit(0);
        } else {
          // Other error - might be unsupported
          if (verbose) {
            console.log('⏭️  pg_cron not available on this database');
            console.log(`   Error: ${err.message}\n`);
          }
          process.exit(0);
        }
      }
    } else {
      if (verbose) console.log('✅ pg_cron extension is available\n');
    }

    // Check existing jobs once (with schedule and command for comparison)
    const existingJobs = await sql`SELECT jobname, schedule, command FROM cron.job`;
    const existingJobMap = new Map(existingJobs.map(j => [j.jobname, { schedule: j.schedule, command: j.command }]));

    // Normalize SQL for comparison (collapse whitespace)
    function normalizeSQL(s: string): string {
      return s.replace(/\s+/g, ' ').trim();
    }

    // Helper to schedule a job (skip if same, warn if different, replace with --force)
    async function scheduleJob(name: string, schedule: string, command: string): Promise<'created' | 'unchanged' | 'outdated' | 'replaced' | 'error'> {
      const existing = existingJobMap.get(name);
      
      if (existing) {
        const scheduleMatch = existing.schedule === schedule;
        const commandMatch = normalizeSQL(existing.command) === normalizeSQL(command);
        
        if (scheduleMatch && commandMatch) {
          return 'unchanged'; // Already up to date
        }
        
        // Job exists but is different
        if (forceReplace) {
          // Atomic replacement: unschedule then schedule, restore on failure
          try {
            await sql`SELECT cron.unschedule(${name})`;
            try {
              await sql`SELECT cron.schedule(${name}, ${schedule}, ${command})`;
              return 'replaced';
            } catch (scheduleErr: any) {
              // Schedule failed - restore old job to prevent job loss
              console.error(`❌ Failed to schedule new job '${name}': ${scheduleErr.message}`);
              console.log(`   Restoring previous job configuration...`);
              try {
                await sql`SELECT cron.schedule(${name}, ${existing.schedule}, ${existing.command})`;
                console.log(`   ✅ Previous job restored`);
              } catch (restoreErr: any) {
                console.error(`   ❌ Failed to restore job: ${restoreErr.message}`);
              }
              return 'error';
            }
          } catch (unscheduleErr: any) {
            console.error(`❌ Failed to unschedule job '${name}': ${unscheduleErr.message}`);
            return 'error';
          }
        }
        return 'outdated'; // Needs update but --force not provided
      }
      
      try {
        await sql`SELECT cron.schedule(${name}, ${schedule}, ${command})`;
        return 'created';
      } catch (err: any) {
        console.error(`❌ Failed to create job '${name}': ${err.message}`);
        return 'error';
      }
    }

    // Schedule leaderboard snapshot job (every 5 minutes)
    if (verbose) console.log('📊 Scheduling leaderboard-snapshot-5min...');
    const leaderboardResult = await scheduleJob(
      'leaderboard-snapshot-5min',
      '*/5 * * * *',
      `
        BEGIN;
        DELETE FROM gamification.leaderboard_snapshots WHERE scope = 'all_time';
        INSERT INTO gamification.leaderboard_snapshots (scope, rank, user_id, points, snapshot_at)
        SELECT 'all_time', ROW_NUMBER() OVER (ORDER BY all_time_points DESC), user_id, all_time_points, NOW()
        FROM gamification.point_balances 
        WHERE all_time_points > 0 AND (is_agent = FALSE OR is_agent IS NULL)
        ORDER BY all_time_points DESC LIMIT 100;
        
        DELETE FROM gamification.leaderboard_snapshots WHERE scope = 'weekly';
        INSERT INTO gamification.leaderboard_snapshots (scope, rank, user_id, points, snapshot_at)
        SELECT 'weekly', ROW_NUMBER() OVER (ORDER BY weekly_points DESC), user_id, weekly_points, NOW()
        FROM gamification.point_balances 
        WHERE weekly_points > 0 AND (is_agent = FALSE OR is_agent IS NULL)
        ORDER BY weekly_points DESC LIMIT 100;
        COMMIT;
      `
    );
    if (verbose) {
      if (leaderboardResult === 'unchanged') {
        console.log('   ✅ Up to date\n');
      } else if (leaderboardResult === 'outdated') {
        console.log('   ⚠️  Exists but differs - run with --force to update\n');
      } else if (leaderboardResult === 'replaced') {
        console.log('   🔄 Updated\n');
      } else if (leaderboardResult === 'error') {
        console.log('   ❌ Error (see above)\n');
      } else {
        console.log('   ✅ Created\n');
      }
    }

    // Schedule weekly points reset (Monday 00:00 UTC)
    if (verbose) console.log('🔄 Scheduling weekly-points-reset...');
    const weeklyResult = await scheduleJob(
      'weekly-points-reset',
      '0 0 * * 1',
      `UPDATE gamification.point_balances SET weekly_points = 0, updated_at = NOW();`
    );
    if (verbose) {
      if (weeklyResult === 'unchanged') {
        console.log('   ✅ Up to date\n');
      } else if (weeklyResult === 'outdated') {
        console.log('   ⚠️  Exists but differs - run with --force to update\n');
      } else if (weeklyResult === 'replaced') {
        console.log('   🔄 Updated\n');
      } else if (weeklyResult === 'error') {
        console.log('   ❌ Error (see above)\n');
      } else {
        console.log('   ✅ Created\n');
      }
    }

    // Schedule daily analytics (03:00 UTC)
    if (verbose) console.log('📈 Scheduling daily-analytics-aggregate...');
    const dailyResult = await scheduleJob(
      'daily-analytics-aggregate',
      '0 3 * * *',
      `
        CREATE TABLE IF NOT EXISTS gamification.daily_stats (
          stat_date DATE PRIMARY KEY,
          total_events INTEGER NOT NULL DEFAULT 0,
          unique_users INTEGER NOT NULL DEFAULT 0,
          total_points_awarded INTEGER NOT NULL DEFAULT 0,
          events_by_type JSONB,
          created_at TIMESTAMP NOT NULL DEFAULT NOW()
        );
        
        INSERT INTO gamification.daily_stats (stat_date, total_events, unique_users, total_points_awarded, events_by_type)
        SELECT 
          (CURRENT_DATE - INTERVAL '1 day')::date,
          COUNT(*),
          COUNT(DISTINCT user_id),
          COALESCE(SUM(points), 0),
          (SELECT jsonb_object_agg(action_type, cnt) FROM (
            SELECT action_type, COUNT(*) as cnt 
            FROM gamification.gamification_events 
            WHERE created_at >= CURRENT_DATE - INTERVAL '1 day' AND created_at < CURRENT_DATE
            GROUP BY action_type
          ) t)
        FROM gamification.gamification_events
        WHERE created_at >= CURRENT_DATE - INTERVAL '1 day' AND created_at < CURRENT_DATE
        ON CONFLICT (stat_date) DO UPDATE SET
          total_events = EXCLUDED.total_events,
          unique_users = EXCLUDED.unique_users,
          total_points_awarded = EXCLUDED.total_points_awarded,
          events_by_type = EXCLUDED.events_by_type;
      `
    );
    if (verbose) {
      if (dailyResult === 'unchanged') {
        console.log('   ✅ Up to date\n');
      } else if (dailyResult === 'outdated') {
        console.log('   ⚠️  Exists but differs - run with --force to update\n');
      } else if (dailyResult === 'replaced') {
        console.log('   🔄 Updated\n');
      } else if (dailyResult === 'error') {
        console.log('   ❌ Error (see above)\n');
      } else {
        console.log('   ✅ Created\n');
      }
    }

    // Summary
    const results = [leaderboardResult, weeklyResult, dailyResult];
    const outdatedCount = results.filter(r => r === 'outdated').length;
    const createdCount = results.filter(r => r === 'created').length;
    const errorCount = results.filter(r => r === 'error').length;
    
    // Always show if there are issues or new jobs created
    if (errorCount > 0) {
      console.log(`❌ pg_cron: ${errorCount} job(s) failed - check errors above`);
    } else if (outdatedCount > 0) {
      console.log(`⚠️  pg_cron: ${outdatedCount} job(s) need update - run with --force`);
    } else if (createdCount > 0) {
      console.log(`✅ pg_cron: ${createdCount} job(s) created`);
    } else if (verbose) {
      console.log('✅ pg_cron: all jobs up to date');
      
      // Show job table only in verbose mode
      const jobs = await sql`SELECT jobid, jobname, schedule, active FROM cron.job ORDER BY jobname`;
      console.table(jobs.map(j => ({
        ID: j.jobid,
        Name: j.jobname,
        Schedule: j.schedule,
        Active: j.active ? '✅' : '❌'
      })));
    }

  } catch (error: any) {
    // Always show errors
    console.error('❌ pg_cron setup error:', error.message || error);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

main();
