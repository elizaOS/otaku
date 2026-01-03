-- ============================================================================
-- pg_cron Setup for Gamification Scheduled Jobs
-- ============================================================================
-- 
-- Prerequisites:
--   1. Run migration 001_add_is_agent_column.sql first (creates is_agent column)
--   2. pg_cron extension must be enabled by your cloud provider (Supabase, RDS, etc.)
--   3. Run: CREATE EXTENSION IF NOT EXISTS pg_cron;
--   4. Grant permissions: GRANT USAGE ON SCHEMA cron TO your_user;
--
-- Run this migration to set up scheduled jobs
-- ============================================================================

-- Enable pg_cron extension (requires superuser, usually done by cloud provider)
-- CREATE EXTENSION IF NOT EXISTS pg_cron;

-- ============================================================================
-- Job 1: Leaderboard Snapshot Aggregation (every 5 minutes)
-- ============================================================================
-- Replaces: LeaderboardService.aggregateSnapshots()
-- 
-- Aggregates top 100 users for both weekly and all_time leaderboards
-- into denormalized snapshot table for fast reads

SELECT cron.schedule(
  'leaderboard-snapshot-5min',
  '*/5 * * * *',  -- Every 5 minutes
  $$
  -- Use transaction for atomicity
  BEGIN;
  
  -- Clear and rebuild all_time snapshots (exclude agents/bots)
  DELETE FROM gamification.leaderboard_snapshots WHERE scope = 'all_time';
  INSERT INTO gamification.leaderboard_snapshots (scope, rank, user_id, points, snapshot_at)
  SELECT 
    'all_time',
    ROW_NUMBER() OVER (ORDER BY all_time_points DESC),
    user_id,
    all_time_points,
    NOW()
  FROM gamification.point_balances
  WHERE all_time_points > 0 
    AND (is_agent = FALSE OR is_agent IS NULL)
  ORDER BY all_time_points DESC
  LIMIT 100;
  
  -- Clear and rebuild weekly snapshots (exclude agents/bots)
  DELETE FROM gamification.leaderboard_snapshots WHERE scope = 'weekly';
  INSERT INTO gamification.leaderboard_snapshots (scope, rank, user_id, points, snapshot_at)
  SELECT 
    'weekly',
    ROW_NUMBER() OVER (ORDER BY weekly_points DESC),
    user_id,
    weekly_points,
    NOW()
  FROM gamification.point_balances
  WHERE weekly_points > 0 
    AND (is_agent = FALSE OR is_agent IS NULL)
  ORDER BY weekly_points DESC
  LIMIT 100;
  
  COMMIT;
  $$
);

-- ============================================================================
-- Job 2: Weekly Points Reset (Monday 00:00 UTC)
-- ============================================================================
-- Replaces: LeaderboardService.resetWeeklyPoints()
--
-- Resets all users' weekly points to 0 every Monday at midnight UTC

SELECT cron.schedule(
  'weekly-points-reset',
  '0 0 * * 1',  -- Every Monday at 00:00 UTC
  $$
  UPDATE gamification.point_balances 
  SET weekly_points = 0, updated_at = NOW();
  
  -- Log the reset
  INSERT INTO gamification.gamification_events (user_id, action_type, points, metadata)
  VALUES (
    '00000000-0000-0000-0000-000000000000'::uuid,  -- System user
    'WEEKLY_RESET',
    0,
    jsonb_build_object('reset_at', NOW(), 'job', 'weekly-points-reset')
  );
  $$
);

-- ============================================================================
-- Job 3: Daily Analytics Aggregation (new - 03:00 UTC daily)
-- ============================================================================
-- Generates daily stats for analytics dashboard
-- Creates daily_stats table if needed

SELECT cron.schedule(
  'daily-analytics-aggregate',
  '0 3 * * *',  -- Every day at 03:00 UTC
  $$
  -- Create daily stats table if not exists
  CREATE TABLE IF NOT EXISTS gamification.daily_stats (
    stat_date DATE PRIMARY KEY,
    total_events INTEGER NOT NULL DEFAULT 0,
    unique_users INTEGER NOT NULL DEFAULT 0,
    total_points_awarded INTEGER NOT NULL DEFAULT 0,
    events_by_type JSONB,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  );
  
  -- Aggregate yesterday's stats
  INSERT INTO gamification.daily_stats (stat_date, total_events, unique_users, total_points_awarded, events_by_type)
  SELECT 
    (CURRENT_DATE - INTERVAL '1 day')::date AS stat_date,
    COUNT(*) AS total_events,
    COUNT(DISTINCT user_id) AS unique_users,
    SUM(points) AS total_points_awarded,
    jsonb_object_agg(action_type, type_count) AS events_by_type
  FROM (
    SELECT 
      action_type,
      user_id,
      points,
      COUNT(*) OVER (PARTITION BY action_type) AS type_count
    FROM gamification.gamification_events
    WHERE created_at >= CURRENT_DATE - INTERVAL '1 day'
      AND created_at < CURRENT_DATE
  ) daily_events
  GROUP BY 1
  ON CONFLICT (stat_date) DO UPDATE SET
    total_events = EXCLUDED.total_events,
    unique_users = EXCLUDED.unique_users,
    total_points_awarded = EXCLUDED.total_points_awarded,
    events_by_type = EXCLUDED.events_by_type;
  $$
);

-- ============================================================================
-- Job 4: Stale Event Cleanup (weekly on Sunday 04:00 UTC)
-- ============================================================================
-- Archives events older than 90 days to keep main table performant
-- Optional: Enable only if event table grows large

-- SELECT cron.schedule(
--   'cleanup-old-events',
--   '0 4 * * 0',  -- Every Sunday at 04:00 UTC
--   $$
--   -- Create archive table if not exists
--   CREATE TABLE IF NOT EXISTS gamification.gamification_events_archive (LIKE gamification.gamification_events INCLUDING ALL);
--   
--   -- Move old events to archive
--   WITH moved AS (
--     DELETE FROM gamification.gamification_events
--     WHERE created_at < NOW() - INTERVAL '90 days'
--     RETURNING *
--   )
--   INSERT INTO gamification.gamification_events_archive SELECT * FROM moved;
--   $$
-- );

-- ============================================================================
-- Management Queries
-- ============================================================================

-- List all scheduled jobs:
-- SELECT * FROM cron.job ORDER BY jobname;

-- View job run history:
-- SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 20;

-- Unschedule a job:
-- SELECT cron.unschedule('leaderboard-snapshot-5min');

-- Run a job manually (useful for testing):
-- SELECT cron.schedule('test-run', '* * * * *', 'SELECT 1');
