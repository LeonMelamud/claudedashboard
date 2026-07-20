import cron from 'node-cron';
import type { Env } from '../env';
import type { Repos } from '../repos';
import type { SyncManager } from './manager';

const NIGHTLY_STALE_MS = 26 * 3_600_000;

/**
 * Wire up cron + intraday interval + boot catch-up. All of it is disabled in
 * DEMO_MODE (never called — but guarded here too).
 */
export function startScheduler(env: Env, manager: SyncManager, repos: Repos): void {
  if (env.demoMode) return;

  // Nightly full sync at SYNC_CRON in SYNC_TZ
  cron.schedule(env.syncCron, () => manager.enqueue('nightly', 'cron'), { timezone: env.syncTz });

  // Intraday: refresh the freshest days + hourly tail every N minutes.
  // Under the enterprise plan 'daily' means tokens+cost for the last 2 days
  // only (engagement lags 1–3 days); under console it re-syncs recent days.
  if (env.intradaySyncMinutes > 0) {
    const interval = setInterval(() => {
      if (manager.isBusy()) return; // skip a tick rather than pile up
      manager.enqueue('daily', 'cron');
      manager.enqueue('hourly', 'cron');
    }, env.intradaySyncMinutes * 60_000);
    interval.unref();
  }

  // Boot catch-up — each plan tracks its own backfill cursor/done flag
  if (!manager.isBackfillDone()) {
    manager.enqueue('backfill', 'startup');
    return;
  }
  const lastNightly = repos.sync.lastSuccessfulRun('nightly');
  const finishedAt = lastNightly?.finishedAt ? Date.parse(lastNightly.finishedAt) : NaN;
  if (!Number.isFinite(finishedAt) || Date.now() - finishedAt > NIGHTLY_STALE_MS) {
    manager.enqueue('nightly', 'startup');
  }
}
