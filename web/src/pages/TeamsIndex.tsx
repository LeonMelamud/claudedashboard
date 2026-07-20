import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Users } from 'lucide-react';
import { SEGMENT_CATALOG, SEGMENT_ORDER, type TeamSummary } from '@dash/shared';
import { useRangeParams } from '@/hooks/useRangeParams';
import { useTeamsSummary } from '@/lib/queries';
import { useChartTheme, asTipArray } from '@/lib/chartTheme';
import { ChartCard, ChartPage, HiddenChartChips } from '@/components/ChartCard';
import { EChart, type EChartsOption, type EChartsInstance } from '@/components/EChart';
import { Segmented, Switch } from '@/components/ui';
import { Skeleton } from '@/components/Skeleton';
import { ErrorCard } from '@/components/ErrorCard';
import { fmtCost, fmtNumber, fmtPct, fmtPct100, fmtSigned } from '@/lib/format';
import { cn } from '@/lib/utils';

type Ref = React.MutableRefObject<EChartsInstance | null>;

type MetricId = 'sessions' | 'cost' | 'netLines' | 'acceptance';

interface MetricDef {
  id: MetricId;
  label: string;
  perActive: (t: TeamSummary) => number | null;
  absolute: (t: TeamSummary) => number | null;
  format: (v: number) => string;
  supportsAbsolute: boolean;
}

const METRICS: MetricDef[] = [
  {
    id: 'sessions',
    label: 'Sessions',
    perActive: (t) => t.sessionsPerActive,
    absolute: (t) => t.sessions,
    format: fmtNumber,
    supportsAbsolute: true,
  },
  {
    id: 'cost',
    label: 'Cost',
    perActive: (t) => t.costPerActiveCents,
    absolute: (t) => t.costCents,
    format: fmtCost,
    supportsAbsolute: true,
  },
  {
    id: 'netLines',
    label: 'Net lines',
    perActive: (t) => (t.activeMembers > 0 ? t.netLines / t.activeMembers : null),
    absolute: (t) => t.netLines,
    format: fmtNumber,
    supportsAbsolute: true,
  },
  {
    id: 'acceptance',
    label: 'Acceptance',
    perActive: (t) => (t.acceptanceRate !== null ? t.acceptanceRate * 100 : null),
    absolute: (t) => (t.acceptanceRate !== null ? t.acceptanceRate * 100 : null),
    format: (v) => `${v.toFixed(0)}%`,
    supportsAbsolute: false,
  },
];

export default function TeamsIndex() {
  const { from, to } = useRangeParams();
  const summaryQ = useTeamsSummary({ from, to });
  const teams = summaryQ.data?.teams ?? [];

  return (
    <ChartPage pageId="teams">
      <div className="grid grid-cols-12 gap-4">
        <ChartCard
          title="Team vs team"
          chartId="team-vs-team"
          metricKey="teamVsTeam"
          className="col-span-12 lg:col-span-7"
          isLoading={summaryQ.isLoading}
          error={summaryQ.error}
          onRetry={() => void summaryQ.refetch()}
          isEmpty={!!summaryQ.data && teams.length === 0}
          emptyText="No teams yet — create some under Admin → Teams"
        >
          {(ref) => <TeamVsTeam instanceRef={ref} teams={teams} />}
        </ChartCard>

        <ChartCard
          title="Team score radar"
          chartId="team-radar"
          metricKey="teamRadar"
          subtitle="Average axis scores per team (max 5 shown)"
          className="col-span-12 lg:col-span-5"
          isLoading={summaryQ.isLoading}
          error={summaryQ.error}
          onRetry={() => void summaryQ.refetch()}
          isEmpty={!!summaryQ.data && teams.length === 0}
          emptyText="No teams yet"
        >
          {(ref) => <TeamRadar instanceRef={ref} teams={teams} />}
        </ChartCard>

        <div className="col-span-12">
          <h2 className="mb-2.5 text-sm font-semibold">All teams</h2>
          {summaryQ.isLoading && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-40" />
              ))}
            </div>
          )}
          {summaryQ.error != null && !summaryQ.isLoading && (
            <ErrorCard error={summaryQ.error} onRetry={() => void summaryQ.refetch()} />
          )}
          {summaryQ.data && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {teams.map((t) => (
                <TeamCard key={t.team.id} summary={t} />
              ))}
              {teams.length === 0 && (
                <div className="card col-span-full p-8 text-center text-sm text-muted">
                  No teams yet.{' '}
                  <Link to="/admin/teams" className="text-accent hover:underline">
                    Create your first team →
                  </Link>
                </div>
              )}
            </div>
          )}
          {summaryQ.data && summaryQ.data.unassignedCount > 0 && (
            <p className="mt-3 text-xs text-muted">
              {summaryQ.data.unassignedCount} people are unassigned —{' '}
              <Link to="/admin/teams" className="text-accent hover:underline">
                assign them to teams
              </Link>{' '}
              to make these comparisons meaningful.
            </p>
          )}
        </div>

        <HiddenChartChips />
      </div>
    </ChartPage>
  );
}

function TeamVsTeam({ instanceRef, teams }: { instanceRef: Ref; teams: TeamSummary[] }) {
  const t = useChartTheme();
  const [metricId, setMetricId] = useState<MetricId>('sessions');
  const [absolute, setAbsolute] = useState(false);
  const metric = METRICS.find((m) => m.id === metricId) ?? METRICS[0]!;
  const useAbs = absolute && metric.supportsAbsolute;

  const option = useMemo<EChartsOption>(() => {
    const values = teams.map((team) => ({
      team,
      value: useAbs ? metric.absolute(team) : metric.perActive(team),
    }));
    return {
      textStyle: { color: t.fg, fontFamily: 'inherit' },
      tooltip: {
        trigger: 'axis',
        backgroundColor: t.card,
        borderColor: t.border,
        textStyle: { color: t.fg, fontSize: 12 },
        formatter: (raw: unknown) => {
          // Read from `values` by dataIndex: ECharts reports gap (null) values
          // as NaN/'-' in some paths, so p.value is unreliable for no-data rows.
          const p = asTipArray(raw)[0];
          const v = p?.dataIndex != null ? (values[p.dataIndex]?.value ?? null) : null;
          return `<b>${p?.name ?? ''}</b><br/>${metric.label}${useAbs ? '' : ' / active member'}: <b>${v == null ? '—' : metric.format(v)}</b>`;
        },
      },
      grid: { left: 8, right: 16, top: 16, bottom: 4, containLabel: true },
      xAxis: {
        type: 'value',
        axisLabel: {
          color: t.muted,
          fontSize: 10.5,
          formatter: (v: number) => (metricId === 'cost' ? fmtCost(v) : fmtNumber(v)),
        },
        splitLine: { lineStyle: { color: t.border, opacity: 0.4 } },
      },
      yAxis: {
        type: 'category',
        inverse: true,
        data: values.map((v) => v.team.team.name),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: t.fg, fontSize: 11.5 },
      },
      series: [
        {
          type: 'bar',
          barMaxWidth: 22,
          // null stays null so ECharts renders a gap instead of a 0-length bar
          data: values.map((v) => ({
            value: v.value,
            itemStyle: { color: v.team.team.color, borderRadius: [0, 4, 4, 0] },
          })),
          label: {
            show: true,
            position: 'right',
            color: t.muted,
            fontSize: 10.5,
            formatter: (p: unknown) => {
              const idx = (p as { dataIndex: number }).dataIndex;
              const val = values[idx]?.value;
              return val == null ? '—' : metric.format(val);
            },
          },
        },
      ],
    };
  }, [teams, metric, metricId, useAbs, t]);

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <Segmented
          size="xs"
          options={METRICS.map((m) => ({ id: m.id, label: m.label }))}
          value={metricId}
          onChange={setMetricId}
        />
        <label className="flex items-center gap-1.5 text-[11px] text-muted">
          <Switch checked={useAbs} onCheckedChange={setAbsolute} disabled={!metric.supportsAbsolute} />
          Absolute
        </label>
      </div>
      <EChart option={option} instanceRef={instanceRef} className="h-64" />
    </div>
  );
}

function TeamRadar({ instanceRef, teams }: { instanceRef: Ref; teams: TeamSummary[] }) {
  const t = useChartTheme();
  const [selectedIds, setSelectedIds] = useState<number[]>(() => teams.slice(0, 3).map((x) => x.team.id));
  const shown = teams.filter((x) => selectedIds.includes(x.team.id));

  const toggle = (id: number) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 5) return prev; // max 5
      return [...prev, id];
    });
  };

  const option = useMemo<EChartsOption>(() => {
    return {
      textStyle: { color: t.fg, fontFamily: 'inherit' },
      tooltip: {
        backgroundColor: t.card,
        borderColor: t.border,
        textStyle: { color: t.fg, fontSize: 12 },
      },
      radar: {
        indicator: [
          { name: 'Adoption', max: 100 },
          { name: 'Impact', max: 100 },
          { name: 'Efficiency', max: 100 },
          { name: 'Trust', max: 100 },
          { name: 'Composite', max: 100 },
        ],
        radius: '68%',
        axisName: { color: t.muted, fontSize: 10.5 },
        splitLine: { lineStyle: { color: t.border } },
        splitArea: { areaStyle: { color: ['transparent'] } },
        axisLine: { lineStyle: { color: t.border } },
      },
      series: [
        {
          type: 'radar',
          symbolSize: 3,
          data: shown.map((x) => ({
            name: x.team.name,
            value: [
              x.avgScores.adoption,
              x.avgScores.impact,
              x.avgScores.efficiency,
              x.avgScores.trust,
              x.avgScores.composite,
            ],
            lineStyle: { color: x.team.color, width: 2 },
            itemStyle: { color: x.team.color },
            areaStyle: { color: x.team.color, opacity: 0.07 },
          })),
        },
      ],
    };
  }, [shown, t]);

  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {teams.map((x) => {
          const on = selectedIds.includes(x.team.id);
          const disabled = !on && selectedIds.length >= 5;
          return (
            <button
              key={x.team.id}
              type="button"
              onClick={() => toggle(x.team.id)}
              disabled={disabled}
              title={disabled ? 'Max 5 teams on the radar' : undefined}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors disabled:opacity-40',
                on ? 'border-transparent text-white' : 'border-border text-muted hover:text-fg',
              )}
              style={on ? { background: x.team.color } : undefined}
            >
              <span className="size-1.5 rounded-full" style={{ background: on ? '#fff' : x.team.color }} />
              {x.team.name}
            </button>
          );
        })}
      </div>
      <EChart option={option} instanceRef={instanceRef} className="h-64" />
    </div>
  );
}

function TeamCard({ summary }: { summary: TeamSummary }) {
  const total = SEGMENT_ORDER.reduce((a, tier) => a + (summary.segmentCounts[tier] ?? 0), 0);
  return (
    <Link
      to={`/team/${summary.team.id}`}
      className="card group block p-4 transition-colors hover:border-accent/40"
    >
      <div className="flex items-center gap-2">
        <span className="size-2.5 rounded-full" style={{ background: summary.team.color }} />
        <span className="text-sm font-semibold group-hover:text-accent">{summary.team.name}</span>
        <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted">
          <Users size={11} /> {summary.team.memberCount}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div>
          <div className="text-lg font-semibold">{fmtPct100(summary.activePct)}</div>
          <div className="text-[10px] text-muted">active</div>
        </div>
        <div>
          <div className="text-lg font-semibold">{Math.round(summary.avgScores.composite)}</div>
          <div className="text-[10px] text-muted">avg composite</div>
        </div>
        <div>
          <div className="text-lg font-semibold">{fmtCost(summary.costCents)}</div>
          <div className="text-[10px] text-muted">cost</div>
        </div>
      </div>
      <div className="mt-3">
        <div className="flex h-2 w-full overflow-hidden rounded-full bg-fg/10">
          {SEGMENT_ORDER.map((tier) => {
            const count = summary.segmentCounts[tier] ?? 0;
            if (count === 0 || total === 0) return null;
            const meta = SEGMENT_CATALOG[tier];
            return (
              <span
                key={tier}
                title={`${meta.emoji} ${meta.name}: ${count}`}
                className="block h-2"
                style={{ width: `${(count / total) * 100}%`, background: `var(${meta.cssVar})`, minWidth: 4 }}
              />
            );
          })}
        </div>
        <div className="mt-2 flex items-center justify-between text-[11px] text-muted">
          <span>
            {fmtNumber(summary.sessions)} sessions · {fmtSigned(summary.netLines)} lines
          </span>
          <span>acceptance {fmtPct(summary.acceptanceRate)}</span>
        </div>
      </div>
    </Link>
  );
}
