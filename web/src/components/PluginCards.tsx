import { Fragment, useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { PluginsResponse, PluginUsageRow } from '@dash/shared';
import { fmtCost, fmtNumber, fmtPct } from '@/lib/format';
import { ChartCard } from '@/components/ChartCard';
import { StatCard } from '@/components/StatCard';
import { StatSkeleton } from '@/components/Skeleton';
import { DrillCount, type BreakdownTarget } from '@/components/BreakdownDrawer';
import { Segmented } from '@/components/ui';
import { cn } from '@/lib/utils';
import { EntityName } from '@/components/EntityName';

type Drill = ((t: BreakdownTarget) => void) | undefined;
type RankMode = 'invocations' | 'cost';
type RankedPlugin = PluginUsageRow & { rank: number };

/** 'plugin:skill' → 'skill'; names without the plugin prefix stay as they are. */
function skillLabel(skillName: string, pluginName: string): string {
  return skillName.startsWith(`${pluginName}:`) ? skillName.slice(pluginName.length + 1) : skillName;
}

// ---------------------------------------------------------------------------
// KPI row
// ---------------------------------------------------------------------------

export function PluginKpis({
  data,
  loading,
  noData,
}: {
  data: PluginsResponse | undefined;
  loading: boolean;
  noData: boolean;
}) {
  if (loading || !data) {
    return (
      <div className="col-span-12 grid grid-cols-2 gap-4 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <StatSkeleton key={i} />
        ))}
      </div>
    );
  }
  const used = data.plugins.filter((p) => p.invocations > 0);
  const runs = used.reduce((s, p) => s + p.invocations, 0);
  const cost = used.reduce((s, p) => s + p.costCents, 0);
  const skills = used.reduce((s, p) => s + p.skills.length, 0);
  const top = used[0];
  return (
    <div className="col-span-12 grid grid-cols-2 gap-4 xl:grid-cols-4">
      <StatCard
        label="Plugins in use"
        {...(noData ? { display: '—' } : { value: used.length })}
        metricKey="pluginUsage"
        footer={noData ? 'Waiting for telemetry' : `of ${fmtNumber(data.plugins.length)} loaded or used`}
      />
      <StatCard
        label="Plugin skill runs"
        {...(noData ? { display: '—' } : { value: runs })}
        metricKey="pluginUsage"
        footer={noData ? 'Waiting for telemetry' : `${fmtNumber(skills)} distinct skills`}
      />
      <StatCard
        label="Top plugin"
        display={noData || !top ? '—' : top.pluginName}
        metricKey="pluginUsage"
        footer={
          noData || !top
            ? 'Waiting for telemetry'
            : `${fmtNumber(top.invocations)} runs · ${fmtPct(top.invocations / Math.max(1, runs))} of plugin use`
        }
      />
      <StatCard
        label="Plugin skill cost"
        display={noData ? '—' : fmtCost(cost)}
        metricKey="pluginUsage"
        footer={noData ? 'Waiting for telemetry' : 'API cost attributed to plugin skills'}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ranking — one row per plugin, expandable into its skills
// ---------------------------------------------------------------------------

export function PluginRankingCard({
  rows,
  isLoading,
  noData,
  onDrill,
  onRetry,
}: {
  rows: PluginUsageRow[];
  isLoading: boolean;
  noData: boolean;
  onDrill?: Drill;
  onRetry?: () => void;
}) {
  const [mode, setMode] = useState<RankMode>('invocations');
  const [filter, setFilter] = useState('');
  const [showUnused, setShowUnused] = useState(false);
  const [open, setOpen] = useState<Set<string>>(() => new Set());

  const q = filter.trim().toLowerCase();
  const unused = rows.filter((r) => r.invocations === 0).length;
  // rank, share and bar scale come from the whole list, so filtering never renumbers it
  const { visible, total, max } = useMemo(() => {
    const metric = (r: PluginUsageRow) => (mode === 'cost' ? r.costCents : r.invocations);
    const ranked: RankedPlugin[] = [...rows]
      .sort((a, b) => metric(b) - metric(a) || b.invocations - a.invocations || b.loads - a.loads)
      .map((r, i) => ({ ...r, rank: i + 1 }));
    return {
      visible: ranked
        .filter((r) => showUnused || r.invocations > 0)
        .filter(
          (r) =>
            !q || r.pluginName.toLowerCase().includes(q) || r.skills.some((s) => s.skillName.toLowerCase().includes(q)),
        ),
      total: ranked.reduce((sum, r) => sum + metric(r), 0),
      max: ranked.reduce((m, r) => Math.max(m, metric(r)), 0),
    };
  }, [rows, mode, q, showUnused]);

  const toggle = (name: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  return (
    <ChartCard
      title="Plugin ranking"
      chartId="plugin-ranking"
      metricKey="pluginUsage"
      subtitle="Plugins ranked by their skills’ usage — expand a plugin for each skill"
      infoExtra="A skill counts toward a plugin when telemetry names the plugin, or when its 'plugin:' prefix matches a plugin Claude Code reported loading. Loads are sessions that loaded the plugin, used or not. Plugins with no skill runs in range are hidden by default."
      actions={
        <div className="flex items-center gap-2">
          {unused > 0 && (
            <button
              type="button"
              onClick={() => setShowUnused((v) => !v)}
              aria-pressed={showUnused}
              className="rounded-md border border-border bg-transparent px-2 py-1 text-xs text-muted transition-colors hover:border-accent hover:text-fg"
            >
              {showUnused ? 'Hide unused' : `Show ${fmtNumber(unused)} unused`}
            </button>
          )}
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter plugins…"
            aria-label="Filter plugins by plugin or skill name"
            className="w-32 rounded-md border border-border bg-transparent px-2 py-1 text-xs outline-none transition-colors placeholder:text-muted focus:border-accent"
          />
          <Segmented
            size="xs"
            options={[
              { id: 'invocations' as const, label: 'Invocations' },
              { id: 'cost' as const, label: 'Cost' },
            ]}
            value={mode}
            onChange={setMode}
          />
        </div>
      }
      className="col-span-12"
      noExport
      isLoading={isLoading}
      {...(onRetry ? { onRetry } : {})}
      isEmpty={noData || visible.length === 0}
      emptyText={
        noData
          ? 'Waiting for telemetry events'
          : q && rows.length > 0
            ? 'No plugins match the filter'
            : rows.length > 0
              ? 'No plugin skill ran in this range'
              : 'No plugin activity in this range'
      }
    >
      <RankingTable
        rows={visible}
        total={total}
        max={max}
        mode={mode}
        open={open}
        onToggle={toggle}
        onDrill={onDrill}
        filter={q}
      />
    </ChartCard>
  );
}

function RankingTable({
  rows,
  total,
  max,
  mode,
  open,
  onToggle,
  onDrill,
  filter,
}: {
  rows: RankedPlugin[];
  /** whole-list sum and top value, so share and bars don't change under the filter */
  total: number;
  max: number;
  mode: RankMode;
  open: Set<string>;
  onToggle: (name: string) => void;
  onDrill: Drill;
  filter: string;
}) {
  const metric = (r: { invocations: number; costCents: number }) => (mode === 'cost' ? r.costCents : r.invocations);
  const fmtVal = mode === 'cost' ? fmtCost : fmtNumber;
  const headers = ['#', 'Plugin', mode === 'cost' ? 'Cost' : 'Runs', 'Share', 'Users', 'Skills', mode === 'cost' ? 'Runs' : 'Cost', 'Loads'];
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border">
            {headers.map((h, i) => (
              <th
                key={h}
                className={cn(
                  'whitespace-nowrap px-2.5 py-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted',
                  i === 0 || i === 1 ? 'text-left' : 'text-right',
                )}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const isOpen = open.has(p.pluginName) || (!!filter && !p.pluginName.toLowerCase().includes(filter));
            const value = metric(p);
            return (
              <Fragment key={p.pluginName}>
                <tr
                  className="cursor-pointer border-b border-border/60 transition-colors hover:bg-fg/[0.025]"
                  onClick={() => onToggle(p.pluginName)}
                >
                  <td className="w-8 px-2.5 py-1.5 text-xs text-muted">{p.rank}</td>
                  <td className="px-2.5 py-1.5">
                    <span className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggle(p.pluginName);
                        }}
                        aria-expanded={isOpen}
                        aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${p.pluginName} skills`}
                        className="shrink-0 rounded text-muted transition-colors hover:text-fg"
                      >
                        <ChevronRight
                          size={14}
                          className={cn('transition-transform', isOpen && 'rotate-90')}
                          aria-hidden
                        />
                      </button>
                      <span className="w-44 shrink-0" onClick={(e) => e.stopPropagation()}>
                        <EntityName kind="plugin" name={p.pluginName} className="font-mono text-[12px] font-medium" />
                      </span>
                      <span className="h-[6px] min-w-16 flex-1 overflow-hidden rounded-full bg-fg/10">
                        <span
                          className="block h-full rounded-full bg-accent"
                          style={{ width: `${max > 0 && value > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0}%` }}
                        />
                      </span>
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-2.5 py-1.5 text-right text-[12.5px] font-medium">{fmtVal(value)}</td>
                  <td className="whitespace-nowrap px-2.5 py-1.5 text-right text-xs text-muted">
                    {total > 0 ? fmtPct(value / total) : '—'}
                  </td>
                  <td className="whitespace-nowrap px-2.5 py-1.5 text-right text-xs text-muted">{fmtNumber(p.users)}</td>
                  <td className="whitespace-nowrap px-2.5 py-1.5 text-right text-xs text-muted">{fmtNumber(p.skills.length)}</td>
                  <td className="whitespace-nowrap px-2.5 py-1.5 text-right text-xs text-muted">
                    {mode === 'cost' ? fmtNumber(p.invocations) : fmtCost(p.costCents)}
                  </td>
                  <td className="whitespace-nowrap px-2.5 py-1.5 text-right text-xs text-muted">{fmtNumber(p.loads)}</td>
                </tr>
                {isOpen && (
                  <tr className="border-b border-border/60 bg-fg/[0.02]">
                    <td />
                    <td colSpan={headers.length - 1} className="px-2.5 pb-2.5 pt-1">
                      <PluginSkills plugin={p} mode={mode} onDrill={onDrill} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PluginSkills({ plugin, mode, onDrill }: { plugin: PluginUsageRow; mode: RankMode; onDrill: Drill }) {
  if (plugin.skills.length === 0) {
    return (
      <p className="py-1 pl-6 text-xs text-muted">
        Loaded {fmtNumber(plugin.loads)} times by {fmtNumber(plugin.loadUsers)} people — none of its skills ran in this range.
      </p>
    );
  }
  const metric = (r: { invocations: number; costCents: number }) => (mode === 'cost' ? r.costCents : r.invocations);
  const fmtVal = mode === 'cost' ? fmtCost : fmtNumber;
  const sorted = [...plugin.skills].sort((a, b) => metric(b) - metric(a) || b.invocations - a.invocations);
  const max = sorted.reduce((m, r) => Math.max(m, metric(r)), 0);
  const total = metric(plugin);
  return (
    <ul className="space-y-1.5 py-1 pl-6">
      {sorted.map((s) => (
        <li key={s.skillName} className="flex items-center gap-2.5">
          <EntityName
            kind="skill"
            name={s.skillName}
            label={skillLabel(s.skillName, plugin.pluginName)}
            className="w-44 shrink-0 font-mono text-[11.5px]"
          />
          <span className="h-[5px] min-w-0 flex-1 overflow-hidden rounded-full bg-fg/10">
            <span
              className="block h-full rounded-full bg-accent2"
              style={{ width: `${max > 0 ? Math.max(2, Math.round((metric(s) / max) * 100)) : 0}%` }}
            />
          </span>
          <span className="w-14 shrink-0 text-right text-xs">{fmtVal(metric(s))}</span>
          <span className="w-12 shrink-0 text-right text-[10px] text-muted">
            {total > 0 ? fmtPct(metric(s) / total) : ''}
          </span>
          <span className="w-16 shrink-0 text-right text-[10.5px] text-muted">
            {onDrill ? (
              <DrillCount
                value={s.users}
                suffix={s.users === 1 ? ' user' : ' users'}
                onClick={() => onDrill({ dimension: 'skill', entity: s.skillName, title: `Skill · ${s.skillName}` })}
              />
            ) : (
              `${fmtNumber(s.users)} ${s.users === 1 ? 'user' : 'users'}`
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}
