# Gamification Scheduled Jobs (pg_cron)

The gamification plugin uses PostgreSQL's `pg_cron` extension for reliable scheduled jobs instead of Node.js `setTimeout`.

## Why pg_cron?

| Feature | Node.js setTimeout | pg_cron |
|---------|-------------------|---------|
| Survives server restart | ❌ No | ✅ Yes |
| Works with multiple instances | ❌ No (runs in each) | ✅ Yes (runs once) |
| Failure recovery | ❌ Manual | ✅ Automatic retry |
| Job history/logging | ❌ None | ✅ `cron.job_run_details` |
| Transaction safety | ❌ Complex | ✅ Native |
| Memory pressure | ❌ setTimeout loops | ✅ None |

## Scheduled Jobs

| Job | Schedule | Purpose |
|-----|----------|---------|
| `leaderboard-snapshot-5min` | `*/5 * * * *` | Aggregate top 100 leaderboard |
| `weekly-points-reset` | `0 0 * * 1` | Reset weekly points (Monday 00:00 UTC) |
| `daily-analytics-aggregate` | `0 3 * * *` | Generate daily stats |

## Setup

### 1. Enable pg_cron (if not already enabled)

Most managed Postgres services (Supabase, RDS, etc.) have pg_cron available:

```sql
-- Usually done by your cloud provider
CREATE EXTENSION IF NOT EXISTS pg_cron;
```

### 2. Run the migrations

Run migrations in order:

```bash
# Using psql - run in order
psql $DATABASE_URL -f src/plugins/plugin-gamification/migrations/001_add_is_agent_column.sql
psql $DATABASE_URL -f src/plugins/plugin-gamification/migrations/002_pg_cron_setup.sql

# Or using bun
bun run scripts/setup-pg-cron.ts
```

> **Note**: Migration 001 adds the `is_agent` column which is required by the pg_cron jobs in migration 002.

### 3. Verify jobs are scheduled

```sql
SELECT jobid, jobname, schedule, active FROM cron.job ORDER BY jobname;
```

## Management

### List all jobs
```sql
SELECT * FROM cron.job ORDER BY jobname;
```

### View run history
```sql
SELECT jobname, status, return_message, start_time, end_time 
FROM cron.job_run_details 
ORDER BY start_time DESC 
LIMIT 20;
```

### Unschedule a job
```sql
SELECT cron.unschedule('leaderboard-snapshot-5min');
```

### Run a job manually
```sql
-- Trigger immediate execution
CALL gamification.aggregate_leaderboard_snapshots();
```

## Cloud Provider Notes

### Supabase
pg_cron is pre-installed. Enable via Dashboard → Database → Extensions.

### AWS RDS
Add `pg_cron` to your parameter group's `shared_preload_libraries`.

### Google Cloud SQL
Enable the `pg_cron` flag in your instance configuration.

### Railway/Render
May require contacting support to enable the extension.

## Fallback Mode

If pg_cron is not available, the `LeaderboardService` still provides manual methods:

```typescript
const service = runtime.getService('leaderboard-sync') as LeaderboardService;

// Manual aggregation
await service.aggregateSnapshots();

// Manual weekly reset
await service.resetWeeklyPoints();
```

You can call these from an external scheduler (GitHub Actions, cron job, etc.) if pg_cron isn't available.
