import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowUp, ShieldAlert } from 'lucide-react';
import type { DecisionSource, GovernanceResponse, Granularity, ReliabilityResponse } from '@dash/shared';
import { useRangeParams } from '@/hooks/useRangeParams';
import { useGovernance, useReliability } from '@/lib/queries';
import { BreakdownDrawer, DrillCount, type BreakdownTarget } from '@/components/BreakdownDrawer';
import { useChartTheme, asTipArray, type ChartTheme } from '@/lib/chartTheme';
import { bucketRows, sumBy } from '@/lib/time';
import { fmtBucket, fmtNumber, fmtPct } from '@/lib/format';
import { ChartCard, ChartPage, HiddenChartChips } from '@/components/ChartCard';
import { EChart, type EChartsOption } from '@/components/EChart';
import type { ChartRef } from '@/components/TrendChart';
import { StatCard } from '@/components/StatCard';
import { StatSkeleton, TableSkeleton } from '@/components/Skeleton';
import { ErrorCard } from '@/components/ErrorCard';
import { Avatar } from '@/components/Avatar';
import { TelemetrySetupCard } from '@/components/TelemetrySetupCard';
import { WhatsCollectedLink } from '@/components/TelemetryPolicyDialog';
import { Tip } from '@/components/ui';
import { cn } from '@/lib/utils';

/** amber above 2%, red above 5% — rate is a 0..1 ratio */
function errorRateClass(rate: number | null): string {
  if (rate === null) return 'text-muted';
  if (rate > 0.05) return 'text-risk';
  if (rate > 0.02) return 'text-warn';
  return 'text-good';
}

function fmtMs(ms: number | null): string {
  if (ms === null || Number.isNaN(ms)) return '—';
  if (ms >= 10_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms).toLocaleString('en-US')} ms`;
}

export default function OrgHealth() {
  const { from, to, gran, teamId } = useRangeParams();
  const reliabilityQ = useReliability({ from, to, teamId });
  const governanceQ = useGovernance({ from, to, teamId });
  const [drill, setDrill] = useState<BreakdownTarget | null>(null);

  const rel = reliabilityQ.data;
  const gov = governanceQ.data;
  const relNoData = !!rel && !rel.hasData;
  const govNoData = !!gov && !gov.hasData;

  if (reliabilityQ.error) {
    return <ErrorCard error={reliabilityQ.error} onRetry={() => void reliabilityQ.refetch()} />;
  }

  return (
    <ChartPage pageId="health">
      <div className="grid grid-cols-12 gap-4">
        {relNoData && govNoData && (
          <TelemetrySetupCard blurb="This view tracks API reliability (errors, refusals, latency) and permission governance from Claude Code’s OpenTelemetry feed." />
        )}

        <SectionHeader title="Reliability" />

        <ReliabilityKpis rel={rel} loading={reliabilityQ.isLoading} noData={relNoData} />

        <ChartCard
          title="Errors over time"
          chartId="error-trend"
          metricKey="errorRate"
          subtitle="API requests (bars) with errors and refusals (lines)"
          className="col-span-12 lg:col-span-8"
          isLoading={reliabilityQ.isLoading}
          isEmpty={relNoData || (!!rel && rel.daily.length === 0)}
          emptyText={relNoData ? 'Waiting for telemetry events' : undefined}
        >
          {(ref) => <ErrorTrend instanceRef={ref} rows={rel?.daily ?? []} gran={gran} />}
        </ChartCard>

        <div className="col-span-12 flex flex-col gap-4 lg:col-span-4">
          <ChartCard
            title="Error status split"
            chartId="error-status-split"
            metricKey="errorRate"
            subtitle="429 rate limits vs 5xx vs other"
            className="flex-1"
            isLoading={reliabilityQ.isLoading}
            isEmpty={
              relNoData ||
              (!!rel &&
                rel.errorStatuses.e429 + rel.errorStatuses.e5xx + rel.errorStatuses.other === 0)
            }
            emptyText={relNoData ? 'Waiting for telemetry events' : 'No API errors in this range 🎉'}
          >
            {(ref) => <ErrorStatusDonut instanceRef={ref} rel={rel} />}
          </ChartCard>
          <StatCard
            label="Compactions"
            {...(relNoData || !rel ? { display: '—' } : { value: rel.totals.compactions })}
            metricKey="compactions"
            footer={
              relNoData || !rel
                ? 'Waiting for telemetry'
                : `${fmtNumber(rel.totals.internalErrors)} internal CLI errors in range`
            }
          />
        </div>

        <ChartCard
          title="Reliability by model"
          chartId="reliability-by-model"
          metricKey="errorRate"
          className="col-span-12"
          noExport
          isEmpty={relNoData || (!!rel && rel.byModel.length === 0)}
          emptyText={relNoData ? 'Waiting for telemetry events' : 'No per-model telemetry in this range'}
        >
          {reliabilityQ.isLoading ? (
            <TableSkeleton rows={4} cols={5} />
          ) : (
            <ByModelTable rows={rel?.byModel ?? []} onDrill={setDrill} />
          )}
        </ChartCard>

        <SectionHeader title="Governance" />

        {governanceQ.error ? (
          <div className="col-span-12">
            <ErrorCard error={governanceQ.error} onRetry={() => void governanceQ.refetch()} />
          </div>
        ) : (
          <>
            <ChartCard
              title="Approval sources"
              chartId="decision-sources"
              metricKey="decisionSources"
              subtitle="How tool permissions get decided across the org"
              className="col-span-12 lg:col-span-7"
              isLoading={governanceQ.isLoading}
              isEmpty={
                govNoData ||
                (!!gov && Object.values(gov.decisionSources).every((v) => v === 0))
              }
              emptyText={govNoData ? 'Waiting for telemetry events' : 'No tool decisions in this range'}
            >
              {(ref) => <DecisionSourcesStacked instanceRef={ref} gov={gov} />}
            </ChartCard>

            <ChartCard
              title="Permission modes"
              chartId="permission-modes"
              metricKey="permissionModes"
              subtitle="Mode switches per target mode"
              className="col-span-12 lg:col-span-5"
              noExport
              isLoading={governanceQ.isLoading}
              isEmpty={govNoData || (!!gov && gov.permissionModes.length === 0)}
              emptyText={govNoData ? 'Waiting for telemetry events' : 'No mode changes in this range'}
            >
              <PermissionModesTable rows={gov?.permissionModes ?? []} onDrill={setDrill} />
            </ChartCard>

            <ChartCard
              title="Governance per person"
              chartId="governance-per-user"
              metricKey="decisionSources"
              infoExtra="Auto-approved = decisions made by config, hooks, or a remembered “always allow” — a high share means a tuned allowlist, not recklessness."
              className="col-span-12"
              noExport
              isEmpty={govNoData || (!!gov && gov.perUser.length === 0)}
              emptyText={govNoData ? 'Waiting for telemetry events' : 'No per-user telemetry in this range'}
            >
              {governanceQ.isLoading ? (
                <TableSkeleton rows={5} cols={5} />
              ) : (
                <PerUserGovernanceTable rows={gov?.perUser ?? []} />
              )}
            </ChartCard>
          </>
        )}

        <div className="col-span-12">
          <WhatsCollectedLink />
        </div>

        <HiddenChartChips />
      </div>
      <BreakdownDrawer target={drill} onClose={() => setDrill(null)} range={{ from, to, teamId }} />
    </ChartPage>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="col-span-12 mt-1 text-xs font-semibold uppercase tracking-wider text-muted first:mt-0">
      {title}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reliability KPIs
// ---------------------------------------------------------------------------

function ReliabilityKpis({
  rel,
  loading,
  noData,
}: {
  rel: ReliabilityResponse | undefined;
  loading: boolean;
  noData: boolean;
}) {
  if (loading || !rel) {
    return (
      <div className="col-span-12 grid grid-cols-2 gap-4 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <StatSkeleton key={i} />
        ))}
      </div>
    );
  }
  const { totals } = rel;
  return (
    <div className="col-span-12 grid grid-cols-2 gap-4 xl:grid-cols-4">
      <StatCard
        label="API requests"
        {...(noData ? { display: '—' } : { value: totals.apiRequests })}
        metricKey="errorRate"
        footer={noData ? 'Waiting for telemetry' : `${fmtNumber(totals.apiErrors)} failed`}
      />
      <StatCard
        label="Error rate"
        {...(noData || totals.errorRate === null
          ? { display: '—' }
          : { value: totals.errorRate * 100, format: (v: number) => `${v.toFixed(1)}%` })}
        valueClassName={noData ? undefined : errorRateClass(totals.errorRate)}
        metricKey="errorRate"
        footer={noData ? 'Waiting for telemetry' : 'amber above 2% · red above 5%'}
      />
      <StatCard
        label="Refusals"
        {...(noData ? { display: '—' } : { value: totals.refusals })}
        metricKey="refusals"
        footer={noData ? 'Waiting for telemetry' : 'requests Claude declined'}
      />
      <StatCard
        label="Avg latency"
        {...(noData || totals.avgRequestMs === null
          ? { display: '—' }
          : { value: totals.avgRequestMs, format: (v: number) => fmtMs(v) })}
        metricKey="errorRate"
        footer={noData ? 'Waiting for telemetry' : 'mean API request duration'}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Error trend
// ---------------------------------------------------------------------------

function ErrorTrend({
  instanceRef,
  rows,
  gran,
}: {
  instanceRef: ChartRef;
  rows: ReliabilityResponse['daily'];
  gran: Granularity;
}) {
  const t = useChartTheme();
  const option = useMemo<EChartsOption>(() => {
    const buckets = bucketRows(rows, gran);
    const labels = buckets.map((b) => fmtBucket(b.bucket, gran));
    return {
      textStyle: { color: t.fg, fontFamily: 'inherit' },
      tooltip: {
        trigger: 'axis',
        backgroundColor: t.card,
        borderColor: t.border,
        textStyle: { color: t.fg, fontSize: 12 },
      },
      legend: { top: 0, right: 0, textStyle: { color: t.muted, fontSize: 10.5 }, icon: 'circle', itemWidth: 8 },
      grid: { left: 8, right: 8, top: 30, bottom: 4, containLabel: true },
      xAxis: {
        type: 'category',
        data: labels,
        axisLine: { lineStyle: { color: t.border } },
        axisTick: { show: false },
        axisLabel: { color: t.muted, fontSize: 10.5 },
      },
      yAxis: [
        {
          type: 'value',
          name: 'requests',
          nameTextStyle: { color: t.muted, fontSize: 10 },
          axisLabel: { color: t.muted, fontSize: 10.5, formatter: (v: number) => fmtNumber(v) },
          splitLine: { lineStyle: { color: t.border, opacity: 0.5 } },
        },
        {
          type: 'value',
          name: 'errors',
          nameTextStyle: { color: t.muted, fontSize: 10 },
          minInterval: 1,
          axisLabel: { color: t.muted, fontSize: 10.5 },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: 'API requests',
          type: 'bar',
          barMaxWidth: 22,
          itemStyle: { color: t.accent, opacity: 0.85, borderRadius: [3, 3, 0, 0] },
          data: buckets.map((b) => sumBy(b.rows, (r) => r.apiRequests)),
        },
        {
          name: 'Errors',
          type: 'line',
          yAxisIndex: 1,
          smooth: true,
          symbolSize: 5,
          lineStyle: { color: t.risk, width: 2 },
          itemStyle: { color: t.risk },
          data: buckets.map((b) => sumBy(b.rows, (r) => r.apiErrors)),
        },
        {
          name: 'Refusals',
          type: 'line',
          yAxisIndex: 1,
          smooth: true,
          symbolSize: 4,
          lineStyle: { color: t.warn, width: 1.5, type: 'dashed' },
          itemStyle: { color: t.warn },
          data: buckets.map((b) => sumBy(b.rows, (r) => r.refusals)),
        },
      ],
    };
  }, [rows, gran, t]);
  return <EChart option={option} instanceRef={instanceRef} className="h-72" />;
}

// ---------------------------------------------------------------------------
// Error status donut
// ---------------------------------------------------------------------------

function ErrorStatusDonut({
  instanceRef,
  rel,
}: {
  instanceRef: ChartRef;
  rel: ReliabilityResponse | undefined;
}) {
  const t = useChartTheme();
  const option = useMemo<EChartsOption>(() => {
    const st = rel?.errorStatuses ?? { e429: 0, e5xx: 0, other: 0 };
    const data = [
      { name: '429 rate limited', value: st.e429, itemStyle: { color: t.warn } },
      { name: '5xx server', value: st.e5xx, itemStyle: { color: t.risk } },
      { name: 'Other', value: st.other, itemStyle: { color: t.muted } },
    ].filter((d) => d.value > 0);
    return {
      textStyle: { color: t.fg, fontFamily: 'inherit' },
      tooltip: {
        backgroundColor: t.card,
        borderColor: t.border,
        textStyle: { color: t.fg, fontSize: 12 },
        formatter: (raw: unknown) => {
          const p = asTipArray(raw)[0] ?? {};
          return `${p.marker ?? ''}<b>${p.name ?? ''}</b>: ${fmtNumber(typeof p.value === 'number' ? p.value : 0)} (${p.percent ?? 0}%)`;
        },
      },
      legend: {
        orient: 'vertical',
        right: 0,
        top: 'middle',
        textStyle: { color: t.muted, fontSize: 10.5 },
        icon: 'circle',
        itemWidth: 8,
      },
      series: [
        {
          type: 'pie',
          radius: ['52%', '78%'],
          center: ['32%', '50%'],
          itemStyle: { borderColor: t.card, borderWidth: 2 },
          label: { show: false },
          data,
        },
      ],
    };
  }, [rel, t]);
  return <EChart option={option} instanceRef={instanceRef} className="h-48" />;
}

// ---------------------------------------------------------------------------
// By-model table
// ---------------------------------------------------------------------------

function ByModelTable({
  rows,
  onDrill,
}: {
  rows: ReliabilityResponse['byModel'];
  onDrill: (t: BreakdownTarget) => void;
}) {
  const sorted = useMemo(() => [...rows].sort((a, b) => b.apiRequests - a.apiRequests), [rows]);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border">
            {['Model', 'Requests', 'Error rate', 'Refusals', 'Avg latency'].map((h, i) => (
              <th
                key={h}
                className={cn(
                  'whitespace-nowrap px-2.5 py-2 text-[10.5px] font-semibold uppercase tracking-wider text-muted',
                  i > 0 && 'text-right',
                )}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((m) => (
            <tr key={m.model} className="border-b border-border/60 transition-colors hover:bg-fg/[0.025]">
              <td className="max-w-64 truncate px-2.5 py-2 text-[12.5px] font-medium" title={m.model}>
                <button
                  type="button"
                  onClick={() =>
                    onDrill({
                      dimension: 'model-reliability',
                      entity: m.model,
                      title: `Reliability · ${m.model}`,
                    })
                  }
                  title={`${m.model} — see who hits errors`}
                  className="truncate underline decoration-dotted underline-offset-2 transition-colors hover:text-accent"
                >
                  {m.model}
                </button>
              </td>
              <td className="whitespace-nowrap px-2.5 py-2 text-right text-[12.5px]">
                {fmtNumber(m.apiRequests)}
              </td>
              <td
                className={cn(
                  'whitespace-nowrap px-2.5 py-2 text-right text-xs font-medium',
                  errorRateClass(m.errorRate),
                )}
              >
                {fmtPct(m.errorRate, 1)}
              </td>
              <td className="whitespace-nowrap px-2.5 py-2 text-right text-xs text-muted">
                {fmtNumber(m.refusals)}
              </td>
              <td className="whitespace-nowrap px-2.5 py-2 text-right text-xs text-muted">
                {fmtMs(m.avgRequestMs)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Governance: decision sources stacked bar
// ---------------------------------------------------------------------------

const DECISION_META: Array<{ key: DecisionSource; label: string; color: (t: ChartTheme) => string }> = [
  { key: 'config', label: 'Config allowlist', color: (t) => t.good },
  { key: 'hook', label: 'Hook', color: (t) => t.palette[2] ?? t.accent2 },
  { key: 'user_permanent', label: 'Always allow', color: (t) => t.accent },
  { key: 'user_temporary', label: 'One-off allow', color: (t) => t.accent2 },
  { key: 'user_abort', label: 'Aborted', color: (t) => t.warn },
  { key: 'user_reject', label: 'Rejected', color: (t) => t.risk },
];

function DecisionSourcesStacked({
  instanceRef,
  gov,
}: {
  instanceRef: ChartRef;
  gov: GovernanceResponse | undefined;
}) {
  const t = useChartTheme();
  const option = useMemo<EChartsOption>(() => {
    const sources = gov?.decisionSources;
    const total = DECISION_META.reduce((acc, m) => acc + (sources?.[m.key] ?? 0), 0) || 1;
    return {
      textStyle: { color: t.fg, fontFamily: 'inherit' },
      tooltip: {
        backgroundColor: t.card,
        borderColor: t.border,
        textStyle: { color: t.fg, fontSize: 12 },
        formatter: (raw: unknown) => {
          const p = asTipArray(raw)[0] ?? {};
          const v = typeof p.value === 'number' ? p.value : 0;
          return `${p.marker ?? ''}<b>${p.seriesName ?? ''}</b>: ${fmtNumber(v)} (${fmtPct(v / total)})`;
        },
      },
      legend: { bottom: 0, textStyle: { color: t.muted, fontSize: 10.5 }, icon: 'circle', itemWidth: 8 },
      grid: { left: 8, right: 16, top: 16, bottom: 44, containLabel: true },
      xAxis: {
        type: 'value',
        axisLabel: { color: t.muted, fontSize: 10.5, formatter: (v: number) => fmtNumber(v) },
        splitLine: { lineStyle: { color: t.border, opacity: 0.4 } },
      },
      yAxis: {
        type: 'category',
        data: ['Decisions'],
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { show: false },
      },
      series: DECISION_META.map((m) => {
        const value = sources?.[m.key] ?? 0;
        const pct = value / total;
        return {
          name: m.label,
          type: 'bar' as const,
          stack: 'sources',
          barMaxWidth: 46,
          itemStyle: { color: m.color(t) },
          label: {
            show: pct >= 0.05,
            color: '#fff',
            fontSize: 10.5,
            formatter: () => fmtPct(pct),
          },
          data: [value],
        };
      }),
    };
  }, [gov, t]);
  return <EChart option={option} instanceRef={instanceRef} className="h-44" />;
}

// ---------------------------------------------------------------------------
// Permission modes table
// ---------------------------------------------------------------------------

/** Modes that skip or weaken the permission prompt deserve a visible flag. */
const isBypassy = (mode: string) =>
  /bypass|dontask|dont_ask|yolo|dangerous/i.test(mode) || mode === 'acceptEdits';

function PermissionModesTable({
  rows,
  onDrill,
}: {
  rows: GovernanceResponse['permissionModes'];
  onDrill: (t: BreakdownTarget) => void;
}) {
  const sorted = useMemo(() => [...rows].sort((a, b) => b.changes - a.changes), [rows]);
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b border-border">
          {['Mode', 'Changes', 'Users'].map((h, i) => (
            <th
              key={h}
              className={cn(
                'whitespace-nowrap px-2.5 py-2 text-[10.5px] font-semibold uppercase tracking-wider text-muted',
                i > 0 && 'text-right',
              )}
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {sorted.map((m) => (
          <tr key={m.mode} className="border-b border-border/60 transition-colors hover:bg-fg/[0.025]">
            <td className="px-2.5 py-2">
              <span className="inline-flex items-center gap-1.5">
                <span className="font-mono text-[12px]">{m.mode}</span>
                {isBypassy(m.mode) && (
                  <Tip content="This mode skips or weakens permission prompts — worth knowing who uses it.">
                    <span className="inline-flex items-center gap-1 rounded-full border border-warn/40 bg-warn/10 px-1.5 py-px text-[9.5px] font-semibold uppercase tracking-wide text-warn">
                      <ShieldAlert size={9} /> bypass
                    </span>
                  </Tip>
                )}
              </span>
            </td>
            <td className="whitespace-nowrap px-2.5 py-2 text-right text-[12.5px] font-medium">
              {fmtNumber(m.changes)}
            </td>
            <td className="whitespace-nowrap px-2.5 py-2 text-right text-xs text-muted">
              <DrillCount
                value={m.users}
                onClick={() =>
                  onDrill({
                    dimension: 'permission-mode',
                    entity: m.mode,
                    title: `Permission mode · ${m.mode}`,
                  })
                }
              />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------------
// Per-user governance table (sortable)
// ---------------------------------------------------------------------------

type GovRow = GovernanceResponse['perUser'][number];
type GovSortKey = 'name' | 'autoApprovedShare' | 'rejects' | 'aborts' | 'modeChanges';

const GOV_SORTERS: Record<GovSortKey, (u: GovRow) => number | string> = {
  name: (u) => u.name.toLowerCase(),
  autoApprovedShare: (u) => u.autoApprovedShare ?? -1,
  rejects: (u) => u.rejects,
  aborts: (u) => u.aborts,
  modeChanges: (u) => u.modeChanges,
};

function GovTh({
  label,
  sortKey,
  sort,
  onSort,
  align = 'left',
}: {
  label: string;
  sortKey: GovSortKey;
  sort: { key: GovSortKey; dir: 1 | -1 };
  onSort: (k: GovSortKey) => void;
  align?: 'left' | 'right';
}) {
  const active = sort.key === sortKey;
  return (
    <th
      className={cn(
        'whitespace-nowrap px-2.5 py-2 text-[10.5px] font-semibold uppercase tracking-wider text-muted',
        align === 'right' && 'text-right',
      )}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          'inline-flex items-center gap-0.5 uppercase tracking-wider transition-colors hover:text-fg',
          active && 'text-fg',
        )}
      >
        {label}
        {active && (sort.dir === -1 ? <ArrowDown size={10} /> : <ArrowUp size={10} />)}
      </button>
    </th>
  );
}

function PerUserGovernanceTable({ rows }: { rows: GovernanceResponse['perUser'] }) {
  const [sort, setSort] = useState<{ key: GovSortKey; dir: 1 | -1 }>({
    key: 'autoApprovedShare',
    dir: -1,
  });

  const onSort = (key: GovSortKey) =>
    setSort((s) =>
      s.key === key ? { key, dir: s.dir === -1 ? 1 : -1 } : { key, dir: key === 'name' ? 1 : -1 },
    );

  const sorted = useMemo(() => {
    const sorter = GOV_SORTERS[sort.key];
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

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border">
            <GovTh label="Member" sortKey="name" sort={sort} onSort={onSort} />
            <GovTh label="Auto-approved" sortKey="autoApprovedShare" sort={sort} onSort={onSort} align="right" />
            <GovTh label="Rejects" sortKey="rejects" sort={sort} onSort={onSort} align="right" />
            <GovTh label="Aborts" sortKey="aborts" sort={sort} onSort={onSort} align="right" />
            <GovTh label="Mode changes" sortKey="modeChanges" sort={sort} onSort={onSort} align="right" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((u) => (
            <tr key={u.userId} className="border-b border-border/60 transition-colors hover:bg-fg/[0.025]">
              <td className="px-2.5 py-2">
                <Link
                  to={`/user/${encodeURIComponent(u.email ?? String(u.userId))}`}
                  className="group inline-flex items-center gap-2.5"
                >
                  <Avatar name={u.name} email={u.email} size={26} />
                  <span className="truncate text-[13px] font-medium group-hover:text-accent group-hover:underline">
                    {u.name}
                  </span>
                </Link>
              </td>
              <td className="whitespace-nowrap px-2.5 py-2 text-right text-[13px] font-medium">
                {fmtPct(u.autoApprovedShare)}
              </td>
              <td
                className={cn(
                  'whitespace-nowrap px-2.5 py-2 text-right text-xs',
                  u.rejects > 0 ? 'font-medium text-risk' : 'text-muted',
                )}
              >
                {fmtNumber(u.rejects)}
              </td>
              <td className="whitespace-nowrap px-2.5 py-2 text-right text-xs text-muted">
                {fmtNumber(u.aborts)}
              </td>
              <td className="whitespace-nowrap px-2.5 py-2 text-right text-xs text-muted">
                {fmtNumber(u.modeChanges)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
