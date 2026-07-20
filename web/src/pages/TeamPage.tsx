import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { type OverviewResponse } from '@dash/shared';
import { useRangeParams } from '@/hooks/useRangeParams';
import { useCapabilities, useHeatmap, useInsights, useLeaderboard, useOverview, useTeams, useUsers } from '@/lib/queries';
import { ChartCard, ChartPage, HiddenChartChips } from '@/components/ChartCard';
import { ActivityTrend } from '@/components/TrendChart';
import { WhenWorkCard } from '@/components/WhenWorkCard';
import { AcceptanceByToolChart, sumPerTool, perToolTotal } from '@/components/AcceptanceByTool';
import { MemberTable } from '@/components/MemberTable';
import { CompareDialog } from '@/components/CompareDialog';
import { InsightCardView } from '@/components/InsightCards';
import { StatCard } from '@/components/StatCard';
import { StatSkeleton, TableSkeleton, Skeleton } from '@/components/Skeleton';
import { ErrorCard } from '@/components/ErrorCard';
import { InfoPopover } from '@/components/ui';
import { fmtCost, fmtNumber, fmtPct100, fmtSigned } from '@/lib/format';

export default function TeamPage() {
  const { teamId: teamIdParam } = useParams<{ teamId: string }>();
  const { from, to, gran, compare, setCompare } = useRangeParams();
  const teamId = teamIdParam ?? '';

  const teamsQ = useTeams();
  const overviewQ = useOverview({ from, to, teamId, gran });
  const leaderboardQ = useLeaderboard({ from, to, teamId });
  const heatmapQ = useHeatmap({ from, to, teamId });
  const insightsQ = useInsights({ from, to, teamId });
  const usersQ = useUsers();
  // unknown (still loading) counts as available so labels don't flicker
  const seatCounts = useCapabilities().data?.capabilities.seatCounts !== false;

  const team = teamsQ.data?.teams.find((t) => String(t.id) === teamId);
  const entries = leaderboardQ.data?.entries ?? [];
  const partial = useMemo(() => new Set(overviewQ.data?.partialDates ?? []), [overviewQ.data]);
  const usersById = useMemo(
    () => new Map((usersQ.data?.users ?? []).map((u) => [u.id, u])),
    [usersQ.data],
  );

  const perTool = useMemo(() => sumPerTool(entries.map((e) => e.metrics.perTool)), [entries]);

  const compareEntries = useMemo(
    () => entries.filter((e) => e.user.email !== null && compare.includes(e.user.email)),
    [entries, compare],
  );

  if (teamsQ.data && !team) {
    return (
      <ErrorCard
        error={new Error(`Team "${teamId}" doesn't exist (it may have been deleted).`)}
        onRetry={() => void teamsQ.refetch()}
      />
    );
  }

  return (
    <ChartPage pageId={`team-${teamId}`}>
      <div className="grid grid-cols-12 gap-4">
        <header className="col-span-12 flex items-center gap-3">
          {team ? (
            <>
              <span className="size-3.5 rounded-full" style={{ background: team.color }} />
              <h1 className="text-xl font-semibold tracking-tight">{team.name}</h1>
              <span className="text-xs text-muted">{team.memberCount} members</span>
            </>
          ) : (
            <Skeleton className="h-7 w-56" />
          )}
        </header>

        <TeamKpis ov={overviewQ.data} loading={overviewQ.isLoading} seatCounts={seatCounts} />

        <section className="card col-span-12 p-4">
          <div className="mb-3 flex items-center gap-1.5">
            <h2 className="text-sm font-semibold">Members</h2>
            <InfoPopover metricKey="composite" />
          </div>
          {leaderboardQ.isLoading ? (
            <TableSkeleton rows={6} cols={8} />
          ) : leaderboardQ.error ? (
            <ErrorCard error={leaderboardQ.error} onRetry={() => void leaderboardQ.refetch()} compact />
          ) : (
            <MemberTable entries={entries} onCompare={(emails) => setCompare(emails)} />
          )}
        </section>

        <ChartCard
          title="Team trend"
          chartId="team-trend"
          metricKey="activityTrend"
          subtitle="Sessions and active members over time"
          className="col-span-12 lg:col-span-7"
          isLoading={overviewQ.isLoading}
          error={overviewQ.error}
          onRetry={() => void overviewQ.refetch()}
          isEmpty={!!overviewQ.data && overviewQ.data.daily.length === 0}
        >
          {(ref) => (
            <ActivityTrend instanceRef={ref} daily={overviewQ.data?.daily ?? []} gran={gran} partial={partial} />
          )}
        </ChartCard>

        <ChartCard
          title="Acceptance by tool"
          chartId="team-acceptance-by-tool"
          metricKey="acceptanceByTool"
          className="col-span-12 lg:col-span-5"
          isLoading={leaderboardQ.isLoading}
          error={leaderboardQ.error}
          onRetry={() => void leaderboardQ.refetch()}
          isEmpty={!leaderboardQ.isLoading && !leaderboardQ.error && perToolTotal(perTool) === 0}
          emptyText="No tool decisions in this range"
        >
          {(ref) => <AcceptanceByToolChart instanceRef={ref} perTool={perTool} />}
        </ChartCard>

        <WhenWorkCard
          title={`When ${team?.name ?? 'this team'} works`}
          chartId="team-heatmap"
          hours={heatmapQ.data?.hours ?? []}
          isLoading={heatmapQ.isLoading}
          error={heatmapQ.error}
          onRetry={() => void heatmapQ.refetch()}
          className="col-span-12 lg:col-span-7"
        />

        <section className="col-span-12 lg:col-span-5">
          <h2 className="mb-2.5 text-sm font-semibold">Team insights</h2>
          {insightsQ.isLoading && <Skeleton className="h-40" />}
          {insightsQ.error != null && !insightsQ.isLoading && (
            <ErrorCard error={insightsQ.error} onRetry={() => void insightsQ.refetch()} compact className="card" />
          )}
          {insightsQ.data && (
            <div className="space-y-3">
              {insightsQ.data.cards.length === 0 && (
                <div className="card p-6 text-center text-xs text-muted">
                  No team-specific insights for this range.
                </div>
              )}
              {[...insightsQ.data.cards]
                .sort((a, b) => {
                  const order = { positive: 0, info: 1, warn: 2 };
                  return order[a.severity] - order[b.severity];
                })
                .slice(0, 5)
                .map((card) => (
                  <InsightCardView key={card.id} card={card} usersById={usersById} />
                ))}
            </div>
          )}
        </section>

        <HiddenChartChips />
      </div>

      <CompareDialog
        entries={compareEntries}
        open={compareEntries.length >= 2}
        onClose={() => setCompare([])}
      />
    </ChartPage>
  );
}

function TeamKpis({
  ov,
  loading,
  seatCounts,
}: {
  ov: OverviewResponse | undefined;
  loading: boolean;
  /** false = no authoritative roster: the denominator is observed users */
  seatCounts: boolean;
}) {
  if (loading || !ov) {
    return (
      <div className="col-span-12 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <StatSkeleton key={i} />
        ))}
      </div>
    );
  }
  const { kpis, prevKpis, daily } = ov;
  const spark = (f: (d: (typeof daily)[number]) => number) => daily.slice(-30).map(f);
  const rate = kpis.acceptanceRate;

  return (
    <div className="col-span-12 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
      <StatCard
        label="Active members"
        value={kpis.activeUsers}
        prev={prevKpis.activeUsers}
        metricKey="activeUsers"
        sparkline={spark((d) => d.activeUsers)}
        footer={`${fmtPct100(kpis.adoptionPct)} of ${kpis.rosteredUsers} ${seatCounts ? 'rostered' : 'observed users'}`}
      />
      <StatCard
        label="Sessions"
        value={kpis.sessions}
        prev={prevKpis.sessions}
        metricKey="sessions"
        sparkline={spark((d) => d.sessions)}
      />
      <StatCard
        label="Net lines"
        value={kpis.linesAdded - kpis.linesRemoved}
        prev={prevKpis.linesAdded - prevKpis.linesRemoved}
        format={fmtSigned}
        metricKey="netLines"
        sparkline={spark((d) => Math.max(0, d.linesAdded - d.linesRemoved))}
      />
      <StatCard
        label="Commits + PRs"
        value={kpis.commits + kpis.pullRequests}
        prev={prevKpis.commits + prevKpis.pullRequests}
        metricKey="commitsPrs"
        sparkline={spark((d) => d.commits + d.pullRequests)}
        footer={`${fmtNumber(kpis.commits)} commits · ${fmtNumber(kpis.pullRequests)} PRs`}
      />
      <StatCard
        label="Acceptance rate"
        {...(rate !== null
          ? { value: rate * 100, format: (v: number) => `${v.toFixed(0)}%` }
          : { display: '—' })}
        {...(rate !== null && prevKpis.acceptanceRate !== null
          ? { prev: prevKpis.acceptanceRate * 100 }
          : {})}
        metricKey="acceptanceRate"
      />
      <StatCard
        label="Est. cost"
        value={kpis.costCents}
        prev={prevKpis.costCents}
        format={fmtCost}
        invertDelta
        metricKey="estCost"
        sparkline={spark((d) => d.costCents)}
      />
    </div>
  );
}
