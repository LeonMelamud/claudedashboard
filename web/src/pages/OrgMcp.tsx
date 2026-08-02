import { useMemo, useState } from 'react';
import type { Granularity, McpResponse } from '@dash/shared';
import { useRangeParams } from '@/hooks/useRangeParams';
import { useMcp } from '@/lib/queries';
import { useChartTheme } from '@/lib/chartTheme';
import { bucketRows, sumBy } from '@/lib/time';
import { fmtBucket, fmtCost, fmtNumber, fmtPct, fmtTokens } from '@/lib/format';
import { ChartCard, ChartPage, HiddenChartChips } from '@/components/ChartCard';
import { EChart, type EChartsOption } from '@/components/EChart';
import type { ChartRef } from '@/components/TrendChart';
import { StatCard } from '@/components/StatCard';
import { StatSkeleton } from '@/components/Skeleton';
import { ErrorCard } from '@/components/ErrorCard';
import { BreakdownDrawer, DrillCount, type BreakdownTarget } from '@/components/BreakdownDrawer';
import { TelemetrySetupCard } from '@/components/TelemetrySetupCard';
import { WhatsCollectedLink } from '@/components/TelemetryPolicyDialog';
import { Tip } from '@/components/ui';
import { cn } from '@/lib/utils';

/** 'mcp__server__tool' → parts; server naming follows the telemetry tool name. */
function splitMcpName(toolName: string): { server: string; tool: string } {
  const rest = toolName.slice('mcp__'.length);
  const sep = rest.indexOf('__');
  return sep > 0 ? { server: rest.slice(0, sep), tool: rest.slice(sep + 2) } : { server: rest, tool: rest };
}

export default function OrgMcp() {
  const { from, to, gran, teamId } = useRangeParams();
  const mcpQ = useMcp({ from, to, teamId });
  const [drill, setDrill] = useState<BreakdownTarget | null>(null);

  const mcp = mcpQ.data;
  const noData = !!mcp && !mcp.hasData;

  return (
    <ChartPage pageId="mcp">
      <div className="grid grid-cols-12 gap-4">
        {mcpQ.error ? (
          <div className="col-span-12">
            <ErrorCard error={mcpQ.error} onRetry={() => void mcpQ.refetch()} />
          </div>
        ) : (
          <>
            {noData && (
              <TelemetrySetupCard blurb="This view is powered by Claude Code’s OpenTelemetry events — every MCP server and tool your org reaches through Claude Code." />
            )}

            <KpiRow mcp={mcp} loading={mcpQ.isLoading} noData={noData} />

            <ChartCard
              title="MCP servers"
              chartId="mcp-servers-page"
              metricKey="mcpUsage"
              subtitle="Connected servers — calls, health, and who uses them"
              infoExtra="Per-server call counts come from MCP-name telemetry; events ingested before the dashboard learned to read them were counted under an anonymous mcp_tool bucket and don’t appear per server."
              className="col-span-12 lg:col-span-7"
              noExport
              isLoading={mcpQ.isLoading}
              isEmpty={noData || (!!mcp && mcp.servers.length === 0)}
              emptyText={noData ? 'Waiting for telemetry events' : 'No MCP activity in this range'}
            >
              <ServersTable rows={mcp?.servers ?? []} onDrill={setDrill} />
            </ChartCard>

            <McpToolsCard
              rows={mcp?.tools ?? []}
              isLoading={mcpQ.isLoading}
              noData={noData}
              onDrill={setDrill}
            />

            <ChartCard
              title="MCP activity over time"
              chartId="mcp-trend"
              metricKey="mcpUsage"
              subtitle="Tool calls, failures, and server connections"
              className="col-span-12"
              isLoading={mcpQ.isLoading}
              isEmpty={noData || (!!mcp && mcp.daily.length === 0)}
              emptyText={noData ? 'Waiting for telemetry events' : 'No MCP activity in this range'}
            >
              {(ref) => <McpTrend instanceRef={ref} rows={mcp?.daily ?? []} gran={gran} />}
            </ChartCard>

            <div className="col-span-12 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
              <WhatsCollectedLink />
            </div>
          </>
        )}

        <HiddenChartChips />
      </div>
      <BreakdownDrawer target={drill} onClose={() => setDrill(null)} range={{ from, to, teamId }} />
    </ChartPage>
  );
}

// ---------------------------------------------------------------------------
// KPI row
// ---------------------------------------------------------------------------

function KpiRow({ mcp, loading, noData }: { mcp: McpResponse | undefined; loading: boolean; noData: boolean }) {
  if (loading || !mcp) {
    return (
      <div className="col-span-12 grid grid-cols-2 gap-4 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <StatSkeleton key={i} />
        ))}
      </div>
    );
  }
  const calls = mcp.daily.reduce((s, d) => s + d.toolCalls, 0);
  const callFailures = mcp.daily.reduce((s, d) => s + d.toolFailures, 0);
  const connections = mcp.daily.reduce((s, d) => s + d.connections, 0);
  const connFailures = mcp.daily.reduce((s, d) => s + d.connectionFailures, 0);
  const activeServers = mcp.servers.filter((s) => s.toolCalls > 0).length;
  return (
    <div className="col-span-12 grid grid-cols-2 gap-4 xl:grid-cols-4">
      <StatCard
        label="MCP tool calls"
        {...(noData ? { display: '—' } : { value: calls })}
        metricKey="mcpUsage"
        footer={
          noData
            ? 'Waiting for telemetry'
            : callFailures > 0
              ? `${fmtNumber(callFailures)} failed (${fmtPct(callFailures / Math.max(1, calls))})`
              : 'no failures'
        }
      />
      <StatCard
        label="MCP tools used"
        {...(noData ? { display: '—' } : { value: mcp.tools.length })}
        metricKey="mcpUsage"
        footer={noData ? 'Waiting for telemetry' : 'distinct tools invoked in range'}
      />
      <StatCard
        label="Servers"
        {...(noData ? { display: '—' } : { value: mcp.servers.length })}
        metricKey="mcpUsage"
        footer={noData ? 'Waiting for telemetry' : `${fmtNumber(activeServers)} with tool calls`}
      />
      <StatCard
        label="Connections"
        {...(noData ? { display: '—' } : { value: connections })}
        metricKey="mcpUsage"
        footer={
          noData
            ? 'Waiting for telemetry'
            : connFailures > 0
              ? `${fmtNumber(connFailures)} failed`
              : 'no connection failures'
        }
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Servers table
// ---------------------------------------------------------------------------

function ServersTable({
  rows,
  onDrill,
}: {
  rows: McpResponse['servers'];
  onDrill: (t: BreakdownTarget) => void;
}) {
  const sorted = useMemo(
    () => [...rows].sort((a, b) => b.toolCalls - a.toolCalls || b.connections - a.connections),
    [rows],
  );
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[620px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border">
            {['Server', 'Calls', 'Failures', 'Tokens', 'Cost', 'Connections', 'Users'].map((h, i) => (
              <th
                key={h}
                className={cn(
                  'whitespace-nowrap px-2.5 py-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted',
                  i > 0 && 'text-right',
                )}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((s) => {
            const failRate = s.toolCalls > 0 ? s.toolFailures / s.toolCalls : 0;
            return (
              <tr key={s.serverName} className="border-b border-border/60 transition-colors hover:bg-fg/[0.025]">
                <td className="max-w-52 truncate px-2.5 py-1.5 font-mono text-[12px] font-medium" title={s.serverName}>
                  {s.serverName}
                </td>
                <td className="whitespace-nowrap px-2.5 py-1.5 text-right text-[12.5px]">
                  {fmtNumber(s.toolCalls)}
                </td>
                <td
                  className={cn(
                    'whitespace-nowrap px-2.5 py-1.5 text-right text-xs',
                    s.toolFailures === 0 ? 'text-muted' : failRate > 0.1 ? 'font-medium text-risk' : 'font-medium text-warn',
                  )}
                >
                  {fmtNumber(s.toolFailures)}
                </td>
                <td className="whitespace-nowrap px-2.5 py-1.5 text-right text-xs text-muted">
                  {fmtTokens(s.tokens)}
                </td>
                <td className="whitespace-nowrap px-2.5 py-1.5 text-right text-xs text-muted">
                  {fmtCost(s.costCents)}
                </td>
                <td className="whitespace-nowrap px-2.5 py-1.5 text-right text-xs">
                  <span className="text-muted">{fmtNumber(s.connections)}</span>
                  {s.connectionFailures > 0 && (
                    <span className="ml-1 font-medium text-risk">· {fmtNumber(s.connectionFailures)} failed</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-2.5 py-1.5 text-right text-xs text-muted">
                  <DrillCount
                    value={s.users}
                    onClick={() =>
                      onDrill({
                        dimension: 'mcp',
                        entity: s.serverName,
                        title: `MCP server · ${s.serverName}`,
                      })
                    }
                  />
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
// MCP tools (all tools, name filter — mirrors the Skills card)
// ---------------------------------------------------------------------------

function McpToolsCard({
  rows,
  isLoading,
  noData,
  onDrill,
}: {
  rows: McpResponse['tools'];
  isLoading: boolean;
  noData: boolean;
  onDrill: (t: BreakdownTarget) => void;
}) {
  const [filter, setFilter] = useState('');
  const q = filter.trim().toLowerCase();
  const filtered = useMemo(
    () => (q ? rows.filter((r) => r.toolName.toLowerCase().includes(q)) : rows),
    [rows, q],
  );
  return (
    <ChartCard
      title="MCP tools"
      chartId="mcp-tools"
      metricKey="mcpUsage"
      subtitle="Every MCP tool invoked in range"
      actions={
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter tools…"
          aria-label="Filter MCP tools by name"
          className="w-32 rounded-md border border-border bg-transparent px-2 py-1 text-xs outline-none transition-colors placeholder:text-muted focus:border-accent"
        />
      }
      className="col-span-12 lg:col-span-5"
      noExport
      isLoading={isLoading}
      isEmpty={noData || filtered.length === 0}
      emptyText={
        noData
          ? 'Waiting for telemetry events'
          : q && rows.length > 0
            ? 'No tools match the filter'
            : 'No MCP tool calls in this range'
      }
    >
      <McpToolsList rows={filtered} onDrill={onDrill} />
    </ChartCard>
  );
}

function McpToolsList({
  rows,
  onDrill,
}: {
  rows: McpResponse['tools'];
  onDrill: (t: BreakdownTarget) => void;
}) {
  const sorted = useMemo(() => [...rows].sort((a, b) => b.uses - a.uses), [rows]);
  const max = sorted[0]?.uses ?? 0;
  return (
    <ul className="space-y-1.5 py-1">
      {sorted.map((r) => {
        const { server, tool } = splitMcpName(r.toolName);
        const decisions = r.accepted + r.rejected;
        return (
          <li key={r.toolName} className="flex items-center gap-2.5">
            <span className="flex w-48 min-w-0 shrink-0 flex-col">
              <button
                type="button"
                onClick={() =>
                  onDrill({ dimension: 'tool', entity: r.toolName, title: `MCP tool · ${tool}` })
                }
                title={`${r.toolName} — see who uses it`}
                className="truncate text-left font-mono text-[11.5px] underline decoration-dotted underline-offset-2 transition-colors hover:text-accent"
              >
                {tool}
              </button>
              <span className="truncate text-[9.5px] text-muted" title={server}>
                {server}
              </span>
            </span>
            <span className="h-[5px] min-w-0 flex-1 overflow-hidden rounded-full bg-fg/10">
              <span
                className="block h-full rounded-full bg-accent2"
                style={{ width: `${max > 0 ? Math.max(2, Math.round((r.uses / max) * 100)) : 0}%` }}
              />
            </span>
            <span className="w-12 shrink-0 text-right text-xs">{fmtNumber(r.uses)}</span>
            <span className="w-14 shrink-0 text-right text-[10px] text-muted">
              {r.successRate !== null ? (
                <Tip content={`success rate over ${fmtNumber(r.judged)} calls`}>
                  <span className={cn(r.successRate < 0.7 && 'font-medium text-risk')}>
                    {fmtPct(r.successRate)} ok
                  </span>
                </Tip>
              ) : decisions > 0 ? (
                <Tip content={`${fmtNumber(r.accepted)} accepted / ${fmtNumber(r.rejected)} rejected`}>
                  <span>{fmtPct(r.accepted / decisions)} acc</span>
                </Tip>
              ) : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Trend
// ---------------------------------------------------------------------------

function McpTrend({
  instanceRef,
  rows,
  gran,
}: {
  instanceRef: ChartRef;
  rows: McpResponse['daily'];
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
          name: 'calls',
          nameTextStyle: { color: t.muted, fontSize: 10 },
          axisLabel: { color: t.muted, fontSize: 10.5, formatter: (v: number) => fmtNumber(v) },
          splitLine: { lineStyle: { color: t.border, opacity: 0.5 } },
        },
        {
          type: 'value',
          name: 'conns',
          nameTextStyle: { color: t.muted, fontSize: 10 },
          minInterval: 1,
          axisLabel: { color: t.muted, fontSize: 10.5 },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: 'Tool calls',
          type: 'bar',
          barMaxWidth: 22,
          itemStyle: { color: t.accent2, opacity: 0.85, borderRadius: [3, 3, 0, 0] },
          data: buckets.map((b) => sumBy(b.rows, (r) => r.toolCalls)),
        },
        {
          name: 'Call failures',
          type: 'line',
          smooth: true,
          symbolSize: 4,
          lineStyle: { color: t.risk, width: 1.5, type: 'dashed' },
          itemStyle: { color: t.risk },
          data: buckets.map((b) => sumBy(b.rows, (r) => r.toolFailures)),
        },
        {
          name: 'Connections',
          type: 'line',
          yAxisIndex: 1,
          smooth: true,
          symbolSize: 5,
          lineStyle: { color: t.accent, width: 2 },
          itemStyle: { color: t.accent },
          data: buckets.map((b) => sumBy(b.rows, (r) => r.connections)),
        },
      ],
    };
  }, [rows, gran, t]);
  return <EChart option={option} instanceRef={instanceRef} className="h-72" />;
}
