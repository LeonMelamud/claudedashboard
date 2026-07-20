import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { TrendingUp } from 'lucide-react';
import { SEGMENT_CATALOG, SEGMENT_ORDER, type SegmentTier } from '@dash/shared';
import { useRangeParams } from '@/hooks/useRangeParams';
import { useLeaderboard } from '@/lib/queries';
import { MemberTable } from '@/components/MemberTable';
import { CompareDialog } from '@/components/CompareDialog';
import { Avatar } from '@/components/Avatar';
import { DeltaChip } from '@/components/DeltaChip';
import { Sparkline } from '@/components/Sparkline';
import { TableSkeleton, Skeleton } from '@/components/Skeleton';
import { ErrorCard } from '@/components/ErrorCard';
import { InfoPopover } from '@/components/ui';
import { profilePath } from '@/components/UserHoverCard';
import { cn } from '@/lib/utils';

export default function Leaderboard() {
  const { from, to, teamId, compare, setCompare } = useRangeParams();
  const leaderboardQ = useLeaderboard({ from, to, teamId });
  const [filter, setFilter] = useState<SegmentTier | 'all'>('all');

  const entries = useMemo(() => leaderboardQ.data?.entries ?? [], [leaderboardQ.data]);

  const counts = useMemo(() => {
    const map = new Map<SegmentTier, number>();
    for (const e of entries) map.set(e.segment, (map.get(e.segment) ?? 0) + 1);
    return map;
  }, [entries]);

  const filtered = useMemo(
    () => (filter === 'all' ? entries : entries.filter((e) => e.segment === filter)),
    [entries, filter],
  );

  const movers = useMemo(
    () =>
      entries
        .filter((e) => e.trendDeltaPct !== null && e.metrics.sessions > 0)
        .sort((a, b) => (b.trendDeltaPct ?? 0) - (a.trendDeltaPct ?? 0))
        .slice(0, 3),
    [entries],
  );

  const compareEntries = useMemo(
    () => entries.filter((e) => e.user.email !== null && compare.includes(e.user.email)),
    [entries, compare],
  );

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center gap-2">
        <span className="mr-2 inline-flex items-center gap-1.5">
          <h1 className="text-xl font-semibold tracking-tight">Leaderboard</h1>
          <InfoPopover metricKey="composite" />
        </span>
        <button
          type="button"
          onClick={() => setFilter('all')}
          className={cn(
            'rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
            filter === 'all'
              ? 'border-accent/50 bg-accent/15 text-accent'
              : 'border-border text-muted hover:text-fg',
          )}
        >
          All ({entries.length})
        </button>
        {SEGMENT_ORDER.map((tier) => {
          const meta = SEGMENT_CATALOG[tier];
          const active = filter === tier;
          return (
            <button
              key={tier}
              type="button"
              onClick={() => setFilter(active ? 'all' : tier)}
              className={cn(
                'rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
                active ? 'border-transparent' : 'border-border text-muted hover:text-fg',
              )}
              style={
                active
                  ? {
                      color: `var(${meta.cssVar})`,
                      background: `color-mix(in srgb, var(${meta.cssVar}) 15%, transparent)`,
                      borderColor: `color-mix(in srgb, var(${meta.cssVar}) 50%, transparent)`,
                    }
                  : undefined
              }
            >
              {meta.emoji} {meta.name} ({counts.get(tier) ?? 0})
            </button>
          );
        })}
      </header>

      {/* Top movers */}
      {leaderboardQ.isLoading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      ) : (
        movers.length > 0 && (
          <div>
            <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted">
              Top movers <InfoPopover metricKey="topMovers" />
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {movers.map((e, i) => (
                <Link
                  key={e.user.id}
                  to={profilePath(e)}
                  className="card group flex items-center gap-3 p-3.5 transition-colors hover:border-accent/40"
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-good/10 text-good">
                    <TrendingUp size={15} />
                  </span>
                  <Avatar name={e.user.name} email={e.user.email} size={32} />
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-semibold group-hover:text-accent">
                      {e.user.name}
                    </div>
                    <div className="text-[10.5px] text-muted">
                      Top mover #{i + 1}
                      {e.user.teamName ? ` · ${e.user.teamName}` : ''}
                    </div>
                  </div>
                  <div className="ml-auto flex items-center gap-2">
                    <Sparkline data={e.sparkline} width={70} height={24} />
                    <DeltaChip deltaPct={e.trendDeltaPct} />
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )
      )}

      <section className="card p-4">
        {leaderboardQ.isLoading ? (
          <TableSkeleton rows={8} cols={8} />
        ) : leaderboardQ.error ? (
          <ErrorCard error={leaderboardQ.error} onRetry={() => void leaderboardQ.refetch()} compact />
        ) : (
          <MemberTable
            entries={filtered}
            rankEntries={entries}
            showTeam
            showRank
            onCompare={(emails) => setCompare(emails)}
          />
        )}
      </section>

      <CompareDialog
        entries={compareEntries}
        open={compareEntries.length >= 2}
        onClose={() => setCompare([])}
      />
    </div>
  );
}
