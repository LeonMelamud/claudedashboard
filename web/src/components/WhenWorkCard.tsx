import { useMemo, useState } from 'react';
import type { HeatmapHour } from '@dash/shared';
import { ChartCard } from '@/components/ChartCard';
import { EChart, type EChartsOption } from '@/components/EChart';
import type { ChartRef } from '@/components/TrendChart';
import { useChartTheme, asTipArray } from '@/lib/chartTheme';
import { binHeatmap, WEEKDAY_LABELS } from '@/lib/time';
import { fmtPct, fmtTokens } from '@/lib/format';
import { Segmented } from '@/components/ui';

/** 7×24 Israel-local activity heatmap with absolute / row-normalized toggle. */
export function WhenWorkCard({
  hours,
  isLoading,
  error,
  onRetry,
  className,
  title = 'When we work',
  chartId = 'when-we-work',
}: {
  hours: HeatmapHour[];
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  className?: string;
  title?: string;
  chartId?: string;
}) {
  const [mode, setMode] = useState<'abs' | 'norm'>('abs');
  const bins = useMemo(() => binHeatmap(hours), [hours]);
  const peakLabel = bins.peak
    ? `Peak: ${WEEKDAY_LABELS[bins.peak.weekday] ?? ''} ${String(bins.peak.hour).padStart(2, '0')}:00`
    : undefined;

  return (
    <ChartCard
      title={title}
      chartId={chartId}
      metricKey="whenWeWork"
      {...(peakLabel ? { subtitle: peakLabel } : {})}
      actions={
        <Segmented
          size="xs"
          options={[
            { id: 'abs' as const, label: 'Absolute' },
            { id: 'norm' as const, label: 'Row %' },
          ]}
          value={mode}
          onChange={setMode}
        />
      }
      {...(className ? { className } : {})}
      isLoading={isLoading}
      error={error}
      onRetry={onRetry}
      isEmpty={!isLoading && !error && bins.total === 0}
      emptyText="No hourly activity in this range"
    >
      {(ref) => <WorkHeatmap instanceRef={ref} bins={bins} mode={mode} />}
    </ChartCard>
  );
}

function WorkHeatmap({
  instanceRef,
  bins,
  mode,
}: {
  instanceRef: ChartRef;
  bins: ReturnType<typeof binHeatmap>;
  mode: 'abs' | 'norm';
}) {
  const t = useChartTheme();
  const option = useMemo<EChartsOption>(() => {
    const source = mode === 'abs' ? bins.abs : bins.norm;
    const data: Array<[number, number, number]> = [];
    for (let w = 0; w < 7; w++) {
      for (let h = 0; h < 24; h++) {
        data.push([h, w, source[w]?.[h] ?? 0]);
      }
    }
    const maxV = mode === 'abs' ? bins.max : 1;
    return {
      textStyle: { color: t.fg, fontFamily: 'inherit' },
      tooltip: {
        backgroundColor: t.card,
        borderColor: t.border,
        textStyle: { color: t.fg, fontSize: 12 },
        formatter: (raw: unknown) => {
          const p = asTipArray(raw)[0];
          const v = (p?.value ?? [0, 0, 0]) as [number, number, number];
          const abs = bins.abs[v[1]]?.[v[0]] ?? 0;
          const share = bins.total > 0 ? abs / bins.total : 0;
          return `<b>${WEEKDAY_LABELS[v[1]] ?? ''} ${String(v[0]).padStart(2, '0')}:00</b><br/>${fmtTokens(abs)} tokens · ${fmtPct(share, 1)} of total`;
        },
      },
      grid: { left: 8, right: 8, top: 8, bottom: 40, containLabel: true },
      xAxis: {
        type: 'category',
        data: Array.from({ length: 24 }, (_, h) => `${h}`),
        splitArea: { show: false },
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: t.muted, fontSize: 10, interval: 2 },
      },
      yAxis: {
        type: 'category',
        data: [...WEEKDAY_LABELS],
        inverse: true,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          fontSize: 10.5,
          color: (value: unknown) => (value === 'Fri' || value === 'Sat' ? `${t.muted}88` : t.muted),
        },
      },
      visualMap: {
        min: 0,
        max: maxV || 1,
        calculable: false,
        orient: 'horizontal',
        left: 'center',
        bottom: 0,
        itemHeight: 90,
        textStyle: { color: t.muted, fontSize: 9 },
        inRange: {
          color: t.isDark
            ? ['#171c27', '#3d2f2a', '#7a4a37', '#b96a4b', t.accent, '#f0a984']
            : ['#f1f5f9', '#fde8df', '#f4bfa4', t.accent, '#b4512f'],
        },
      },
      series: [
        {
          type: 'heatmap',
          data,
          itemStyle: { borderColor: t.card, borderWidth: 1.5, borderRadius: 2 },
          emphasis: { itemStyle: { shadowBlur: 6, shadowColor: 'rgba(0,0,0,0.4)' } },
          ...(bins.peak && mode === 'abs'
            ? {
                markPoint: {
                  symbol: 'pin',
                  symbolSize: 26,
                  itemStyle: { color: t.accent2 },
                  label: { show: false },
                  data: [{ name: 'Peak', coord: [bins.peak.hour, bins.peak.weekday], value: bins.peak.value }],
                },
              }
            : {}),
        },
      ],
    };
  }, [bins, mode, t]);
  return <EChart option={option} instanceRef={instanceRef} className="h-72" />;
}
