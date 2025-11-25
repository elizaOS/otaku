import {
  Service,
  type IAgentRuntime,
  type UUID,
  logger,
  DatabaseAdapter,
} from '@elizaos/core';
import { eq, and } from 'drizzle-orm';
import { referralCodesTable, gamificationEventsTable } from '../schema';
import { GamificationEventType } from '../constants';
import type { ReferralCode, ReferralStats } from '../types';
import { GamificationService } from './GamificationService';

interface RuntimeWithDb extends IAgentRuntime {
  db?: DatabaseAdapter;
}

export class ReferralService extends Service {
  static serviceType = 'referral';
  capabilityDescription = 'Manages referral codes and attribution';

  private getDb(): DatabaseAdapter | undefined {
    return (this.runtime as RuntimeWithDb).db;
  }

  static async start(runtime: IAgentRuntime): Promise<ReferralService> {
    const service = new ReferralService(runtime);
    logger.info('[ReferralService] Initialized');
    return service;
  }

  /**
   * Get or create referral code for user
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

    // Generate new code
    const code = this.generateReferralCode(userId);
    await db.insert(referralCodesTable).values({
      userId,
      code,
      status: 'active',
    });

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
        userId: referrer.userId,
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
    if (gamificationService) {
      await gamificationService.recordEvent({
        userId: userCode.referrerId,
        actionType: GamificationEventType.REFERRAL_ACTIVATION,
        metadata: { activatedUserId: userId },
      });
    }
  }

  /**
   * Generate unique referral code from user ID using cryptographically secure randomness
   */
  private generateReferralCode(userId: UUID): string {
    // Use first 8 characters of UUID + cryptographically secure random suffix
    const uuidPart = userId.replace(/-/g, '').substring(0, 8).toUpperCase();
    
    // Use crypto.randomBytes for secure randomness instead of Math.random()
    const crypto = require('crypto');
    const randomBytes = crypto.randomBytes(3); // 3 bytes = 6 hex chars
    const randomSuffix = randomBytes.toString('hex').toUpperCase();
    
    return `${uuidPart}${randomSuffix}`;
  }
}

