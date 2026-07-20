import { useEffect, useRef, useState } from 'react';
import { DateTime } from 'luxon';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  FlaskConical,
  Loader2,
  Maximize2,
  Play,
  TerminalSquare,
  XCircle,
} from 'lucide-react';
import type { SyncJobType, SyncLogLine, SyncRunInfo } from '@dash/shared';
import { useRunSync, useSyncLogTail, useSyncStatus } from '@/lib/queries';
import { ApiError } from '@/lib/api';
import { toast } from '@/state/toast';
import { ErrorCard } from '@/components/ErrorCard';
import { Skeleton } from '@/components/Skeleton';
import { Button, Modal, Segmented } from '@/components/ui';
import { relativeIso, fmtNumber } from '@/lib/format';
import { cn } from '@/lib/utils';

const JOB_TYPES: Array<{ type: SyncJobType; label: string; blurb: string }> = [
  { type: 'backfill', label: 'Backfill', blurb: 'Walks history day by day until the data runs out.' },
  { type: 'daily', label: 'Daily', blurb: 'Pulls the latest full-day usage snapshots.' },
  { type: 'hourly', label: 'Hourly', blurb: 'Fetches hour-level activity for the heatmaps.' },
  { type: 'roster', label: 'Roster', blurb: 'Syncs org members, roles and seat assignments.' },
  { type: 'nightly', label: 'Nightly', blurb: 'Recomputes scores, segments and badges.' },
];

export default function AdminSync() {
  const statusQ = useSyncStatus(5000);
  const runSync = useRunSync();

  if (statusQ.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-7 w-40" />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      </div>
    );
  }
  if (statusQ.error) return <ErrorCard error={statusQ.error} onRetry={() => void statusQ.refetch()} />;
  const status = statusQ.data;
  if (!status) return null;

  const run = (type: SyncJobType) => {
    runSync.mutate(type, {
      onSuccess: () => toast(`Started ${type} sync`, 'success'),
      onError: (e) => {
        if (e instanceof ApiError && e.status === 409) {
          toast('A sync is already running', 'error', 'Wait for it to finish, then try again.');
        } else if (e instanceof ApiError && e.status === 400) {
          toast('Sync unavailable', 'error', e.message);
        } else {
          toast('Could not start sync', 'error', e instanceof Error ? e.message : undefined);
        }
      },
    });
  };

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Sync</h1>
        <p className="mt-0.5 text-xs text-muted">
          Data freshness: {status.dataFreshAt ? relativeIso(status.dataFreshAt) : 'no successful write yet'}
        </p>
      </header>

      {status.demoMode && (
        <div className="card flex items-center gap-3 border-accent2/40 bg-accent2/10 p-3.5">
          <FlaskConical size={16} className="shrink-0 text-accent2" />
          <div className="text-xs">
            <span className="font-semibold text-accent2">Demo mode.</span>{' '}
            <span className="text-muted">
              This instance serves synthetic data — sync jobs are disabled and "Run now" will be rejected.
            </span>
          </div>
        </div>
      )}

      {status.running && <RunningBanner run={status.running} />}

      {!status.demoMode && (
        <SyncConsole
          running={status.running !== null}
          lastErrored={Object.values(status.lastRuns).some((r) => r?.status === 'error')}
        />
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {JOB_TYPES.map(({ type, label, blurb }) => {
          const last = status.lastRuns[type];
          const isThisRunning = status.running?.jobType === type;
          return (
            <section key={type} className={cn('card p-4', isThisRunning && 'border-accent/50')}>
              <div className="flex items-center gap-2">
                <StatusIcon run={isThisRunning ? status.running : last} />
                <h3 className="text-sm font-semibold">{label}</h3>
                <span className="ml-auto">
                  <Button
                    onClick={() => run(type)}
                    disabled={status.running !== null || runSync.isPending || status.demoMode}
                    title={
                      status.demoMode
                        ? 'Disabled in demo mode'
                        : status.running
                          ? 'Another job is running'
                          : `Run ${label.toLowerCase()} sync now`
                    }
                  >
                    <Play size={11} /> Run now
                  </Button>
                </span>
              </div>
              <p className="mt-1 text-[11px] text-muted">{blurb}</p>
              {last ? (
                <dl className="mt-3 space-y-1 text-[11.5px]">
                  <Row k="Status">
                    <span
                      className={cn(
                        'font-medium',
                        last.status === 'success' && 'text-good',
                        last.status === 'error' && 'text-risk',
                        last.status === 'running' && 'text-accent',
                        last.status === 'cancelled' && 'text-muted',
                      )}
                    >
                      {last.status}
                    </span>
                    <span className="text-muted"> · {last.trigger}</span>
                  </Row>
                  <Row k="Started">{relativeIso(last.startedAt)}</Row>
                  <Row k="Finished">{last.finishedAt ? relativeIso(last.finishedAt) : '—'}</Row>
                  <Row k="Rows written">{fmtNumber(last.rowsWritten)}</Row>
                  {last.error && (
                    <div className="mt-1.5 rounded-md border border-risk/30 bg-risk/10 px-2 py-1.5 text-[11px] text-risk">
                      {last.error}
                    </div>
                  )}
                </dl>
              ) : (
                <div className="mt-3 text-[11px] text-muted">Never run.</div>
              )}
            </section>
          );
        })}

        <section className="card p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Clock size={14} className="text-muted" /> Watermarks
          </h3>
          <p className="mt-1 text-[11px] text-muted">How far each stream has been ingested.</p>
          {Object.keys(status.watermarks).length === 0 ? (
            <div className="mt-3 text-[11px] text-muted">No watermarks yet.</div>
          ) : (
            <dl className="mt-3 space-y-1 text-[11.5px]">
              {Object.entries(status.watermarks).map(([k, v]) => (
                <Row key={k} k={k}>
                  {v}
                </Row>
              ))}
            </dl>
          )}
        </section>
      </div>
    </div>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted">{k}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

function StatusIcon({ run }: { run: SyncRunInfo | null | undefined }) {
  if (!run) return <Clock size={15} className="text-muted" />;
  switch (run.status) {
    case 'running':
      return <Loader2 size={15} className="animate-spin text-accent" />;
    case 'success':
      return <CheckCircle2 size={15} className="text-good" />;
    case 'error':
      return <XCircle size={15} className="text-risk" />;
    case 'cancelled':
      return <AlertTriangle size={15} className="text-warn" />;
  }
}

function RunningBanner({ run }: { run: SyncRunInfo }) {
  const p = run.progress;
  const startedMin = Math.max(0, Math.round(-DateTime.fromISO(run.startedAt).diffNow('minutes').minutes));
  // Backfill "progress feel": empty-streak counts toward the stop condition.
  const emptyStreakTarget = 10;
  const frac =
    run.jobType === 'backfill' && p?.emptyStreak !== undefined
      ? Math.min(1, p.emptyStreak / emptyStreakTarget)
      : null;
  return (
    <div className="card border-accent/40 p-4">
      <div className="flex items-center gap-2.5">
        <Loader2 size={16} className="animate-spin text-accent" />
        <div className="text-sm font-semibold capitalize">{run.jobType} sync running…</div>
        <span className="text-[11px] text-muted">
          started {startedMin}m ago · {fmtNumber(run.rowsWritten)} rows so far
        </span>
      </div>
      {p && (
        <div className="mt-2 flex flex-wrap gap-4 text-[11.5px] text-muted">
          {p.currentDate && (
            <span>
              At <b className="text-fg">{p.currentDate}</b>
            </span>
          )}
          {p.daysDone !== undefined && (
            <span>
              <b className="text-fg">{p.daysDone}</b> days done
            </span>
          )}
          {p.emptyStreak !== undefined && (
            <span>
              <b className="text-fg">{p.emptyStreak}</b> empty days in a row (stops at {emptyStreakTarget})
            </span>
          )}
          {p.earliestFound && (
            <span>
              earliest data <b className="text-fg">{p.earliestFound}</b>
            </span>
          )}
        </div>
      )}
      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-fg/10">
        <div
          className="progress-stripes h-full rounded-full transition-all"
          style={{ width: frac !== null ? `${Math.max(8, Math.round(frac * 100))}%` : '100%' }}
        />
      </div>
    </div>
  );
}

type LogFilter = 'all' | 'errors';

/**
 * Live console for the running (or last) sync: streams API calls, step lines and
 * errors. Polls only while expanded; opening from seq 0 replays the server's
 * retained buffer, so a failure stays readable after the job ends.
 */
function SyncConsole({ running, lastErrored }: { running: boolean; lastErrored: boolean }) {
  const [open, setOpen] = useState(running || lastErrored);
  const [fullscreen, setFullscreen] = useState(false);
  const [filter, setFilter] = useState<LogFilter>('all');

  // Pop the console open whenever a run starts.
  useEffect(() => {
    if (running) setOpen(true);
  }, [running]);

  const { lines } = useSyncLogTail(open || fullscreen);
  const shown = filter === 'errors' ? lines.filter((l) => l.level === 'warn' || l.level === 'error') : lines;

  const copy = () => {
    void navigator.clipboard?.writeText(
      lines.map((l) => `${l.ts} ${l.level} ${l.source} ${l.message}`).join('\n'),
    );
  };

  const controls = (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-muted">{shown.length} lines</span>
      <Segmented<LogFilter>
        size="xs"
        value={filter}
        onChange={setFilter}
        options={[
          { id: 'all', label: 'All' },
          { id: 'errors', label: 'Errors' },
        ]}
      />
      <Button variant="ghost" onClick={copy} title="Copy all lines">
        <Copy size={11} /> Copy
      </Button>
    </div>
  );

  return (
    <section className="card p-4">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 text-sm font-semibold"
        >
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <TerminalSquare size={14} className="text-muted" /> Console
        </button>
        {running && <Loader2 size={13} className="animate-spin text-accent" />}
        <div className="ml-auto flex items-center gap-2">
          {open && controls}
          {open && (
            <Button variant="ghost" onClick={() => setFullscreen(true)} title="Expand">
              <Maximize2 size={11} />
            </Button>
          )}
        </div>
      </div>
      <p className="mt-1 text-[11px] text-muted">Live API calls, steps and errors from the sync.</p>
      {open && <LogList lines={shown} className="mt-3 max-h-[420px]" />}

      <Modal open={fullscreen} onOpenChange={setFullscreen} title="Sync console" className="w-[min(94vw,900px)]">
        <div className="mb-3 flex items-center justify-end">{controls}</div>
        <LogList lines={shown} className="max-h-[70vh]" />
      </Modal>
    </section>
  );
}

function LogList({ lines, className }: { lines: SyncLogLine[]; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  // Auto-scroll to the newest line unless the user has scrolled up to read.
  useEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [lines]);

  const onScroll = () => {
    const el = ref.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  return (
    <div
      ref={ref}
      onScroll={onScroll}
      className={cn(
        'overflow-y-auto rounded-lg border border-border bg-bg p-3 font-mono text-[11px] leading-relaxed',
        className,
      )}
    >
      {lines.length === 0 ? (
        <div className="text-muted">No log lines yet.</div>
      ) : (
        lines.map((l) => <LogRow key={l.seq} line={l} />)
      )}
    </div>
  );
}

function LogRow({ line }: { line: SyncLogLine }) {
  const color =
    line.level === 'error'
      ? 'text-risk'
      : line.level === 'warn'
        ? 'text-warn'
        : line.level === 'debug'
          ? 'text-muted'
          : 'text-fg';
  return (
    <div className={cn('whitespace-pre-wrap break-all', color)}>
      <span className="text-muted">{line.ts.slice(11, 19)}</span>{' '}
      <span className="text-muted">{line.source}</span> {line.message}
    </div>
  );
}
