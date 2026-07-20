import { useMemo } from 'react';
import { TOOL_NAMES, type ToolName } from '@dash/shared';
import { EChart, type EChartsOption } from '@/components/EChart';
import type { ChartRef } from '@/components/TrendChart';
import { useChartTheme, asTipArray } from '@/lib/chartTheme';
import { fmtNumber, fmtPct } from '@/lib/format';

const TOOL_LABELS: Record<ToolName, string> = {
  edit: 'Edit',
  multi_edit: 'MultiEdit',
  write: 'Write',
  notebook: 'Notebook',
};

export type PerTool = Record<ToolName, { accepted: number; rejected: number }>;

export function emptyPerTool(): PerTool {
  return {
    edit: { accepted: 0, rejected: 0 },
    multi_edit: { accepted: 0, rejected: 0 },
    write: { accepted: 0, rejected: 0 },
    notebook: { accepted: 0, rejected: 0 },
  };
}

export function sumPerTool(list: PerTool[]): PerTool {
  const acc = emptyPerTool();
  for (const pt of list) {
    for (const tool of TOOL_NAMES) {
      acc[tool].accepted += pt[tool]?.accepted ?? 0;
      acc[tool].rejected += pt[tool]?.rejected ?? 0;
    }
  }
  return acc;
}

export function perToolTotal(pt: PerTool): number {
  return TOOL_NAMES.reduce((a, tool) => a + pt[tool].accepted + pt[tool].rejected, 0);
}

/** Grouped bars: accepted vs rejected per file-modifying tool. */
export function AcceptanceByToolChart({ instanceRef, perTool }: { instanceRef: ChartRef; perTool: PerTool }) {
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
          const idx = items[0]?.dataIndex ?? 0;
          const tool = TOOL_NAMES[idx];
          const stats = tool ? perTool[tool] : { accepted: 0, rejected: 0 };
          const total = stats.accepted + stats.rejected;
          const rate = total > 0 ? stats.accepted / total : null;
          const lines = items.map(
            (p) => `${p.marker ?? ''}${p.seriesName ?? ''}: <b>${fmtNumber(typeof p.value === 'number' ? p.value : 0)}</b>`,
          );
          return `<b>${items[0]?.name ?? ''}</b><br/>${lines.join('<br/>')}<br/>Acceptance: <b>${fmtPct(rate)}</b>`;
        },
      },
      legend: { top: 0, right: 0, textStyle: { color: t.muted, fontSize: 11 }, icon: 'circle', itemWidth: 8 },
      grid: { left: 8, right: 8, top: 30, bottom: 4, containLabel: true },
      xAxis: {
        type: 'category',
        data: TOOL_NAMES.map((tool) => TOOL_LABELS[tool]),
        axisLine: { lineStyle: { color: t.border } },
        axisTick: { show: false },
        axisLabel: { color: t.muted, fontSize: 11 },
      },
      yAxis: {
        type: 'value',
        axisLabel: { color: t.muted, fontSize: 10.5, formatter: (v: number) => fmtNumber(v) },
        splitLine: { lineStyle: { color: t.border, opacity: 0.5 } },
      },
      series: [
        {
          name: 'Accepted',
          type: 'bar',
          barMaxWidth: 24,
          itemStyle: { color: t.good, borderRadius: [3, 3, 0, 0] },
          data: TOOL_NAMES.map((tool) => perTool[tool].accepted),
        },
        {
          name: 'Rejected',
          type: 'bar',
          barMaxWidth: 24,
          itemStyle: { color: t.risk, opacity: 0.75, borderRadius: [3, 3, 0, 0] },
          data: TOOL_NAMES.map((tool) => perTool[tool].rejected),
        },
      ],
    };
  }, [perTool, t]);
  return <EChart option={option} instanceRef={instanceRef} className="h-64" />;
}
