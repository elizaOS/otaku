/**
 * Gamification constants - point values, caps, and configuration
 */

export enum GamificationEventType {
  ACCOUNT_CREATION = 'ACCOUNT_CREATION',
  DAILY_LOGIN_STREAK = 'DAILY_LOGIN_STREAK',
  MEANINGFUL_CHAT = 'MEANINGFUL_CHAT',
  SWAP_COMPLETED = 'SWAP_COMPLETED',
  BRIDGE_COMPLETED = 'BRIDGE_COMPLETED',
  TRANSFER_COMPLETED = 'TRANSFER_COMPLETED',
  DAILY_QUEST = 'DAILY_QUEST',
  REFERRAL_SIGNUP = 'REFERRAL_SIGNUP',
  REFERRAL_ACTIVATION = 'REFERRAL_ACTIVATION',
  REFERRED_WELCOME = 'REFERRED_WELCOME',
  FIRST_CHAIN_BONUS = 'FIRST_CHAIN_BONUS',
  AGENT_ACTION = 'AGENT_ACTION',
}

/**
 * Base point values for each action type
 */
export const BASE_POINTS: Record<GamificationEventType, number> = {
  [GamificationEventType.ACCOUNT_CREATION]: 100,
  [GamificationEventType.DAILY_LOGIN_STREAK]: 25, // +10 per consecutive day (max +70)
  [GamificationEventType.MEANINGFUL_CHAT]: 2, // Tiered: 2-5 pts based on length (25-74: 2pts, 75-99: 3pts, 100-199: 4pts, 200+: 5pts), up to 6/day
  [GamificationEventType.SWAP_COMPLETED]: 80, // +1 per $10 routed (cap +420)
  [GamificationEventType.BRIDGE_COMPLETED]: 120, // +1.5 per $10 bridged (cap +600)
  [GamificationEventType.TRANSFER_COMPLETED]: 40, // Only >$25 outward transfers
  [GamificationEventType.DAILY_QUEST]: 100, // Complete 3 unique actions
  [GamificationEventType.REFERRAL_SIGNUP]: 200,
  [GamificationEventType.REFERRAL_ACTIVATION]: 300,
  [GamificationEventType.REFERRED_WELCOME]: 50,
  [GamificationEventType.FIRST_CHAIN_BONUS]: 50,
  [GamificationEventType.AGENT_ACTION]: 10, // Any action completed by agent
};

/**
 * Daily caps per action type
 */
export const DAILY_CAPS: Partial<Record<GamificationEventType, number>> = {
  [GamificationEventType.MEANINGFUL_CHAT]: 6, // 6 messages per day
  [GamificationEventType.SWAP_COMPLETED]: Infinity, // No cap, but volume bonus capped
  [GamificationEventType.BRIDGE_COMPLETED]: Infinity, // No cap, but volume bonus capped
  [GamificationEventType.AGENT_ACTION]: Infinity, // No cap on agent actions
};

/**
 * Volume-based bonus multipliers
 */
export const VOLUME_MULTIPLIERS = {
  SWAP: {
    base: 80,
    perDollar: 0.1, // +1 pt per $10 = 0.1 per $1
    cap: 420, // Max bonus
  },
  BRIDGE: {
    base: 120,
    perDollar: 0.15, // +1.5 pts per $10 = 0.15 per $1
    cap: 600, // Max bonus
  },
};

/**
 * Level thresholds
 */
export const LEVEL_THRESHOLDS = [
  { level: 0, name: 'Explorer', minPoints: 0, maxPoints: 999 },
  { level: 1, name: 'Strategist', minPoints: 1000, maxPoints: 4999 },
  { level: 2, name: 'Architect', minPoints: 5000, maxPoints: 19999 },
  { level: 3, name: 'Overlord', minPoints: 20000, maxPoints: Infinity },
];

/**
 * Streak bonus calculation
 * Base: 25 points
 * Bonus: +10 per consecutive day (max +70)
 * Total max: 95 points per day
 */
export const STREAK_BONUS_PER_DAY = 10;
export const MAX_STREAK_BONUS = 70;

/**
 * Minimum transfer value for points (USD)
 */
export const MIN_TRANSFER_VALUE_USD = 25;

/**
 * Minimum chat message length for "meaningful" chat (characters)
 */
export const MIN_CHAT_LENGTH = 25;

/**
 * Message length tiers for chat points
 * Messages < 25 chars earn 0 points
 */
export const MESSAGE_LENGTH_TIERS = [
  { minLength: 25, maxLength: 74, points: 2 },    // Basic engagement
  { minLength: 75, maxLength: 99, points: 3 },    // Medium engagement
  { minLength: 100, maxLength: 199, points: 4 },  // Good engagement
  { minLength: 200, maxLength: Infinity, points: 5 }, // Meaningful conversation
];

/**
 * Daily quest requirements
 */
export const DAILY_QUEST_UNIQUE_ACTIONS_REQUIRED = 3;

/**
 * Referral activation window (days)
 */
export const REFERRAL_ACTIVATION_WINDOW_DAYS = 7;

