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
import type { LeaderboardEntry } from '@elizaos/api-client/src/services/gamification';
import { Trophy, RefreshCw } from "lucide-react";
import { UUID } from '@elizaos/core';

// Type assertion for gamification service (will be available after API client rebuild)
const gamificationClient = (elizaClient as any).gamification;

interface LeaderboardPageProps {
  agentId: UUID;
  userId?: UUID;
}

export default function LeaderboardPage({ agentId, userId }: LeaderboardPageProps) {
  const [scope, setScope] = useState<'weekly' | 'all_time'>('weekly');

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

  // Transform leaderboard entries to RebelRanking format
  const rebels: RebelRanking[] = (leaderboardData?.entries || []).map((entry: LeaderboardEntry, index: number) => ({
    id: entry.rank,
    name: `User ${entry.userId.substring(0, 8)}`, // Truncate userId for display
    handle: entry.levelName,
    streak: '', // Could add streak info if available
    points: entry.points,
    avatar: `/avatars/user_krimson.png`, // Default avatar, could fetch from entity metadata
    featured: index < 3, // Top 3 are featured
    subtitle: index < 3 ? `#${entry.rank} • ${entry.levelName}` : undefined,
  }));

  const handleRefresh = () => {
    refetch();
  };

  return (
    <DashboardPageLayout
      header={{
        title: "Leaderboard",
        description: scope === 'weekly' ? 'Weekly Sprint Rankings' : 'All-Time Rankings',
      }}
    >
      <div className="space-y-6">
        {/* Scope Tabs */}
        <Tabs value={scope} onValueChange={(value) => setScope(value as 'weekly' | 'all_time')}>
          <div className="flex items-center justify-between">
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

          <TabsContent value="weekly" className="mt-6">
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
              <RebelsRanking rebels={rebels} />
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

          <TabsContent value="all_time" className="mt-6">
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
              <RebelsRanking rebels={rebels} />
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
        {leaderboardData?.userRank && leaderboardData.userRank > 0 && (
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
        )}
      </div>
    </DashboardPageLayout>
  );
}

