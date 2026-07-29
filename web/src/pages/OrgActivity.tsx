import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { DateTime } from 'luxon';
import type { ActivityResponse, Granularity } from '@dash/shared';
import { useRangeParams } from '@/hooks/useRangeParams';
import { useActivity } from '@/lib/queries';
import { useChartTheme, asTipArray } from '@/lib/chartTheme';
import { displayZone, bucketRows, sumBy } from '@/lib/time';
import { fmtBucket, fmtDurationMs, fmtDurationSec, fmtNumber } from '@/lib/format';
import { ChartCard, ChartPage, HiddenChartChips } from '@/components/ChartCard';
import { EChart, type EChartsOption } from '@/components/EChart';
import type { ChartRef } from '@/components/TrendChart';
import { StatCard } from '@/components/StatCard';
import { StatSkeleton, TableSkeleton } from '@/components/Skeleton';
import { ErrorCard } from '@/components/ErrorCard';
import { Avatar } from '@/components/Avatar';
import { TelemetrySetupCard } from '@/components/TelemetrySetupCard';
import { WhatsCollectedLink } from '@/components/TelemetryPolicyDialog';
import { cn } from '@/lib/utils';

/** Live panel refresh cadence. */
const LIVE_REFETCH_MS = 60_000;

export default function OrgActivity() {
  const { from, to, gran, teamId } = useRangeParams();
  const activityQ = useActivity({ from, to, teamId }, { refetchMs: LIVE_REFETCH_MS });

  const activity = activityQ.data;
  const noData = !!activity && !activity.hasData;

  return (
    <ChartPage pageId="activity">
      <div className="grid grid-cols-12 gap-4">
        {activityQ.error ? (
          <div className="col-span-12">
            <ErrorCard error={activityQ.error} onRetry={() => void activityQ.refetch()} />
          </div>
        ) : (
          <>
            {noData && (
              <TelemetrySetupCard blurb="This view measures genuine engagement — hands-on developer time, Claude-working time, prompts, and sessions — from Claude Code’s OpenTelemetry metrics." />
            )}

            <KpiRow activity={activity} loading={activityQ.isLoading} noData={noData} />

            <ChartCard
              title="Engaged time"
              chartId="engaged-time-trend"
              metricKey="activeTime"
              subtitle="Developer hands-on vs Claude-working time, stacked"
              className="col-span-12 lg:col-span-7"
              isLoading={activityQ.isLoading}
              isEmpty={noData || (!!activity && activity.daily.length === 0)}
              emptyText={noData ? 'Waiting for telemetry events' : undefined}
            >
              {(ref) => <EngagedTimeTrend instanceRef={ref} rows={activity?.daily ?? []} gran={gran} />}
            </ChartCard>

            <ChartCard
              title="Prompts & sessions"
              chartId="prompts-sessions-trend"
              metricKey="promptCadence"
              subtitle="Prompts (bars) and sessions (line)"
              className="col-span-12 lg:col-span-5"
              isLoading={activityQ.isLoading}
              isEmpty={noData || (!!activity && activity.daily.length === 0)}
              emptyText={noData ? 'Waiting for telemetry events' : undefined}
            >
              {(ref) => <PromptsSessionsTrend instanceRef={ref} rows={activity?.daily ?? []} gran={gran} />}
            </ChartCard>

            <LiveTodayCard activity={activity} isLoading={activityQ.isLoading} noData={noData} />

            <SessionLengthCard activity={activity} isLoading={activityQ.isLoading} noData={noData} />

            <ChartCard
              title="Per person"
              chartId="activity-per-user"
              metricKey="activeTime"
              infoExtra="Only people whose machines ship OpenTelemetry events appear here."
              className="col-span-12"
              noExport
              isEmpty={noData || (!!activity && activity.perUser.length === 0)}
              emptyText={noData ? 'Waiting for telemetry events' : 'No per-user telemetry in this range'}
            >
              {activityQ.isLoading ? (
                <TableSkeleton rows={5} cols={5} />
              ) : (
                <PerUserTable rows={activity?.perUser ?? []} />
              )}
            </ChartCard>

            <div className="col-span-12">
              <WhatsCollectedLink />
            </div>
          </>
        )}

        <HiddenChartChips />
      </div>
    </ChartPage>
  );
}

// ---------------------------------------------------------------------------
// KPI row
// ---------------------------------------------------------------------------

function KpiRow({
  activity,
  loading,
  noData,
}: {
  activity: ActivityResponse | undefined;
  loading: boolean;
  noData: boolean;
}) {
  if (loading || !activity) {
    return (
      <div className="col-span-12 grid grid-cols-2 gap-4 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <StatSkeleton key={i} />
        ))}
      </div>
    );
  }
  const { totals } = activity;
  const promptsPerSession =
    totals.sessions > 0 ? (totals.prompts / totals.sessions).toFixed(1) : null;
  return (
    <div className="col-span-12 grid grid-cols-2 gap-4 xl:grid-cols-4">
      <StatCard
        label="Engaged time"
        {...(noData ? { display: '—' } : { value: totals.activeUserSeconds, format: fmtDurationSec })}
        metricKey="activeTime"
        footer={noData ? 'Waiting for telemetry' : 'developer hands-on time'}
      />
      <StatCard
        label="Claude working"
        {...(noData ? { display: '—' } : { value: totals.activeCliSeconds, format: fmtDurationSec })}
        metricKey="activeTime"
        footer={noData ? 'Waiting for telemetry' : 'CLI actively working'}
      />
      <StatCard
        label="Prompts"
        {...(noData ? { display: '—' } : { value: totals.prompts })}
        metricKey="promptCadence"
        footer={
          noData
            ? 'Waiting for telemetry'
            : promptsPerSession
              ? `${promptsPerSession} per session`
              : 'content is never collected'
        }
      />
      <StatCard
        label="Sessions"
        {...(noData ? { display: '—' } : { value: totals.sessions })}
        metricKey="sessionLength"
        footer={
          noData
            ? 'Waiting for telemetry'
            : `avg ${fmtDurationMs(totals.avgSessionMs)} · median ${fmtDurationMs(totals.medianSessionMs)} (span incl. idle)`
        }
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Engaged time trend (stacked area, user vs cli)
// ---------------------------------------------------------------------------

function EngagedTimeTrend({
  instanceRef,
  rows,
  gran,
}: {
  instanceRef: ChartRef;
  rows: ActivityResponse['daily'];
  gran: Granularity;
}) {
  const t = useChartTheme();
  const option = useMemo<EChartsOption>(() => {
    const buckets = bucketRows(rows, gran);
    const labels = buckets.map((b) => fmtBucket(b.bucket, gran));
    const toHours = (sec: number) => sec / 3600;
    const series = [
      { name: 'Developer', color: t.accent, pick: (r: ActivityResponse['daily'][number]) => r.activeUserSeconds },
      { name: 'Claude (CLI)', color: t.accent2, pick: (r: ActivityResponse['daily'][number]) => r.activeCliSeconds },
    ];
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
          const lines = items.map(
            (p) =>
              `${p.marker ?? ''}${p.seriesName ?? ''}: <b>${fmtDurationSec(
                (typeof p.value === 'number' ? p.value : 0) * 3600,
              )}</b>`,
          );
          return `<div style="font-size:11px">${head}</div>${lines.join('<br/>')}`;
        },
      },
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
        name: 'hours',
        nameTextStyle: { color: t.muted, fontSize: 10 },
        axisLabel: { color: t.muted, fontSize: 10.5, formatter: (v: number) => `${fmtNumber(v)}h` },
        splitLine: { lineStyle: { color: t.border, opacity: 0.5 } },
      },
      series: series.map((s) => ({
        name: s.name,
        type: 'line' as const,
        stack: 'engaged',
        smooth: true,
        symbol: 'none' as const,
        lineStyle: { color: s.color, width: 1.5 },
        itemStyle: { color: s.color },
        areaStyle: { color: s.color, opacity: 0.3 },
        emphasis: { focus: 'series' as const },
        data: buckets.map((b) => Number(toHours(sumBy(b.rows, s.pick)).toFixed(2))),
      })),
    };
  }, [rows, gran, t]);
  return <EChart option={option} instanceRef={instanceRef} className="h-72" />;
}

// ---------------------------------------------------------------------------
// Prompts + sessions trend
// ---------------------------------------------------------------------------

function PromptsSessionsTrend({
  instanceRef,
  rows,
  gran,
}: {
  instanceRef: ChartRef;
  rows: ActivityResponse['daily'];
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
          name: 'prompts',
          nameTextStyle: { color: t.muted, fontSize: 10 },
          axisLabel: { color: t.muted, fontSize: 10.5, formatter: (v: number) => fmtNumber(v) },
          splitLine: { lineStyle: { color: t.border, opacity: 0.5 } },
        },
        {
          type: 'value',
          name: 'sessions',
          nameTextStyle: { color: t.muted, fontSize: 10 },
          axisLabel: { color: t.muted, fontSize: 10.5 },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: 'Prompts',
          type: 'bar',
          barMaxWidth: 22,
          itemStyle: { color: t.accent, opacity: 0.9, borderRadius: [3, 3, 0, 0] },
          data: buckets.map((b) => sumBy(b.rows, (r) => r.prompts)),
        },
        {
          name: 'Sessions',
          type: 'line',
          yAxisIndex: 1,
          smooth: true,
          symbolSize: 5,
          lineStyle: { color: t.accent2, width: 2 },
          itemStyle: { color: t.accent2 },
          data: buckets.map((b) => sumBy(b.rows, (r) => r.sessions)),
        },
      ],
    };
  }, [rows, gran, t]);
  return <EChart option={option} instanceRef={instanceRef} className="h-72" />;
}

// ---------------------------------------------------------------------------
// Live today (last 24h of UTC hours, shown in Asia/Jerusalem)
// ---------------------------------------------------------------------------

function LivePulseDot() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-good/30 bg-good/10 px-2 py-0.5 text-[10.5px] font-semibold text-good">
      <span className="relative flex size-1.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-good opacity-75" />
        <span className="relative inline-flex size-1.5 rounded-full bg-good" />
      </span>
      Live
    </span>
  );
}

function LiveTodayCard({
  activity,
  isLoading,
  noData,
}: {
  activity: ActivityResponse | undefined;
  isLoading: boolean;
  noData: boolean;
}) {
  const hours = useMemo(() => {
    const cutoff = DateTime.utc().minus({ hours: 24 });
    return (activity?.hourly ?? [])
      .filter((h) => {
        const dt = DateTime.fromISO(h.hourUtc, { zone: 'utc' });
        return dt.isValid && dt >= cutoff;
      })
      .sort((a, b) => (a.hourUtc < b.hourUtc ? -1 : 1));
  }, [activity]);

  return (
    <ChartCard
      title="Live today"
      chartId="live-today"
      metricKey="promptCadence"
      infoExtra="Hourly prompts, API requests, and active people over the last 24 hours, straight from the live OTel feed. Auto-refreshes every 60 seconds."
      subtitle={`Last 24h · ${displayZone()} hours`}
      actions={<LivePulseDot />}
      className="col-span-12 lg:col-span-8"
      isLoading={isLoading}
      isEmpty={noData || hours.length === 0}
      emptyText={noData ? 'Waiting for telemetry events' : 'No activity in the last 24 hours'}
    >
      {(ref) => <LiveTodayChart instanceRef={ref} hours={hours} />}
    </ChartCard>
  );
}

function LiveTodayChart({
  instanceRef,
  hours,
}: {
  instanceRef: ChartRef;
  hours: ActivityResponse['hourly'];
}) {
  const t = useChartTheme();
  const option = useMemo<EChartsOption>(() => {
    const labels = hours.map((h) =>
      DateTime.fromISO(h.hourUtc, { zone: 'utc' }).setZone(displayZone()).toFormat('HH:00'),
    );
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
        axisLabel: { color: t.muted, fontSize: 10 },
      },
      yAxis: [
        {
          type: 'value',
          axisLabel: { color: t.muted, fontSize: 10.5, formatter: (v: number) => fmtNumber(v) },
          splitLine: { lineStyle: { color: t.border, opacity: 0.5 } },
        },
        {
          type: 'value',
          name: 'people',
          nameTextStyle: { color: t.muted, fontSize: 10 },
          minInterval: 1,
          axisLabel: { color: t.muted, fontSize: 10.5 },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: 'Prompts',
          type: 'bar',
          stack: 'live',
          barMaxWidth: 14,
          itemStyle: { color: t.accent, opacity: 0.9 },
          data: hours.map((h) => h.prompts),
        },
        {
          name: 'API requests',
          type: 'bar',
          stack: 'live',
          barMaxWidth: 14,
          itemStyle: { color: t.accent2, opacity: 0.75 },
          data: hours.map((h) => h.apiRequests),
        },
        {
          name: 'Active people',
          type: 'line',
          yAxisIndex: 1,
          smooth: true,
          symbolSize: 4,
          lineStyle: { color: t.good, width: 2 },
          itemStyle: { color: t.good },
          data: hours.map((h) => h.activeUsers),
        },
      ],
    };
  }, [hours, t]);
  return <EChart option={option} instanceRef={instanceRef} className="h-72" />;
}

// ---------------------------------------------------------------------------
// Session length card
// ---------------------------------------------------------------------------

function SessionLengthCard({
  activity,
  isLoading,
  noData,
}: {
  activity: ActivityResponse | undefined;
  isLoading: boolean;
  noData: boolean;
}) {
  const totals = activity?.totals;
  const engagedShare =
    totals && totals.avgSessionMs && totals.avgSessionMs > 0 && totals.sessions > 0
      ? Math.min(1, (totals.activeUserSeconds * 1000) / (totals.avgSessionMs * totals.sessions))
      : null;
  return (
    <ChartCard
      title="Session length"
      chartId="session-length"
      metricKey="sessionLength"
      subtitle="Wall-clock span incl. idle — compare with Engaged time"
      className="col-span-12 lg:col-span-4"
      noExport
      isLoading={isLoading}
      isEmpty={noData || !totals || totals.avgSessionMs === null}
      emptyText={noData ? 'Waiting for telemetry events' : 'No sessions tracked in this range'}
    >
      <div className="flex h-full flex-col justify-center gap-4 py-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-border bg-fg/[0.03] p-3.5 text-center">
            <div className="text-[10.5px] font-semibold uppercase tracking-wider text-muted">Average</div>
            <div className="mt-1 text-2xl font-semibold tracking-tight">
              {fmtDurationMs(totals?.avgSessionMs)}
            </div>
          </div>
          <div className="rounded-xl border border-border bg-fg/[0.03] p-3.5 text-center">
            <div className="text-[10.5px] font-semibold uppercase tracking-wider text-muted">Median</div>
            <div className="mt-1 text-2xl font-semibold tracking-tight">
              {fmtDurationMs(totals?.medianSessionMs)}
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-warn/25 bg-warn/[0.07] px-2.5 py-1.5 text-[11px] leading-relaxed text-muted">
          <span className="font-medium text-warn">Span incl. idle</span> — a session left open over
          lunch counts.{' '}
          {engagedShare !== null &&
            `Roughly ${Math.round(engagedShare * 100)}% of the average span is genuinely engaged time.`}
        </div>
      </div>
    </ChartCard>
  );
}

// ---------------------------------------------------------------------------
// Per-user table
// ---------------------------------------------------------------------------

function PerUserTable({ rows }: { rows: ActivityResponse['perUser'] }) {
  const sorted = useMemo(
    () => [...rows].sort((a, b) => b.activeUserSeconds - a.activeUserSeconds),
    [rows],
  );
  const maxEngaged = sorted[0]?.activeUserSeconds ?? 0;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border">
            {['Member', 'Engaged time', '', 'Prompts', 'Sessions', 'Avg session'].map((h, i) => (
              <th
                key={`${h}-${i}`}
                className={cn(
                  'whitespace-nowrap px-2.5 py-2 text-[10.5px] font-semibold uppercase tracking-wider text-muted',
                  i >= 3 && 'text-right',
                )}
              >
                {h}
              </th>
            ))}
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
              <td className="whitespace-nowrap px-2.5 py-2 text-[13px] font-medium">
                {fmtDurationSec(u.activeUserSeconds)}
              </td>
              <td className="w-40 px-2.5 py-2">
                <span className="block h-[5px] w-full overflow-hidden rounded-full bg-fg/10">
                  <span
                    className="block h-full rounded-full bg-accent"
                    style={{
                      width: `${maxEngaged > 0 ? Math.max(2, Math.round((u.activeUserSeconds / maxEngaged) * 100)) : 0}%`,
                    }}
                  />
                </span>
              </td>
              <td className="whitespace-nowrap px-2.5 py-2 text-right text-xs text-muted">
                {fmtNumber(u.prompts)}
              </td>
              <td className="whitespace-nowrap px-2.5 py-2 text-right text-xs text-muted">
                {fmtNumber(u.sessions)}
              </td>
              <td className="whitespace-nowrap px-2.5 py-2 text-right text-xs text-muted">
                {fmtDurationMs(u.avgSessionMs)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
