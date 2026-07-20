import { useMemo } from 'react';
import { BADGE_CATALOG, type BadgeId, type LeaderboardEntry } from '@dash/shared';
import { Modal, Tip } from '@/components/ui';
import { EChart, type EChartsOption } from '@/components/EChart';
import { Avatar } from '@/components/Avatar';
import { SegmentChip } from '@/components/SegmentChip';
import { useChartTheme, asTipArray } from '@/lib/chartTheme';
import { fmtCost, fmtNumber, fmtPct, fmtScore } from '@/lib/format';
import { cn } from '@/lib/utils';

interface CompareMetric {
  key: string;
  label: string;
  value: (e: LeaderboardEntry) => number;
  format: (v: number) => string;
  /** true when the entry has no data for this metric (rendered as '—'). */
  isNull?: (e: LeaderboardEntry) => boolean;
}

const METRICS: CompareMetric[] = [
  { key: 'sessions', label: 'Sessions', value: (e) => e.metrics.sessions, format: fmtNumber },
  {
    key: 'netLines',
    label: 'Net lines',
    value: (e) => e.metrics.linesAdded - e.metrics.linesRemoved,
    format: fmtNumber,
  },
  { key: 'commits', label: 'Commits', value: (e) => e.metrics.commits, format: fmtNumber },
  { key: 'prs', label: 'PRs', value: (e) => e.metrics.pullRequests, format: fmtNumber },
  {
    key: 'acceptance',
    label: 'Acceptance',
    value: (e) => (e.metrics.acceptanceRate ?? 0) * 100,
    format: (v) => `${v.toFixed(0)}%`,
    isNull: (e) => e.metrics.acceptanceRate === null,
  },
  { key: 'cost', label: 'Cost', value: (e) => e.metrics.costCents, format: fmtCost },
];

/** Radar overlay + normalized grouped bars + badge diff; driven by ?compare=. */
export function CompareDialog({
  entries,
  open,
  onClose,
}: {
  entries: LeaderboardEntry[];
  open: boolean;
  onClose: () => void;
}) {
  const t = useChartTheme();

  const radarOption = useMemo<EChartsOption>(() => {
    return {
      color: t.palette,
      textStyle: { color: t.fg, fontFamily: 'inherit' },
      legend: {
        bottom: 0,
        textStyle: { color: t.muted, fontSize: 11 },
        icon: 'circle',
        itemWidth: 8,
      },
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
        ],
        radius: '65%',
        axisName: { color: t.muted, fontSize: 11 },
        splitLine: { lineStyle: { color: t.border } },
        splitArea: { areaStyle: { color: ['transparent'] } },
        axisLine: { lineStyle: { color: t.border } },
      },
      series: [
        {
          type: 'radar',
          symbolSize: 3,
          data: entries.map((e, i) => ({
            name: e.user.name,
            value: [e.scores.adoption, e.scores.impact, e.scores.efficiency, e.scores.trust],
            lineStyle: { width: 2 },
            areaStyle: { opacity: 0.08 },
            itemStyle: { color: t.palette[i % t.palette.length] },
          })),
        },
      ],
    };
  }, [entries, t]);

  const barsOption = useMemo<EChartsOption>(() => {
    // normalize each metric to the max across selected users; tooltip shows real values
    return {
      color: t.palette,
      textStyle: { color: t.fg, fontFamily: 'inherit' },
      legend: { top: 0, textStyle: { color: t.muted, fontSize: 11 }, icon: 'circle', itemWidth: 8 },
      grid: { left: 8, right: 8, top: 28, bottom: 4, containLabel: true },
      tooltip: {
        trigger: 'axis',
        backgroundColor: t.card,
        borderColor: t.border,
        textStyle: { color: t.fg, fontSize: 12 },
        formatter: (raw: unknown) => {
          const items = asTipArray(raw);
          const axisLabel = items[0]?.name ?? '';
          const metric = METRICS.find((m) => m.label === axisLabel);
          const lines = items.map((p) => {
            const entry = entries.find((e) => e.user.name === p.seriesName);
            const real =
              metric && entry ? (metric.isNull?.(entry) ? '—' : metric.format(metric.value(entry))) : '—';
            return `${p.marker ?? ''}${p.seriesName ?? ''}: <b>${real}</b>`;
          });
          return `<div style="font-size:11px">${axisLabel}</div>${lines.join('<br/>')}`;
        },
      },
      xAxis: {
        type: 'category',
        data: METRICS.map((m) => m.label),
        axisLine: { lineStyle: { color: t.border } },
        axisTick: { show: false },
        axisLabel: { color: t.muted, fontSize: 10.5 },
      },
      yAxis: {
        type: 'value',
        max: 100,
        axisLabel: { show: false },
        splitLine: { lineStyle: { color: t.border, opacity: 0.5 } },
      },
      series: entries.map((e) => ({
        name: e.user.name,
        type: 'bar' as const,
        barMaxWidth: 22,
        data: METRICS.map((m) => {
          // Sign-safe: normalize against the largest positive value and clamp
          // negatives (e.g. net lines) to 0-height bars; tooltip shows the
          // true signed value.
          const max = Math.max(...entries.map((x) => m.value(x)), 1);
          return Math.round((Math.max(0, m.value(e)) / max) * 100);
        }),
        itemStyle: { borderRadius: [3, 3, 0, 0] },
      })),
    };
  }, [entries, t]);

  const allEarnedIds = useMemo(() => {
    const set = new Set<BadgeId>();
    for (const e of entries) for (const b of e.badges) if (b.earned) set.add(b.id);
    return [...set];
  }, [entries]);

  return (
    <Modal open={open} onOpenChange={(o) => !o && onClose()} title={`Compare ${entries.length} people`} className="w-[min(94vw,760px)]">
      <div className="mb-3 flex flex-wrap gap-2">
        {entries.map((e, i) => (
          <span
            key={e.user.id}
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-1 text-xs"
            style={{ borderColor: `color-mix(in srgb, ${t.palette[i % t.palette.length] ?? t.accent} 50%, transparent)` }}
          >
            <Avatar name={e.user.name} email={e.user.email} size={18} />
            {e.user.name}
            <span className="text-muted">{fmtScore(e.scores.composite)}</span>
            <SegmentChip tier={e.segment} />
          </span>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <div className="mb-1 text-xs font-semibold text-muted">Score radar</div>
          <EChart option={radarOption} className="h-64" />
        </div>
        <div>
          <div className="mb-1 text-xs font-semibold text-muted">
            Metrics <span className="font-normal">(normalized per metric; hover for actual)</span>
          </div>
          <EChart option={barsOption} className="h-64" />
        </div>
      </div>
      <div className="mt-4 border-t border-border pt-3">
        <div className="mb-2 text-xs font-semibold text-muted">Badge diff</div>
        {allEarnedIds.length === 0 ? (
          <div className="text-xs text-muted">Nobody here has earned a badge in this range.</div>
        ) : (
          <div className="space-y-1.5">
            {entries.map((e) => (
              <div key={e.user.id} className="flex items-center gap-2">
                <span className="w-32 truncate text-xs">{e.user.name}</span>
                <span className="flex flex-wrap gap-1">
                  {allEarnedIds.map((id) => {
                    const has = e.badges.some((b) => b.id === id && b.earned);
                    const meta = BADGE_CATALOG[id];
                    return (
                      <Tip key={id} content={`${meta.name}${has ? '' : ' — not earned'}`}>
                        <span
                          className={cn(
                            'flex size-6 items-center justify-center rounded-full border text-[12px]',
                            has ? 'border-accent/40 bg-accent/10' : 'border-border opacity-25 grayscale',
                          )}
                        >
                          {meta.emoji}
                        </span>
                      </Tip>
                    );
                  })}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
