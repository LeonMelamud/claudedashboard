import { addDays, type SyncRunInfo } from '@dash/shared';
import type { Repos } from '../repos';
import { DEDUP_RETENTION_MS } from '../repos/otelRepo';
import { nowIso, todayUtc } from '../util/time';
import type { SyncLogger } from './logBus';
import type { SyncPlan } from './manager';
import { writeSnapshots } from './snapshot';

/** otel_sessions rows older than this are dropped by the nightly job. */
const SESSION_RETENTION_DAYS = 90;

/** sync_state key the nightly bumps so the freshness pill has a heartbeat. */
export const TELEMETRY_STATE_NIGHTLY_AT = 'telemetry_nightly_at';

/**
 * Telemetry-mode sync plan: there is no upstream API to pull from — data
 * arrives via OTLP push at /otel/v1/{logs,metrics}. The nightly job is pure
 * housekeeping (score snapshots + retention pruning); every pull-shaped job
 * is a no-op by design.
 */
export class TelemetrySyncPlan implements SyncPlan {
  constructor(private readonly repos: Repos) {}

  /** No history to pull — a push receiver is "backfilled" from day one. */
  isBackfillDone(): boolean {
    return true;
  }

  async runJob(
    run: SyncRunInfo,
    _onProgress: Parameters<SyncPlan['runJob']>[1],
    log: SyncLogger,
  ): Promise<number> {
    switch (run.jobType) {
      case 'nightly': {
        log.info('nightly: recomputing score snapshots');
        const snapshots = writeSnapshots(this.repos);
        log.info('nightly: pruning telemetry retention tables');
        const prunedSessions = this.repos.otel.pruneSessions(addDays(todayUtc(), -SESSION_RETENTION_DAYS));
        const prunedDedup = this.repos.otel.pruneDedup(new Date(Date.now() - DEDUP_RETENTION_MS).toISOString());
        this.repos.sync.setState(TELEMETRY_STATE_NIGHTLY_AT, nowIso());
        return snapshots + prunedSessions + prunedDedup;
      }
      case 'daily':
      case 'hourly':
      case 'roster':
      case 'backfill':
        log.info('telemetry mode: data arrives via push');
        return 0;
      default: {
        const exhaustive: never = run.jobType;
        throw new Error(`unknown job type ${String(exhaustive)}`);
      }
    }
  }
}
