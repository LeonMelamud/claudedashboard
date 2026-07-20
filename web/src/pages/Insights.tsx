import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowUp } from 'lucide-react';
import type { UserDto } from '@dash/shared';
import { useRangeParams } from '@/hooks/useRangeParams';
import { useCapabilities, useInsights, useUsers } from '@/lib/queries';
import { InsightCardView } from '@/components/InsightCards';
import { Avatar } from '@/components/Avatar';
import { ErrorCard } from '@/components/ErrorCard';
import { Skeleton, TableSkeleton } from '@/components/Skeleton';
import { fmtDateLong, relativeDate } from '@/lib/format';
import { cn } from '@/lib/utils';

const SEVERITY_ORDER = ['positive', 'info', 'warn'] as const;
const SEVERITY_TITLES: Record<(typeof SEVERITY_ORDER)[number], string> = {
  positive: '🎉 Worth celebrating',
  info: 'Worth knowing',
  warn: 'Worth a nudge',
};

export default function Insights() {
  const { from, to, teamId } = useRangeParams();
  const insightsQ = useInsights({ from, to, teamId });
  const usersQ = useUsers();
  // no authoritative roster → the denominator is observed users, not seats
  const seatCounts = useCapabilities().data?.capabilities.seatCounts !== false;

  const usersById = useMemo(
    () => new Map((usersQ.data?.users ?? []).map((u) => [u.id, u])),
    [usersQ.data],
  );

  if (insightsQ.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-6 w-48" />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
        <div className="card p-4">
          <TableSkeleton rows={5} />
        </div>
      </div>
    );
  }
  if (insightsQ.error) {
    return <ErrorCard error={insightsQ.error} onRetry={() => void insightsQ.refetch()} />;
  }

  const cards = insightsQ.data?.cards ?? [];
  const nonAdopters = insightsQ.data?.nonAdopters ?? [];

  return (
    <div className="space-y-6">
      {SEVERITY_ORDER.map((sev) => {
        const group = cards.filter((c) => c.severity === sev);
        if (group.length === 0) return null;
        return (
          <section key={sev}>
            <h2 className="mb-2.5 text-sm font-semibold">{SEVERITY_TITLES[sev]}</h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {group.map((card) => (
                <InsightCardView key={card.id} card={card} usersById={usersById} />
              ))}
            </div>
          </section>
        );
      })}
      {cards.length === 0 && (
        <div className="card p-8 text-center text-sm text-muted">
          No insights for this range — either everything is humming, or there isn't enough data yet.
        </div>
      )}

      <NonAdopterTable rows={nonAdopters} seatCounts={seatCounts} />
    </div>
  );
}

type NonAdopter = { user: UserDto; daysIdle: number | null; lastActiveDate: string | null };
type SortKey = 'name' | 'team' | 'role' | 'addedAt' | 'daysIdle' | 'lastActive';

const SORTERS: Record<SortKey, (r: NonAdopter) => string | number> = {
  name: (r) => r.user.name.toLowerCase(),
  team: (r) => (r.user.teamName ?? '').toLowerCase(),
  role: (r) => (r.user.role ?? '').toLowerCase(),
  addedAt: (r) => r.user.addedAt ?? '',
  daysIdle: (r) => r.daysIdle ?? Number.MAX_SAFE_INTEGER,
  lastActive: (r) => r.lastActiveDate ?? '',
};

function NonAdopterTable({ rows, seatCounts }: { rows: NonAdopter[]; seatCounts: boolean }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'daysIdle', dir: -1 });
  const sorted = useMemo(() => {
    const sorter = SORTERS[sort.key];
    return [...rows].sort((a, b) => {
      const av = sorter(a);
      const bv = sorter(b);
      const cmp =
        typeof av === 'string' || typeof bv === 'string'
          ? String(av).localeCompare(String(bv))
          : (av as number) - (bv as number);
      return cmp * sort.dir;
    });
  }, [rows, sort]);

  const onSort = (key: SortKey) =>
    setSort((s) =>
      s.key === key ? { key, dir: s.dir === -1 ? 1 : -1 } : { key, dir: key === 'name' || key === 'team' || key === 'role' ? 1 : -1 },
    );

  const Th = ({ label, k, align = 'left' }: { label: string; k: SortKey; align?: 'left' | 'right' }) => (
    <th className={cn('whitespace-nowrap px-3 py-2', align === 'right' && 'text-right')}>
      <button
        type="button"
        onClick={() => onSort(k)}
        className={cn(
          'inline-flex items-center gap-0.5 text-[10.5px] font-semibold uppercase tracking-wider transition-colors hover:text-fg',
          sort.key === k ? 'text-fg' : 'text-muted',
        )}
      >
        {label}
        {sort.key === k && (sort.dir === -1 ? <ArrowDown size={10} /> : <ArrowUp size={10} />)}
      </button>
    </th>
  );

  return (
    <section className="card p-4">
      <h2 className="mb-1 text-sm font-semibold">The adoption gap</h2>
      <p className="mb-3 text-xs text-muted">
        {seatCounts ? 'Rostered engineers' : 'Previously observed users'} who haven't used Claude
        Code lately — a nudge (or a champion pairing) goes a long way.
      </p>
      {rows.length === 0 ? (
        <div className="py-6 text-center text-xs text-muted">
          🎉 Everyone {seatCounts ? 'on the roster' : 'observed'} has been active — no gap to close.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <Th label="Name" k="name" />
                <Th label="Team" k="team" />
                <Th label="Role" k="role" />
                <Th label="Added" k="addedAt" />
                <Th label="Days idle" k="daysIdle" align="right" />
                <Th label="Last active" k="lastActive" align="right" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.user.id} className="border-b border-border/60 hover:bg-fg/[0.025]">
                  <td className="px-3 py-2">
                    <Link
                      to={`/user/${encodeURIComponent(r.user.email ?? String(r.user.id))}`}
                      className="flex items-center gap-2 hover:underline"
                    >
                      <Avatar name={r.user.name} email={r.user.email} size={24} />
                      <span>
                        <span className="block text-[13px] font-medium">{r.user.name}</span>
                        <span className="block text-[10.5px] text-muted">{r.user.email}</span>
                      </span>
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted">{r.user.teamName ?? '—'}</td>
                  <td className="px-3 py-2 text-xs text-muted">{r.user.role ?? '—'}</td>
                  <td className="px-3 py-2 text-xs text-muted">{fmtDateLong(r.user.addedAt?.slice(0, 10))}</td>
                  <td className="px-3 py-2 text-right">
                    {r.daysIdle === null ? (
                      <span className="rounded-full bg-risk/10 px-2 py-0.5 text-[11px] font-medium text-risk">
                        never active
                      </span>
                    ) : (
                      <span
                        className={cn(
                          'text-[13px] font-medium',
                          r.daysIdle >= 14 ? 'text-risk' : r.daysIdle >= 7 ? 'text-warn' : '',
                        )}
                      >
                        {r.daysIdle}d
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right text-xs text-muted">{relativeDate(r.lastActiveDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
