import { Link } from 'react-router-dom';
import { DateTime } from 'luxon';
import { Database } from 'lucide-react';
import { useCapabilities, useSyncStatus } from '@/lib/queries';
import { relativeIso } from '@/lib/format';
import { Tip } from '@/components/ui';
import { cn } from '@/lib/utils';

/**
 * Header freshness pill: "Data as of 2h ago", amber >26h, red when stale/error.
 * Shows the active data-source mode; in telemetry mode freshness follows the
 * last ingested OTel event (data is pushed, not synced).
 */
export function SyncPill() {
  const { data, isError } = useSyncStatus();
  const dataSource = useCapabilities().data?.dataSource;

  let tone: 'ok' | 'warn' | 'risk' = 'ok';
  let label = 'Data: checking…';
  let tip = 'Checking sync status…';

  if (isError) {
    tone = 'risk';
    label = 'Data: unavailable';
    tip = 'Could not reach the sync status endpoint.';
  } else if (data) {
    const isTelemetry = dataSource === 'telemetry';
    const lastEvent = data.watermarks['otel_last_event_at'];
    // telemetry mode: data arrives by push — freshness is the newest of the
    // sync watermark and the last ingested event
    const freshIso =
      isTelemetry && lastEvent && (!data.dataFreshAt || lastEvent > data.dataFreshAt)
        ? lastEvent
        : data.dataFreshAt;
    const fresh = freshIso ? DateTime.fromISO(freshIso) : null;
    const ageHours = fresh?.isValid ? -fresh.diffNow('hours').hours : null;
    const lastError = Object.values(data.lastRuns).some((r) => r?.status === 'error');
    if (!fresh || ageHours === null) {
      tone = 'risk';
      label = isTelemetry ? 'Waiting for telemetry' : 'No data yet';
      tip = isTelemetry
        ? 'No telemetry events received yet — check the rollout guide.'
        : 'No successful data write recorded yet.';
    } else {
      label = `Data as of ${relativeIso(freshIso)}`;
      if (ageHours > 48 || (lastError && !isTelemetry)) tone = 'risk';
      else if (ageHours > 26) tone = 'warn';
      tip = data.running
        ? `Sync "${data.running.jobType}" is running now.`
        : isTelemetry
          ? 'Live telemetry mode: events land within seconds of activity.'
          : lastError
            ? 'A recent sync job failed — click for details.'
            : 'All sync jobs healthy. Click for details.';
    }
    if (data.demoMode) tip += ' (Demo mode: synthetic data.)';
  }

  const modeBadge = data?.demoMode ? 'demo' : dataSource && dataSource !== 'demo' ? dataSource : null;

  return (
    <Tip content={tip}>
      <Link
        to="/admin/sync"
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
          tone === 'ok' && 'border-border bg-card text-muted hover:text-fg',
          tone === 'warn' && 'border-warn/40 bg-warn/10 text-warn',
          tone === 'risk' && 'border-risk/40 bg-risk/10 text-risk',
        )}
      >
        <span className="relative flex size-1.5">
          {data?.running && (
            <span
              className={cn(
                'absolute inline-flex h-full w-full animate-ping rounded-full opacity-60',
                tone === 'ok' ? 'bg-good' : tone === 'warn' ? 'bg-warn' : 'bg-risk',
              )}
            />
          )}
          <span
            className={cn(
              'relative inline-flex size-1.5 rounded-full',
              tone === 'ok' ? 'bg-good' : tone === 'warn' ? 'bg-warn' : 'bg-risk',
            )}
          />
        </span>
        <Database size={11} />
        {label}
        {modeBadge && (
          <span className="rounded bg-accent2/20 px-1 text-[9px] uppercase text-accent2">{modeBadge}</span>
        )}
      </Link>
    </Tip>
  );
}
