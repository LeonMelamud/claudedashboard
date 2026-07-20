import type { SyncJobType, SyncRunInfo, SyncStatusResponse } from '@dash/shared';
import type { Env } from '../env';
import type { Repos } from '../repos';
import type { SyncLogBus, SyncLogger } from './logBus';

type Trigger = 'cron' | 'manual' | 'startup';

interface QueuedJob {
  type: SyncJobType;
  trigger: Trigger;
}

/**
 * One data source = one plan. The manager owns the queue and run bookkeeping;
 * the plan (console Admin API vs claude.ai Enterprise Analytics) owns what a
 * given job type actually does. Demo mode has no plan at all.
 */
export interface SyncPlan {
  runJob(
    run: SyncRunInfo,
    onProgress: (progress: NonNullable<SyncRunInfo['progress']>, rowsWritten: number) => void,
    log: SyncLogger,
  ): Promise<number>;
  /** Drives the boot catch-up: has the initial historical backfill completed? */
  isBackfillDone(): boolean;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Compact one-liner from a progress tick for the live log. */
function progressLine(progress: NonNullable<SyncRunInfo['progress']>, rowsWritten: number): string {
  const parts: string[] = [];
  if (progress.currentDate) parts.push(`at ${progress.currentDate}`);
  if (progress.daysDone !== undefined) parts.push(`${progress.daysDone} days`);
  if (progress.emptyStreak !== undefined) parts.push(`${progress.emptyStreak} empty`);
  if (progress.earliestFound) parts.push(`earliest ${progress.earliestFound}`);
  parts.push(`${rowsWritten} rows`);
  return `progress: ${parts.join(' · ')}`;
}

/** Serial in-process job queue — never two sync jobs at once. */
export class SyncManager {
  private activeRunId: number | null = null;
  private queue: QueuedJob[] = [];

  constructor(
    private readonly env: Env,
    private readonly repos: Repos,
    private readonly plan: SyncPlan | null,
    private readonly logs: SyncLogBus,
  ) {
    // a crashed process may have left a run 'running'
    this.repos.sync.cancelStaleRunning();
  }

  isBusy(): boolean {
    return this.activeRunId !== null || this.queue.length > 0;
  }

  isBackfillDone(): boolean {
    return this.plan ? this.plan.isBackfillDone() : true;
  }

  /** Manual trigger (route): starts immediately or reports busy with null. */
  tryStart(type: SyncJobType, trigger: Trigger): SyncRunInfo | null {
    if (this.isBusy()) return null;
    const run = this.repos.sync.createRun(type, trigger);
    this.activeRunId = run.id;
    void this.executeRun(run);
    return run;
  }

  /** Scheduler trigger: queues behind whatever is running. */
  enqueue(type: SyncJobType, trigger: Trigger): void {
    this.queue.push({ type, trigger });
    this.drainIfIdle();
  }

  private drainIfIdle(): void {
    if (this.activeRunId !== null) return;
    const job = this.queue.shift();
    if (!job) return;
    const run = this.repos.sync.createRun(job.type, job.trigger);
    this.activeRunId = run.id;
    void this.executeRun(run);
  }

  private async executeRun(run: SyncRunInfo): Promise<void> {
    const startedAt = Date.now();
    this.logs.startRun(run.id);
    this.logs.emit('info', 'sync', `▶ ${run.jobType} sync started (trigger: ${run.trigger})`);
    try {
      if (!this.plan) throw new Error('sync unavailable: no data source configured (demo mode)');
      const rows = await this.plan.runJob(
        run,
        (progress, rowsWritten) => {
          this.repos.sync.updateProgress(run.id, progress, rowsWritten);
          this.logs.emit('info', 'sync', progressLine(progress, rowsWritten));
        },
        this.logs.logger('step'),
      );
      this.repos.sync.finishRun(run.id, 'success', rows, null);
      const secs = ((Date.now() - startedAt) / 1000).toFixed(1);
      this.logs.emit('info', 'sync', `✔ ${run.jobType} finished: ${rows} rows in ${secs}s`);
    } catch (err) {
      const current = this.repos.sync.getRun(run.id);
      const message = errorMessage(err);
      this.repos.sync.finishRun(run.id, 'error', current?.rowsWritten ?? 0, message);
      this.logs.emit('error', 'sync', `✗ ${run.jobType} failed: ${message}`);
    } finally {
      this.activeRunId = null;
      this.logs.finishRun(run.id);
      this.drainIfIdle();
    }
  }

  getStatus(): SyncStatusResponse {
    const running = this.activeRunId !== null ? (this.repos.sync.getRun(this.activeRunId) ?? null) : null;
    return {
      running,
      lastRuns: this.repos.sync.lastRunPerType(),
      // data_source rides in the watermarks map — SyncStatusResponse lives in
      // @dash/shared and must not change shape for this.
      watermarks: { ...this.repos.sync.allState(), data_source: this.env.dataSource },
      demoMode: this.env.demoMode,
      dataFreshAt: this.repos.sync.dataFreshAt(),
    };
  }
}
