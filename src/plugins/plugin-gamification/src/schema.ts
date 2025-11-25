/**
 * Drizzle ORM schema for gamification tables
 */

import { pgTable, uuid, text, integer, timestamp, jsonb, boolean, index } from 'drizzle-orm/pg-core';
import type { UUID } from '@elizaos/core';

/**
 * Append-only ledger of all gamification events
 */
export const gamificationEventsTable = pgTable('gamification_events', {
  eventId: uuid('event_id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  actionType: text('action_type').notNull(),
  points: integer('points').notNull(),
  metadata: jsonb('metadata'),
  sourceEventId: uuid('source_event_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
  userIdIdx: index('gamification_events_user_id_idx').on(table.userId),
  createdAtIdx: index('gamification_events_created_at_idx').on(table.createdAt),
  actionTypeIdx: index('gamification_events_action_type_idx').on(table.actionType),
  // Composite index for common query pattern: userId + actionType + createdAt
  userActionDateIdx: index('gam_events_user_action_date_idx').on(table.userId, table.actionType, table.createdAt),
}));

/**
 * Materialized point balances per user
 */
export const pointBalancesTable = pgTable('point_balances', {
  userId: uuid('user_id').primaryKey(),
  allTimePoints: integer('all_time_points').notNull().default(0),
  weeklyPoints: integer('weekly_points').notNull().default(0),
  streakDays: integer('streak_days').notNull().default(0),
  lastLoginDate: timestamp('last_login_date'),
  level: integer('level').notNull().default(0),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
  allTimePointsIdx: index('point_balances_all_time_points_idx').on(table.allTimePoints),
  weeklyPointsIdx: index('point_balances_weekly_points_idx').on(table.weeklyPoints),
}));

/**
 * User referral codes
 */
export const referralCodesTable = pgTable('referral_codes', {
  userId: uuid('user_id').primaryKey(),
  code: text('code').notNull().unique(),
  referrerId: uuid('referrer_id'),
  status: text('status').notNull().default('active'), // 'active' | 'inactive'
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
  codeIdx: index('referral_codes_code_idx').on(table.code),
  referrerIdIdx: index('referral_codes_referrer_id_idx').on(table.referrerId),
}));

/**
 * First-time chain transaction tracking
 */
export const userChainHistoryTable = pgTable('user_chain_history', {
  userId: uuid('user_id').notNull(),
  chain: text('chain').notNull(),
  firstTxAt: timestamp('first_tx_at').notNull().defaultNow(),
}, (table) => ({
  userIdChainIdx: index('user_chain_history_user_id_chain_idx').on(table.userId, table.chain),
  userIdIdx: index('user_chain_history_user_id_idx').on(table.userId),
}));

/**
 * Campaign multipliers configuration
 */
export const gamificationCampaignsTable = pgTable('gamification_campaigns', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  actionType: text('action_type'), // null = all actions
  multiplier: integer('multiplier').notNull(), // e.g., 125 for 1.25x (stored as integer * 100)
  startAt: timestamp('start_at').notNull(),
  endAt: timestamp('end_at').notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
  activeIdx: index('gamification_campaigns_active_idx').on(table.active),
  actionTypeIdx: index('gamification_campaigns_action_type_idx').on(table.actionType),
}));

/**
 * Denormalized leaderboard snapshots for fast reads
 */
export const leaderboardSnapshotsTable = pgTable('leaderboard_snapshots', {
  scope: text('scope').notNull(), // 'weekly' | 'all_time'
  rank: integer('rank').notNull(),
  userId: uuid('user_id').notNull(),
  points: integer('points').notNull(),
  snapshotAt: timestamp('snapshot_at').notNull().defaultNow(),
}, (table) => ({
  scopeRankIdx: index('leaderboard_snapshots_scope_rank_idx').on(table.scope, table.rank),
  scopePointsIdx: index('leaderboard_snapshots_scope_points_idx').on(table.scope, table.points),
}));

/**
 * Export schema object for plugin registration
 */
export const gamificationSchema = {
  gamificationEventsTable,
  pointBalancesTable,
  referralCodesTable,
  userChainHistoryTable,
  gamificationCampaignsTable,
  leaderboardSnapshotsTable,
};

