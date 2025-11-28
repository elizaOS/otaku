import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import DashboardPageLayout from "@/components/dashboard/layout";
import RebelsRanking from "@/components/dashboard/rebels-ranking";
import DashboardCard from "@/components/dashboard/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { elizaClient } from "@/lib/elizaClient";
import type { RebelRanking } from "@/types/dashboard";
import type { LeaderboardEntry, ReferralCodeResponse } from '@elizaos/api-client/src/services/gamification';
import { Trophy, RefreshCw, Copy, Check } from "lucide-react";
import { UUID } from '@elizaos/core';

// Type assertion for gamification service (will be available after API client rebuild)
const gamificationClient = (elizaClient as any).gamification;

interface LeaderboardPageProps {
  agentId: UUID;
  userId?: UUID;
}

export default function LeaderboardPage({ agentId, userId }: LeaderboardPageProps) {
  const [scope, setScope] = useState<'weekly' | 'all_time'>('weekly');
  const [copied, setCopied] = useState(false);

  const { data: leaderboardData, isLoading, error, refetch } = useQuery({
    queryKey: ['leaderboard', agentId, scope, userId],
    queryFn: async () => {
      if (!gamificationClient) {
        throw new Error('Gamification service not available');
      }
      try {
        return await gamificationClient.getLeaderboard(agentId, scope, 50, userId);
      } catch (err: any) {
        console.error('[LeaderboardPage] Error fetching leaderboard:', err);
        // If 404, return empty data instead of throwing
        if (err?.response?.status === 404 || err?.status === 404) {
          return {
            scope,
            entries: [],
            userRank: 0,
            limit: 50,
          };
        }
        throw err;
      }
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchInterval: 5 * 60 * 1000, // Auto-refresh every 5 minutes
    retry: 1, // Only retry once
  });

  // Available default avatars for randomization
  const defaultAvatars = [
    '/avatars/user_joyboy.png',
    '/avatars/user_krimson.png',
    '/avatars/user_mati.png',
    '/avatars/user_pek.png',
  ];

  // Simple hash function to deterministically select avatar based on userId
  const getRandomAvatar = (userId: string): string => {
    // Use userId as seed for deterministic randomization
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
      const char = userId.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    const index = Math.abs(hash) % defaultAvatars.length;
    return defaultAvatars[index];
  };

  // Check if avatar is the default krimson avatar (early users have this)
  const isKrimsonAvatar = (avatar: string | undefined): boolean => {
    if (!avatar) return false;
    return avatar.includes('user_krimson.png') || avatar.includes('user_krimson');
  };

  // Transform leaderboard entries to RebelRanking format
  // API already limits to 50 entries
  const rebels: RebelRanking[] = (leaderboardData?.entries || []).map((entry: LeaderboardEntry, index: number) => {
      const username = entry.username || `User ${entry.userId.substring(0, 8)}`;
      // Randomize if no avatar or if avatar is the default krimson avatar
      const avatar = (!entry.avatar || isKrimsonAvatar(entry.avatar)) 
        ? getRandomAvatar(entry.userId)
        : entry.avatar;
      return {
        id: entry.rank,
        name: username,
        handle: username.toUpperCase(), // Use uppercase username as handle
        streak: '', // Could add streak info if available
        points: entry.points,
        avatar, // Use randomized avatar if missing or if it's the default krimson avatar
        featured: index < 3, // Top 3 are featured
        subtitle: undefined, // Removed redundant rank and level name subtitle
      };
    });

  const handleRefresh = () => {
    refetch();
  };

  // Query for referral code
  const { data: referralData, isLoading: isLoadingReferral, refetch: refetchReferral } = useQuery({
    queryKey: ['referralCode', agentId, userId],
    queryFn: async () => {
      if (!gamificationClient || !userId) {
        throw new Error('Gamification service or userId not available');
      }
      return await gamificationClient.getReferralCode(agentId, userId);
    },
    enabled: !!userId && !!agentId,
    staleTime: Infinity, // Referral code doesn't change
  });

  const handleCopyReferralLink = async () => {
    if (!referralData?.referralLink) return;
    
    try {
      await navigator.clipboard.writeText(referralData.referralLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy referral link:', err);
    }
  };

  // Calculate if we need to account for "Your Rank" card and referral card in height
  const hasUserRank = leaderboardData?.userRank != null && leaderboardData.userRank > 0;
  const hasReferralCard = !!userId;
  
  // Calculate max-height for leaderboard: viewport height minus header, tabs, user rank card, referral card, and spacing
  // Approximate heights: header ~80px, tabs ~60px, user rank ~100px, referral ~200px, spacing ~100px
  const leaderboardMaxHeight = hasUserRank && hasReferralCard 
    ? 'calc(100vh - 540px)' // Account for all elements
    : hasUserRank 
    ? 'calc(100vh - 340px)' // Account for user rank only
    : hasReferralCard
    ? 'calc(100vh - 440px)' // Account for referral only
    : 'calc(100vh - 240px)'; // Just header and tabs

  return (
    <DashboardPageLayout
      header={{
        title: "Leaderboard",
        description: scope === 'weekly' ? 'Weekly Sprint Rankings' : 'All-Time Rankings',
      }}
    >
      <div className="flex flex-col h-full">
        {/* Scope Tabs */}
        <Tabs value={scope} onValueChange={(value) => setScope(value as 'weekly' | 'all_time')} className="flex flex-col flex-1 min-h-0">
          <div className="flex items-center justify-between flex-shrink-0">
            <TabsList>
              <TabsTrigger value="weekly">Weekly</TabsTrigger>
              <TabsTrigger value="all_time">All-Time</TabsTrigger>
            </TabsList>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={isLoading}
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>

          <TabsContent value="weekly" className="mt-6 flex-1 min-h-0 flex flex-col">
            {error && !isLoading ? (
              <DashboardCard title="WEEKLY LEADERBOARD">
                <div className="text-center py-12">
                  <p className="text-destructive mb-2">Error loading leaderboard</p>
                  <p className="text-sm text-muted-foreground mb-4">
                    {error instanceof Error ? error.message : 'Unknown error'}
                  </p>
                  <Button onClick={() => refetch()} variant="outline" size="sm">
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Retry
                  </Button>
                </div>
              </DashboardCard>
            ) : isLoading ? (
              <DashboardCard title="WEEKLY LEADERBOARD">
                <div className="space-y-4">
                  {[...Array(10)].map((_, i) => (
                    <div key={i} className="flex items-center gap-4 animate-pulse">
                      <div className="h-8 w-8 bg-muted rounded" />
                      <div className="h-12 w-12 bg-muted rounded-lg" />
                      <div className="flex-1 space-y-2">
                        <div className="h-4 bg-muted rounded w-1/3" />
                        <div className="h-3 bg-muted rounded w-1/4" />
                      </div>
                      <div className="h-6 bg-muted rounded w-20" />
                    </div>
                  ))}
                </div>
              </DashboardCard>
            ) : rebels.length > 0 ? (
              <RebelsRanking rebels={rebels} maxHeight={leaderboardMaxHeight} />
            ) : (
              <DashboardCard title="WEEKLY LEADERBOARD">
                <div className="text-center py-12">
                  <Trophy className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">No rankings yet this week</p>
                  <p className="text-sm text-muted-foreground mt-2">
                    Complete actions to earn points and climb the leaderboard!
                  </p>
                </div>
              </DashboardCard>
            )}
          </TabsContent>

          <TabsContent value="all_time" className="mt-6 flex-1 min-h-0 flex flex-col">
            {error && !isLoading ? (
              <DashboardCard title="ALL-TIME LEADERBOARD">
                <div className="text-center py-12">
                  <p className="text-destructive mb-2">Error loading leaderboard</p>
                  <p className="text-sm text-muted-foreground mb-4">
                    {error instanceof Error ? error.message : 'Unknown error'}
                  </p>
                  <Button onClick={() => refetch()} variant="outline" size="sm">
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Retry
                  </Button>
                </div>
              </DashboardCard>
            ) : isLoading ? (
              <DashboardCard title="ALL-TIME LEADERBOARD">
                <div className="space-y-4">
                  {[...Array(10)].map((_, i) => (
                    <div key={i} className="flex items-center gap-4 animate-pulse">
                      <div className="h-8 w-8 bg-muted rounded" />
                      <div className="h-12 w-12 bg-muted rounded-lg" />
                      <div className="flex-1 space-y-2">
                        <div className="h-4 bg-muted rounded w-1/3" />
                        <div className="h-3 bg-muted rounded w-1/4" />
                      </div>
                      <div className="h-6 bg-muted rounded w-20" />
                    </div>
                  ))}
                </div>
              </DashboardCard>
            ) : rebels.length > 0 ? (
              <RebelsRanking rebels={rebels} maxHeight={leaderboardMaxHeight} />
            ) : (
              <DashboardCard title="ALL-TIME LEADERBOARD">
                <div className="text-center py-12">
                  <Trophy className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">No rankings yet</p>
                  <p className="text-sm text-muted-foreground mt-2">
                    Complete actions to earn points and climb the leaderboard!
                  </p>
                </div>
              </DashboardCard>
            )}
          </TabsContent>
        </Tabs>

        {/* User Rank Card */}
        {hasUserRank && (
          <div className="mt-6 mb-4 flex-shrink-0">
            <DashboardCard title="Your Rank">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-3xl font-bold font-mono">#{leaderboardData.userRank}</div>
                  <div className="text-sm text-muted-foreground mt-1">
                    {scope === 'weekly' ? 'Weekly Ranking' : 'All-Time Ranking'}
                  </div>
                </div>
                <Badge variant="default" className="text-lg px-4 py-2">
                  {leaderboardData.entries.find((e: LeaderboardEntry) => e.userId === userId)?.points.toLocaleString() || 0} POINTS
                </Badge>
              </div>
            </DashboardCard>
          </div>
        )}

        {/* Referral Link Card */}
        {userId && (
          <DashboardCard title="Referral Link">
            {isLoadingReferral ? (
              <div className="space-y-3">
                <div className="h-10 bg-muted rounded animate-pulse" />
                <div className="h-9 bg-muted rounded w-32 animate-pulse" />
              </div>
            ) : referralData ? (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <div className="flex-1 p-3 bg-muted rounded-lg border">
                    <div className="text-xs text-muted-foreground mb-1">Your Referral Link</div>
                    <div className="text-sm font-mono break-all">{referralData.referralLink}</div>
                  </div>
                  <Button
                    onClick={handleCopyReferralLink}
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                  >
                    {copied ? (
                      <>
                        <Check className="w-4 h-4 mr-2 text-green-500" />
                        Copied!
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4 mr-2" />
                        Copy
                      </>
                    )}
                  </Button>
                </div>
                <div className="flex items-center gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Signups: </span>
                    <span className="font-semibold">{referralData.stats.totalReferrals}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Activated: </span>
                    <span className="font-semibold">{referralData.stats.activatedReferrals}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Points Earned: </span>
                    <span className="font-semibold">{referralData.stats.totalPointsEarned.toLocaleString()}</span>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Share your referral link to earn points when friends sign up and activate their accounts!
                </p>
              </div>
            ) : (
              <div className="text-center py-4">
                <p className="text-sm text-muted-foreground">Unable to load referral code</p>
                <Button
                  onClick={() => refetchReferral()}
                  variant="outline"
                  size="sm"
                  className="mt-2"
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Retry
                </Button>
              </div>
            )}
          </DashboardCard>
        )}
      </div>
    </DashboardPageLayout>
  );
}

