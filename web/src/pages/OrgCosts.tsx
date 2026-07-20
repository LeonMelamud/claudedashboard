import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowUp } from 'lucide-react';
import type {
  ApiKeyRow,
  CostType,
  CostsResponse,
  DimensionSlice,
  DimensionsResponse,
  Granularity,
  TokenTotals,
} from '@dash/shared';
import { useRangeParams } from '@/hooks/useRangeParams';
import { useApiKeys, useCapabilities, useCosts, useDimensions } from '@/lib/queries';
import { useChartTheme, asTipArray, type ChartTheme } from '@/lib/chartTheme';
import { bucketRows, sumBy } from '@/lib/time';
import { daysSince, fmtBucket, fmtCost, fmtNumber, fmtPct, fmtTokens, relativeDate } from '@/lib/format';
import { ChartCard, ChartPage, HiddenChartChips } from '@/components/ChartCard';
import { EChart, type EChartsOption } from '@/components/EChart';
import type { ChartRef } from '@/components/TrendChart';
import { StatCard } from '@/components/StatCard';
import { StatSkeleton, TableSkeleton } from '@/components/Skeleton';
import { ErrorCard } from '@/components/ErrorCard';
import { cn } from '@/lib/utils';

const totalTokens = (t: TokenTotals) => t.input + t.output + t.cacheRead + t.cacheCreation;

export default function OrgCosts() {
  const { from, to, gran } = useRangeParams();
  const caps = useCapabilities().data?.capabilities;
  // capability gates: unknown (still loading) counts as visible
  const showApiKeys = caps?.apiKeys !== false;
  const showDimensions = caps?.dimensions !== false;
  const showTierMix = caps?.tierMix !== false;
  const showWebSearch = caps?.webSearchCounts !== false;
  const anyDimCards = showDimensions || showTierMix || showWebSearch;

  const costsQ = useCosts({ from, to });
  const apiKeysQ = useApiKeys({ from, to }, showApiKeys);
  const dimensionsQ = useDimensions({ from, to }, anyDimCards);

  const costs = costsQ.data;
  const dims = dimensionsQ.data;
  const costsNoData = !!costs && !costs.hasData;
  const dimsNoData = !!dims && !dims.hasData;

  return (
    <ChartPage pageId="costs">
      <div className="grid grid-cols-12 gap-4">
        {costsQ.error ? (
          <div className="col-span-12">
            <ErrorCard error={costsQ.error} onRetry={() => void costsQ.refetch()} />
          </div>
        ) : costsNoData ? (
          <NoDataCard />
        ) : (
          <>
            <KpiRow costs={costs} loading={costsQ.isLoading} />

            <ChartCard
              title="Actual cost over time"
              chartId="actual-cost-over-time"
              metricKey="trueCost"
              subtitle="Invoice-grade spend, stacked by cost type"
              className="col-span-12 lg:col-span-7"
              isLoading={costsQ.isLoading}
              error={costsQ.error}
              onRetry={() => void costsQ.refetch()}
              isEmpty={!!costs && costs.actualDaily.length === 0}
            >
              {(ref) => <ActualCostChart instanceRef={ref} rows={costs?.actualDaily ?? []} gran={gran} />}
            </ChartCard>

            <ChartCard
              title="Estimated vs actual"
              chartId="estimated-vs-actual"
              metricKey="estimatedVsActual"
              subtitle="Claude Code estimates (dashed) vs billed spend"
              className="col-span-12 lg:col-span-5"
              isLoading={costsQ.isLoading}
              error={costsQ.error}
              onRetry={() => void costsQ.refetch()}
              isEmpty={!!costs && costs.estimatedVsActual.length === 0}
            >
              {(ref) => (
                <EstimatedVsActualChart instanceRef={ref} rows={costs?.estimatedVsActual ?? []} gran={gran} />
              )}
            </ChartCard>

            <ChartCard
              title="Cost by workspace"
              chartId="cost-by-workspace"
              metricKey="trueCost"
              subtitle="Billed spend per Anthropic workspace"
              className="col-span-12 lg:col-span-7"
              isLoading={costsQ.isLoading}
              error={costsQ.error}
              onRetry={() => void costsQ.refetch()}
              isEmpty={!!costs && costs.byWorkspace.length === 0}
            >
              {(ref) => <CostByWorkspace instanceRef={ref} rows={costs?.byWorkspace ?? []} />}
            </ChartCard>

            <ChartCard
              title="Cost by model"
              chartId="cost-by-model-donut"
              metricKey="costByModel"
              subtitle="Billed spend per model"
              className="col-span-12 lg:col-span-5"
              isLoading={costsQ.isLoading}
              error={costsQ.error}
              onRetry={() => void costsQ.refetch()}
              isEmpty={!!costs && costs.byModel.length === 0}
            >
              {(ref) => <CostModelDonut instanceRef={ref} rows={costs?.byModel ?? []} />}
            </ChartCard>
          </>
        )}

        {showApiKeys && (
          <ChartCard
            title="API keys"
            chartId="api-keys"
            infoExtra="Key inventory with per-key token volume. The cost report has no per-key dimension, so keys show tokens and share of volume rather than dollars."
            className="col-span-12"
            noExport
            error={apiKeysQ.error}
            onRetry={() => void apiKeysQ.refetch()}
            isEmpty={!!apiKeysQ.data && apiKeysQ.data.keys.length === 0}
            emptyText="No API keys found for this range"
          >
            {apiKeysQ.isLoading ? (
              <TableSkeleton rows={5} cols={7} />
            ) : (
              <ApiKeysTable keys={apiKeysQ.data?.keys ?? []} />
            )}
          </ChartCard>
        )}

        {!anyDimCards ? null : dimsNoData ? (
          !costsNoData && <NoDataCard />
        ) : (
          <>
            {showDimensions && (
              <ServiceTierCard
                dims={dims}
                isLoading={dimensionsQ.isLoading}
                error={dimensionsQ.error}
                onRetry={() => void dimensionsQ.refetch()}
              />
            )}

            {showDimensions && (
              <ChartCard
                title="Context window mix"
                chartId="context-window-mix"
                metricKey="contextWindow"
                subtitle="Tokens by request context size"
                className="col-span-12 md:col-span-6 lg:col-span-4"
                isLoading={dimensionsQ.isLoading}
                error={dimensionsQ.error}
                onRetry={() => void dimensionsQ.refetch()}
                isEmpty={!!dims && dims.contextWindow.length === 0}
              >
                {(ref) => <DimensionDonut instanceRef={ref} slices={dims?.contextWindow ?? []} />}
              </ChartCard>
            )}

            {showTierMix && (
              <ChartCard
                title="API vs subscription"
                chartId="customer-type"
                metricKey="customerType"
                subtitle="Sessions and estimated cost by billing type"
                className="col-span-12 md:col-span-6 lg:col-span-4"
                isLoading={dimensionsQ.isLoading}
                error={dimensionsQ.error}
                onRetry={() => void dimensionsQ.refetch()}
                isEmpty={!!dims && dims.customerType.length === 0}
              >
                {(ref) => <CustomerTypeChart instanceRef={ref} rows={dims?.customerType ?? []} />}
              </ChartCard>
            )}

            {showWebSearch && (
              <WebSearchCard
                dims={dims}
                isLoading={dimensionsQ.isLoading}
                error={dimensionsQ.error}
                onRetry={() => void dimensionsQ.refetch()}
              />
            )}
          </>
        )}

        <HiddenChartChips />
      </div>
    </ChartPage>
  );
}

// ---------------------------------------------------------------------------
// Friendly no-data card
// ---------------------------------------------------------------------------

function NoDataCard() {
  return (
    <div className="card col-span-12 flex flex-col items-center justify-center gap-2 p-10 text-center">
      <div className="text-3xl opacity-60">🧾</div>
      <div className="text-sm font-medium">No cost report data synced yet</div>
      <p className="max-w-md text-xs leading-relaxed text-muted">
        Run a sync from{' '}
        <Link to="/admin/sync" className="text-accent hover:underline">
          Admin → Sync
        </Link>{' '}
        to pull invoice-grade costs and usage dimensions from the Anthropic Admin API.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// KPI row
// ---------------------------------------------------------------------------

function KpiRow({ costs, loading }: { costs: CostsResponse | undefined; loading: boolean }) {
  if (loading || !costs) {
    return (
      <div className="col-span-12 grid grid-cols-2 gap-4 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <StatSkeleton key={i} />
        ))}
      </div>
    );
  }
  const { totals } = costs;
  const delta = totals.estimatedCents - totals.actualCents;
  const deltaPct = totals.actualCents > 0 ? Math.round((delta / totals.actualCents) * 100) : null;
  return (
    <div className="col-span-12 grid grid-cols-2 gap-4 xl:grid-cols-4">
      <StatCard
        label="Actual spend"
        value={totals.actualCents}
        format={fmtCost}
        metricKey="trueCost"
        footer="Invoice-grade, from the cost report"
      />
      <StatCard
        label="Estimated"
        value={totals.estimatedCents}
        format={fmtCost}
        metricKey="estimatedVsActual"
        footer={`Δ vs actual ${delta > 0 ? '+' : ''}${fmtCost(delta)}${
          deltaPct !== null ? ` (${deltaPct > 0 ? '+' : ''}${deltaPct}%)` : ''
        }`}
      />
      <StatCard
        label="Web search cost"
        value={totals.webSearchCents}
        format={fmtCost}
        metricKey="webSearch"
        footer="Per-call web search charges"
      />
      <StatCard
        label="Code execution cost"
        value={totals.codeExecutionCents}
        format={fmtCost}
        metricKey="trueCost"
        footer="Sandboxed code execution charges"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cost charts
// ---------------------------------------------------------------------------

const COST_TYPE_ORDER: CostType[] = ['tokens', 'web_search', 'code_execution', 'session_usage', 'other'];

const COST_TYPE_LABELS: Record<CostType, string> = {
  tokens: 'Tokens',
  web_search: 'Web search',
  code_execution: 'Code execution',
  session_usage: 'Session usage',
  other: 'Other',
};

/** Stable per-cost-type colors regardless of which types are present. */
function costTypeColor(t: ChartTheme, ct: CostType): string {
  switch (ct) {
    case 'tokens':
      return t.palette[0] ?? t.accent;
    case 'web_search':
      return t.palette[2] ?? t.accent2;
    case 'code_execution':
      return t.palette[1] ?? t.accent2;
    case 'session_usage':
      return t.palette[6] ?? t.good;
    case 'other':
      return t.palette[7] ?? t.muted;
  }
}

function costTooltip(t: ChartTheme) {
  return {
    trigger: 'axis' as const,
    backgroundColor: t.card,
    borderColor: t.border,
    textStyle: { color: t.fg, fontSize: 12 },
    formatter: (raw: unknown) => {
      const items = asTipArray(raw);
      const head = items[0]?.name ?? '';
      const lines = items
        .filter((p) => typeof p.value === 'number' && p.value > 0)
        .map((p) => `${p.marker ?? ''}${p.seriesName ?? ''}: <b>${fmtCost(p.value as number)}</b>`);
      const total = items.reduce((acc, p) => acc + (typeof p.value === 'number' ? p.value : 0), 0);
      return `<div style="font-size:11px">${head}</div>${lines.join('<br/>')}<div style="margin-top:2px;border-top:1px solid ${t.border};padding-top:2px">Total: <b>${fmtCost(total)}</b></div>`;
    },
  };
}

function ActualCostChart({
  instanceRef,
  rows,
  gran,
}: {
  instanceRef: ChartRef;
  rows: CostsResponse['actualDaily'];
  gran: Granularity;
}) {
  const t = useChartTheme();
  const option = useMemo<EChartsOption>(() => {
    const buckets = bucketRows(rows, gran);
    const labels = buckets.map((b) => fmtBucket(b.bucket, gran));
    const types = COST_TYPE_ORDER.filter((ct) => rows.some((r) => (r.byCostType[ct] ?? 0) > 0));
    return {
      textStyle: { color: t.fg, fontFamily: 'inherit' },
      tooltip: costTooltip(t),
      legend: { top: 0, right: 0, textStyle: { color: t.muted, fontSize: 10.5 }, icon: 'circle', itemWidth: 8 },
      grid: { left: 8, right: 8, top: 30, bottom: 4, containLabel: true },
      xAxis: {
        type: 'category',
        data: labels,
        axisLine: { lineStyle: { color: t.border } },
        axisTick: { show: false },
        axisLabel: { color: t.muted, fontSize: 10.5 },
      },
      yAxis: {
        type: 'value',
        axisLabel: { color: t.muted, fontSize: 10.5, formatter: (v: number) => fmtCost(v) },
        splitLine: { lineStyle: { color: t.border, opacity: 0.5 } },
      },
      series: types.map((ct) => ({
        name: COST_TYPE_LABELS[ct],
        type: 'bar' as const,
        stack: 'cost',
        barMaxWidth: 26,
        emphasis: { focus: 'series' as const },
        itemStyle: { color: costTypeColor(t, ct), opacity: 0.9 },
        data: buckets.map((b) => sumBy(b.rows, (r) => r.byCostType[ct] ?? 0)),
      })),
    };
  }, [rows, gran, t]);
  return <EChart option={option} instanceRef={instanceRef} className="h-72" />;
}

function EstimatedVsActualChart({
  instanceRef,
  rows,
  gran,
}: {
  instanceRef: ChartRef;
  rows: CostsResponse['estimatedVsActual'];
  gran: Granularity;
}) {
  const t = useChartTheme();
  const option = useMemo<EChartsOption>(() => {
    const buckets = bucketRows(rows, gran);
    const labels = buckets.map((b) => fmtBucket(b.bucket, gran));
    return {
      textStyle: { color: t.fg, fontFamily: 'inherit' },
      tooltip: costTooltip(t),
      legend: { top: 0, right: 0, textStyle: { color: t.muted, fontSize: 10.5 }, icon: 'circle', itemWidth: 8 },
      grid: { left: 8, right: 8, top: 30, bottom: 4, containLabel: true },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: labels,
        axisLine: { lineStyle: { color: t.border } },
        axisTick: { show: false },
        axisLabel: { color: t.muted, fontSize: 10.5 },
      },
      yAxis: {
        type: 'value',
        axisLabel: { color: t.muted, fontSize: 10.5, formatter: (v: number) => fmtCost(v) },
        splitLine: { lineStyle: { color: t.border, opacity: 0.5 } },
      },
      series: [
        {
          name: 'Actual',
          type: 'line',
          smooth: true,
          symbol: 'none',
          lineStyle: { color: t.accent, width: 2 },
          itemStyle: { color: t.accent },
          areaStyle: { color: t.accent, opacity: 0.1 },
          data: buckets.map((b) => sumBy(b.rows, (r) => r.actualCents)),
        },
        {
          name: 'Estimated',
          type: 'line',
          smooth: true,
          symbol: 'none',
          lineStyle: { color: t.accent2, width: 2, type: 'dashed' },
          itemStyle: { color: t.accent2 },
          data: buckets.map((b) => sumBy(b.rows, (r) => r.estimatedCents)),
        },
      ],
    };
  }, [rows, gran, t]);
  return <EChart option={option} instanceRef={instanceRef} className="h-72" />;
}

function CostByWorkspace({
  instanceRef,
  rows,
}: {
  instanceRef: ChartRef;
  rows: CostsResponse['byWorkspace'];
}) {
  const t = useChartTheme();
  const option = useMemo<EChartsOption>(() => {
    // ascending so the biggest workspace renders at the top of the category axis
    const sorted = [...rows].sort((a, b) => a.totalCents - b.totalCents);
    return {
      textStyle: { color: t.fg, fontFamily: 'inherit' },
      tooltip: {
        backgroundColor: t.card,
        borderColor: t.border,
        textStyle: { color: t.fg, fontSize: 12 },
        formatter: (raw: unknown) => {
          const p = asTipArray(raw)[0] ?? {};
          return `${p.marker ?? ''}<b>${p.name ?? ''}</b>: ${fmtCost(typeof p.value === 'number' ? p.value : 0)}`;
        },
      },
      grid: { left: 8, right: 48, top: 8, bottom: 4, containLabel: true },
      xAxis: {
        type: 'value',
        axisLabel: { color: t.muted, fontSize: 10.5, formatter: (v: number) => fmtCost(v) },
        splitLine: { lineStyle: { color: t.border, opacity: 0.5 } },
      },
      yAxis: {
        type: 'category',
        data: sorted.map((r) => r.workspaceName || 'No workspace'),
        axisLine: { lineStyle: { color: t.border } },
        axisTick: { show: false },
        axisLabel: { color: t.muted, fontSize: 11 },
      },
      series: [
        {
          type: 'bar',
          barMaxWidth: 18,
          itemStyle: { color: t.accent, opacity: 0.9, borderRadius: [0, 3, 3, 0] },
          label: {
            show: true,
            position: 'right',
            color: t.muted,
            fontSize: 10.5,
            formatter: (p: { value?: unknown }) => fmtCost(typeof p.value === 'number' ? p.value : 0),
          },
          data: sorted.map((r) => r.totalCents),
        },
      ],
    };
  }, [rows, t]);
  return <EChart option={option} instanceRef={instanceRef} className="h-72" />;
}

function CostModelDonut({
  instanceRef,
  rows,
}: {
  instanceRef: ChartRef;
  rows: CostsResponse['byModel'];
}) {
  const t = useChartTheme();
  const option = useMemo<EChartsOption>(() => {
    return {
      color: t.palette,
      textStyle: { color: t.fg, fontFamily: 'inherit' },
      tooltip: {
        backgroundColor: t.card,
        borderColor: t.border,
        textStyle: { color: t.fg, fontSize: 12 },
        formatter: (raw: unknown) => {
          const p = asTipArray(raw)[0] ?? {};
          return `${p.marker ?? ''}<b>${p.name ?? ''}</b><br/>${fmtCost(typeof p.value === 'number' ? p.value : 0)} (${p.percent ?? 0}%)`;
        },
      },
      legend: {
        orient: 'vertical',
        right: 0,
        top: 'middle',
        textStyle: { color: t.muted, fontSize: 10.5 },
        icon: 'circle',
        itemWidth: 8,
        formatter: (name: string) => (name.length > 22 ? `${name.slice(0, 20)}…` : name),
      },
      series: [
        {
          type: 'pie',
          radius: ['52%', '78%'],
          center: ['35%', '50%'],
          itemStyle: { borderColor: t.card, borderWidth: 2 },
          label: { show: false },
          data: rows.map((r) => ({ name: r.model, value: r.totalCents })),
        },
      ],
    };
  }, [rows, t]);
  return <EChart option={option} instanceRef={instanceRef} className="h-72" />;
}

// ---------------------------------------------------------------------------
// API keys table
// ---------------------------------------------------------------------------

type KeySortKey = 'name' | 'status' | 'owner' | 'workspace' | 'tokens' | 'share' | 'lastActive';

const KEY_SORTERS: Record<KeySortKey, (k: ApiKeyRow) => number | string> = {
  name: (k) => k.name.toLowerCase(),
  status: (k) => k.status,
  owner: (k) => (k.createdByName ?? '').toLowerCase(),
  workspace: (k) => (k.workspaceName ?? '').toLowerCase(),
  tokens: (k) => totalTokens(k.tokens),
  share: (k) => k.tokenShare,
  lastActive: (k) => k.lastActiveDate ?? '',
};

function KeyTh({
  label,
  sortKey,
  sort,
  onSort,
  align = 'left',
}: {
  label: string;
  sortKey: KeySortKey;
  sort: { key: KeySortKey; dir: 1 | -1 };
  onSort: (k: KeySortKey) => void;
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

function StatusPill({ status }: { status: string }) {
  const cls =
    status === 'active'
      ? 'border-good/30 bg-good/10 text-good'
      : status === 'inactive'
        ? 'border-warn/30 bg-warn/10 text-warn'
        : status === 'expired'
          ? 'border-risk/30 bg-risk/10 text-risk'
          : 'border-border bg-fg/5 text-muted'; // archived + anything unexpected
  return (
    <span className={cn('inline-flex rounded-full border px-2 py-0.5 text-[10.5px] font-medium capitalize', cls)}>
      {status}
    </span>
  );
}

function ApiKeysTable({ keys }: { keys: ApiKeyRow[] }) {
  const [sort, setSort] = useState<{ key: KeySortKey; dir: 1 | -1 }>({ key: 'tokens', dir: -1 });

  const onSort = (key: KeySortKey) =>
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === -1 ? 1 : -1 }
        : { key, dir: key === 'name' || key === 'owner' || key === 'workspace' || key === 'status' ? 1 : -1 },
    );

  const sorted = useMemo(() => {
    const sorter = KEY_SORTERS[sort.key];
    return [...keys].sort((a, b) => {
      const av = sorter(a);
      const bv = sorter(b);
      const cmp =
        typeof av === 'string' || typeof bv === 'string'
          ? String(av).localeCompare(String(bv))
          : (av as number) - (bv as number);
      return cmp * sort.dir;
    });
  }, [keys, sort]);

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[840px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border">
            <KeyTh label="Name" sortKey="name" sort={sort} onSort={onSort} />
            <KeyTh label="Status" sortKey="status" sort={sort} onSort={onSort} />
            <KeyTh label="Owner" sortKey="owner" sort={sort} onSort={onSort} />
            <KeyTh label="Workspace" sortKey="workspace" sort={sort} onSort={onSort} />
            <KeyTh label="Total tokens" sortKey="tokens" sort={sort} onSort={onSort} align="right" />
            <KeyTh label="Share" sortKey="share" sort={sort} onSort={onSort} />
            <KeyTh label="Last active" sortKey="lastActive" sort={sort} onSort={onSort} align="right" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((k) => {
            const idle = daysSince(k.lastActiveDate);
            const stale = k.lastActiveDate === null || (idle !== null && idle >= 30);
            return (
              <tr key={k.id} className="border-b border-border/60 transition-colors hover:bg-fg/[0.025]">
                <td className="max-w-64 px-2.5 py-2">
                  <span className="block truncate text-[13px] font-medium">{k.name}</span>
                  {k.partialKeyHint && (
                    <span className="block truncate font-mono text-[10.5px] text-muted">{k.partialKeyHint}</span>
                  )}
                </td>
                <td className="px-2.5 py-2">
                  <StatusPill status={k.status} />
                </td>
                <td className="whitespace-nowrap px-2.5 py-2 text-xs text-muted">{k.createdByName ?? '—'}</td>
                <td className="whitespace-nowrap px-2.5 py-2 text-xs text-muted">{k.workspaceName ?? '—'}</td>
                <td className="whitespace-nowrap px-2.5 py-2 text-right text-[13px]">
                  {fmtTokens(totalTokens(k.tokens))}
                </td>
                <td className="px-2.5 py-2">
                  <span className="flex items-center gap-1.5">
                    <span
                      title={`${fmtPct(k.tokenShare, 1)} of api-key token volume`}
                      className="h-[5px] w-16 overflow-hidden rounded-full bg-fg/10"
                    >
                      <span
                        className="block h-full rounded-full bg-accent"
                        style={{ width: `${Math.min(100, Math.round(k.tokenShare * 100))}%` }}
                      />
                    </span>
                    <span className="text-[11px] text-muted">{fmtPct(k.tokenShare)}</span>
                  </span>
                </td>
                <td
                  className={cn(
                    'whitespace-nowrap px-2.5 py-2 text-right text-xs',
                    stale ? 'font-medium text-risk' : 'text-muted',
                  )}
                >
                  {relativeDate(k.lastActiveDate)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dimensions: service tier / context window / customer type / web search
// ---------------------------------------------------------------------------

function DimensionDonut({ instanceRef, slices }: { instanceRef: ChartRef; slices: DimensionSlice[] }) {
  const t = useChartTheme();
  const option = useMemo<EChartsOption>(() => {
    return {
      color: t.palette,
      textStyle: { color: t.fg, fontFamily: 'inherit' },
      tooltip: {
        backgroundColor: t.card,
        borderColor: t.border,
        textStyle: { color: t.fg, fontSize: 12 },
        formatter: (raw: unknown) => {
          const p = asTipArray(raw)[0] ?? {};
          return `${p.marker ?? ''}<b>${p.name ?? ''}</b>: ${fmtTokens(typeof p.value === 'number' ? p.value : 0)} tokens (${p.percent ?? 0}%)`;
        },
      },
      legend: {
        orient: 'vertical',
        right: 0,
        top: 'middle',
        textStyle: { color: t.muted, fontSize: 11 },
        icon: 'circle',
        itemWidth: 8,
      },
      series: [
        {
          type: 'pie',
          radius: ['52%', '78%'],
          center: ['35%', '50%'],
          itemStyle: { borderColor: t.card, borderWidth: 2 },
          label: { show: false },
          data: slices.map((s) => ({ name: s.key, value: totalTokens(s.tokens) })),
        },
      ],
    };
  }, [slices, t]);
  return <EChart option={option} instanceRef={instanceRef} className="h-64" />;
}

function ServiceTierCard({
  dims,
  isLoading,
  error,
  onRetry,
}: {
  dims: DimensionsResponse | undefined;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  const slices = dims?.serviceTier ?? [];
  const total = sumBy(slices, (s) => totalTokens(s.tokens));
  const standard = slices.find((s) => s.key === 'standard');
  const standardShare = total > 0 && standard ? totalTokens(standard.tokens) / total : 0;
  return (
    <ChartCard
      title="Service tier mix"
      chartId="service-tier-mix"
      metricKey="serviceTier"
      subtitle="Tokens by service tier"
      className="col-span-12 md:col-span-6 lg:col-span-4"
      isLoading={isLoading}
      error={error}
      onRetry={onRetry}
      isEmpty={!!dims && slices.length === 0}
    >
      {(ref) => (
        <>
          <DimensionDonut instanceRef={ref} slices={slices} />
          {standardShare > 0.8 && (
            <p className="mt-1 rounded-lg border border-warn/30 bg-warn/10 px-2.5 py-1.5 text-[11px] leading-relaxed text-warn">
              ≈{Math.round(standardShare * 100)}% runs at standard rate — batch jobs get a 50% discount for
              async workloads
            </p>
          )}
        </>
      )}
    </ChartCard>
  );
}

function CustomerTypeChart({
  instanceRef,
  rows,
}: {
  instanceRef: ChartRef;
  rows: DimensionsResponse['customerType'];
}) {
  const t = useChartTheme();
  const option = useMemo<EChartsOption>(() => {
    return {
      textStyle: { color: t.fg, fontFamily: 'inherit' },
      tooltip: {
        trigger: 'axis',
        backgroundColor: t.card,
        borderColor: t.border,
        textStyle: { color: t.fg, fontSize: 12 },
        formatter: (raw: unknown) => {
          const items = asTipArray(raw);
          const head = items[0]?.name ?? '';
          const lines = items.map((p) => {
            const v = typeof p.value === 'number' ? p.value : 0;
            const val = p.seriesName === 'Est. cost' ? fmtCost(v) : fmtNumber(v);
            return `${p.marker ?? ''}${p.seriesName ?? ''}: <b>${val}</b>`;
          });
          return `<div style="font-size:11px">${head}</div>${lines.join('<br/>')}`;
        },
      },
      legend: { top: 0, right: 0, textStyle: { color: t.muted, fontSize: 10.5 }, icon: 'circle', itemWidth: 8 },
      grid: { left: 8, right: 8, top: 30, bottom: 4, containLabel: true },
      xAxis: {
        type: 'category',
        data: rows.map((r) => r.key),
        axisLine: { lineStyle: { color: t.border } },
        axisTick: { show: false },
        axisLabel: { color: t.muted, fontSize: 11 },
      },
      yAxis: [
        {
          type: 'value',
          axisLabel: { color: t.muted, fontSize: 10.5, formatter: (v: number) => fmtNumber(v) },
          splitLine: { lineStyle: { color: t.border, opacity: 0.5 } },
        },
        {
          type: 'value',
          axisLabel: { color: t.muted, fontSize: 10.5, formatter: (v: number) => fmtCost(v) },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: 'Sessions',
          type: 'bar',
          barMaxWidth: 32,
          itemStyle: { color: t.accent2, opacity: 0.9, borderRadius: [3, 3, 0, 0] },
          data: rows.map((r) => r.sessions),
        },
        {
          name: 'Est. cost',
          type: 'bar',
          yAxisIndex: 1,
          barMaxWidth: 32,
          itemStyle: { color: t.accent, opacity: 0.9, borderRadius: [3, 3, 0, 0] },
          data: rows.map((r) => r.costCents),
        },
      ],
    };
  }, [rows, t]);
  return <EChart option={option} instanceRef={instanceRef} className="h-64" />;
}

function WebSearchCard({
  dims,
  isLoading,
  error,
  onRetry,
}: {
  dims: DimensionsResponse | undefined;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  const ws = dims?.webSearch;
  const topUsers = ws?.topUsers ?? [];
  const maxReq = topUsers.reduce((m, u) => Math.max(m, u.requests), 0);
  return (
    <ChartCard
      title="Web search"
      chartId="web-search-usage"
      metricKey="webSearch"
      subtitle="Server-side web search requests and heaviest users"
      className="col-span-12"
      noExport
      isLoading={isLoading}
      error={error}
      onRetry={onRetry}
      isEmpty={!!ws && ws.totalRequests === 0 && topUsers.length === 0}
      emptyText="No web search usage in this range"
    >
      <div className="flex flex-col gap-5 py-2 md:flex-row md:items-start">
        <div className="shrink-0 md:w-56">
          <div className="text-[32px] font-semibold leading-none tracking-tight">
            {fmtNumber(ws?.totalRequests ?? 0)}
          </div>
          <div className="mt-1.5 text-[11px] text-muted">web search requests in range</div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted">
            Top users
          </div>
          {topUsers.length === 0 ? (
            <div className="text-xs text-muted">No per-user attribution in this range.</div>
          ) : (
            <ul className="space-y-1.5">
              {topUsers.slice(0, 5).map((u) => (
                <li key={u.userId} className="flex items-center gap-2.5">
                  <Link
                    to={`/user/${encodeURIComponent(String(u.userId))}`}
                    className="w-44 truncate text-[13px] font-medium hover:text-accent hover:underline"
                  >
                    {u.name}
                  </Link>
                  <span className="h-[5px] min-w-0 flex-1 overflow-hidden rounded-full bg-fg/10">
                    <span
                      className="block h-full rounded-full bg-accent"
                      style={{ width: `${maxReq > 0 ? Math.round((u.requests / maxReq) * 100) : 0}%` }}
                    />
                  </span>
                  <span className="w-16 shrink-0 text-right text-xs text-muted">
                    {fmtNumber(u.requests)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </ChartCard>
  );
}
