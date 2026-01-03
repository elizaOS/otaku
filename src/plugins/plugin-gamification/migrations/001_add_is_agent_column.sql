-- ============================================================================
-- Add is_agent column to point_balances for leaderboard filtering
-- ============================================================================
-- 
-- This column allows pg_cron jobs to exclude agent/bot accounts from
-- leaderboard snapshots without needing runtime knowledge of agent IDs.
--
-- Run this migration before updating pg_cron jobs if you have existing data.
-- ============================================================================

-- Add the is_agent column (defaults to FALSE for existing rows)
ALTER TABLE gamification.point_balances 
ADD COLUMN IF NOT EXISTS is_agent BOOLEAN NOT NULL DEFAULT FALSE;

-- Add index for filtering performance
CREATE INDEX IF NOT EXISTS point_balances_is_agent_idx 
ON gamification.point_balances (is_agent);

-- Optional: If you know specific agent UUIDs, mark them:
-- UPDATE gamification.point_balances 
-- SET is_agent = TRUE 
-- WHERE user_id IN ('agent-uuid-1', 'agent-uuid-2');
