import {
  Service,
  type IAgentRuntime,
  type UUID,
  logger,
} from '@elizaos/core';
import { eq, and } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { referralCodesTable, gamificationEventsTable } from '../schema';
import { GamificationEventType } from '../constants';
import type { ReferralCode, ReferralStats } from '../types';
import { GamificationService } from './GamificationService';

interface RuntimeWithDb {
  db?: PgDatabase<PgQueryResultHKT>;
}

export class ReferralService extends Service {
  static serviceType = 'referral';
  capabilityDescription = 'Manages referral codes and attribution';

  private getDb(): PgDatabase<PgQueryResultHKT> | undefined {
    return (this.runtime as unknown as RuntimeWithDb).db;
  }

  static async start(runtime: IAgentRuntime): Promise<ReferralService> {
    const service = new ReferralService(runtime);
    logger.info('[ReferralService] Initialized');
    return service;
  }

  /**
   * Get or create referral code for user
   * 
   * SECURITY: Uses cryptographically random codes with collision checking
   * to prevent prediction of referral codes.
   */
  async getOrCreateCode(userId: UUID): Promise<{ code: string; stats: ReferralStats }> {
    const db = this.getDb();
    if (!db) throw new Error('Database not available');

    const [existing] = await db
      .select()
      .from(referralCodesTable)
      .where(eq(referralCodesTable.userId, userId))
      .limit(1);

    if (existing) {
      const stats = await this.getReferralStats(userId);
      return { code: existing.code, stats };
    }

    // Generate new cryptographically random code with collision checking
    const code = await this.generateUniqueReferralCode(userId);
    await db.insert(referralCodesTable).values({
      userId,
      code,
      status: 'active',
    });
    
    logger.info(`[ReferralService] Created new referral code for user ${userId.substring(0, 8)}...`);

    const stats = await this.getReferralStats(userId);
    return { code, stats };
  }

  /**
   * Get referral stats for a user
   */
  async getReferralStats(userId: UUID): Promise<ReferralStats> {
    const db = this.getDb();
    if (!db) throw new Error('Database not available');

    // Count total referrals
    const totalReferrals = await db
      .select()
      .from(referralCodesTable)
      .where(eq(referralCodesTable.referrerId, userId));

    // Count activated referrals (users who completed first on-chain action)
    // Filter by userId to only count this user's referral activations
    const activatedReferrals = await db
      .select()
      .from(gamificationEventsTable)
      .where(
        and(
          eq(gamificationEventsTable.userId, userId),
          eq(gamificationEventsTable.actionType, GamificationEventType.REFERRAL_ACTIVATION)
        )
      );

    // Calculate total points earned from referrals
    // Filter by userId to only count this user's referral signup points
    const referralEvents = await db
      .select()
      .from(gamificationEventsTable)
      .where(
        and(
          eq(gamificationEventsTable.userId, userId),
          eq(gamificationEventsTable.actionType, GamificationEventType.REFERRAL_SIGNUP)
        )
      );

    const totalPointsEarned = referralEvents.reduce((sum: number, event: { points: number }) => sum + event.points, 0);

    return {
      totalReferrals: totalReferrals.length,
      activatedReferrals: activatedReferrals.length,
      totalPointsEarned,
    };
  }

  async stop(): Promise<void> {
    logger.info('[ReferralService] Stopped');
  }

  /**
   * Process referral signup
   */
  async processReferralSignup(userId: UUID, referralCode: string): Promise<void> {
    const db = this.getDb();
    if (!db) throw new Error('Database not available');

    // Find referrer
    const [referrer] = await db
      .select()
      .from(referralCodesTable)
      .where(eq(referralCodesTable.code, referralCode))
      .limit(1);

    if (!referrer) {
      logger.warn(`[ReferralService] Invalid referral code: ${referralCode}`);
      return;
    }

    // Check if user already has a referral code (prevent self-referral)
    const [existingCode] = await db
      .select()
      .from(referralCodesTable)
      .where(eq(referralCodesTable.userId, userId))
      .limit(1);

    if (existingCode) {
      logger.warn(`[ReferralService] User ${userId} already has referral code`);
      return;
    }

    // Create referral code for new user
    const newCode = this.generateReferralCode(userId);
    await db.insert(referralCodesTable).values({
      userId,
      code: newCode,
      referrerId: referrer.userId,
      status: 'active',
    });

    // Award points to referrer
    const gamificationService = this.runtime.getService('gamification') as GamificationService;
    if (gamificationService) {
      await gamificationService.recordEvent({
        userId: referrer.userId as UUID,
        actionType: GamificationEventType.REFERRAL_SIGNUP,
        metadata: { referredUserId: userId },
      });
    }

    // Award welcome bonus to new user
    if (gamificationService) {
      await gamificationService.recordEvent({
        userId,
        actionType: GamificationEventType.REFERRED_WELCOME,
        metadata: { referrerId: referrer.userId },
      });
    }
  }

  /**
   * Process referral activation (first on-chain action)
   */
  async processReferralActivation(userId: UUID): Promise<void> {
    const db = this.getDb();
    if (!db) throw new Error('Database not available');

    // Find referrer
    const [userCode] = await db
      .select()
      .from(referralCodesTable)
      .where(eq(referralCodesTable.userId, userId))
      .limit(1);

    if (!userCode || !userCode.referrerId) {
      return; // No referrer
    }

    // Check if this specific user has already been activated for this referrer
    const [existingActivation] = await db
      .select()
      .from(gamificationEventsTable)
      .where(
        and(
          eq(gamificationEventsTable.userId, userCode.referrerId),
          eq(gamificationEventsTable.actionType, GamificationEventType.REFERRAL_ACTIVATION)
        )
      )
      .limit(1);

    // Check if this specific userId is already in any activation event metadata
    if (existingActivation) {
      const allActivations = await db
        .select()
        .from(gamificationEventsTable)
        .where(
          and(
            eq(gamificationEventsTable.userId, userCode.referrerId),
            eq(gamificationEventsTable.actionType, GamificationEventType.REFERRAL_ACTIVATION)
          )
        );
      
      const alreadyActivated = allActivations.some((event: any) => 
        event.metadata?.activatedUserId === userId
      );
      
      if (alreadyActivated) {
        return; // This user already activated for this referrer
      }
    }

    // Award activation bonus to referrer
    const gamificationService = this.runtime.getService('gamification') as GamificationService;
    if (gamificationService && userCode.referrerId) {
      await gamificationService.recordEvent({
        userId: userCode.referrerId as UUID,
        actionType: GamificationEventType.REFERRAL_ACTIVATION,
        metadata: { activatedUserId: userId },
      });
    }
  }

  /**
   * Generate a cryptographically random referral code
   * 
   * SECURITY: Uses crypto.randomBytes instead of deterministic hash to prevent
   * prediction of referral codes from known userIds.
   * 
   * Format: 10-character alphanumeric code (base64url safe)
   * Collision probability: ~1 in 2^60 per code (negligible for practical purposes)
   */
  private generateReferralCode(_userId: UUID): string {
    const crypto = require('crypto');
    // Generate 8 random bytes = 64 bits of entropy
    // Convert to base64url (URL-safe base64) and take first 10 characters
    const randomBytes = crypto.randomBytes(8);
    const base64url = randomBytes.toString('base64url').toUpperCase();
    // Return first 10 characters for a clean, readable code
    return base64url.substring(0, 10);
  }
  
  /**
   * Check if a referral code already exists in the database
   * Used for collision detection when generating new codes
   */
  private async codeExists(code: string): Promise<boolean> {
    const db = this.getDb();
    if (!db) throw new Error('Database not available');
    
    const [existing] = await db
      .select()
      .from(referralCodesTable)
      .where(eq(referralCodesTable.code, code))
      .limit(1);
    
    return !!existing;
  }
  
  /**
   * Generate a unique referral code with collision checking
   * Retries up to 5 times if a collision is detected (extremely rare)
   */
  private async generateUniqueReferralCode(userId: UUID): Promise<string> {
    const MAX_ATTEMPTS = 5;
    
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const code = this.generateReferralCode(userId);
      
      // Check for collision (extremely rare with 64-bit entropy)
      const exists = await this.codeExists(code);
      if (!exists) {
        return code;
      }
      
      logger.warn(`[ReferralService] Referral code collision detected (attempt ${attempt + 1}/${MAX_ATTEMPTS}), regenerating...`);
    }
    
    // This should essentially never happen
    throw new Error('Failed to generate unique referral code after multiple attempts');
  }
}

