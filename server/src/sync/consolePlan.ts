import { addDays, type SyncRunInfo } from '@dash/shared';
import type { AnthropicClient } from '../anthropic/client';
import type { Env } from '../env';
import type { Repos } from '../repos';
import { todayUtc } from '../util/time';
import { ActorResolver } from './actors';
import { syncApiKeyUsage, API_KEY_USAGE_BACKFILL_DAYS, API_KEY_USAGE_NIGHTLY_DAYS } from './apiKeyUsage';
import { runBackfill, STATE_BACKFILL_DONE, STATE_BACKFILL_EARLIEST } from './backfill';
import { syncCostReport, COST_BACKFILL_FALLBACK_DAYS, COST_NIGHTLY_DAYS } from './costReport';
import { syncDay } from './dailyUsage';
import { syncDimensions, DIMENSIONS_BACKFILL_DAYS, DIMENSIONS_NIGHTLY_DAYS } from './dimensions';
import { syncHourlyTail } from './hourlyUsage';
import type { SyncPlan } from './manager';
import type { SyncLogger } from './logBus';
import { syncOrgMeta } from './orgMeta';
import { syncRoster } from './roster';
import { writeSnapshots } from './snapshot';

type OnProgress = Parameters<SyncPlan['runJob']>[1];

/** Console Admin API sync plan (ADMIN_API_KEY) — the original behavior. */
export class ConsoleSyncPlan implements SyncPlan {
  constructor(
    private readonly env: Env,
    private readonly repos: Repos,
    private readonly client: AnthropicClient,
  ) {}

  isBackfillDone(): boolean {
    return this.repos.sync.getState(STATE_BACKFILL_DONE) === '1';
  }

  async runJob(run: SyncRunInfo, onProgress: OnProgress, log: SyncLogger): Promise<number> {
    const client = this.client;
    const resolver = new ActorResolver(this.repos);
    switch (run.jobType) {
      case 'roster':
        log.info('roster: syncing org members, roles and seats');
        return syncRoster(client, this.repos);
      case 'daily':
        log.info('daily: syncing recent-day usage');
        return this.syncRecentDays(client, resolver);
      case 'hourly':
        log.info('hourly: syncing hourly activity tail');
        return syncHourlyTail(client, this.repos, resolver, this.env.hourlyBackfillDays);
      case 'nightly': {
        const today = todayUtc();
        let rows = 0;
        log.info('nightly: roster');
        rows += await syncRoster(client, this.repos);
        log.info('nightly: org metadata');
        rows += await syncOrgMeta(client, this.repos);
        log.info('nightly: recent-day usage');
        rows += await this.syncRecentDays(client, resolver);
        log.info('nightly: hourly tail');
        rows += await syncHourlyTail(client, this.repos, resolver, this.env.hourlyBackfillDays);
        log.info('nightly: cost report');
        rows += await syncCostReport(client, this.repos, addDays(today, -(COST_NIGHTLY_DAYS - 1)), today);
        log.info('nightly: api-key usage');
        rows += await syncApiKeyUsage(client, this.repos, addDays(today, -(API_KEY_USAGE_NIGHTLY_DAYS - 1)), today);
        log.info('nightly: usage dimensions');
        rows += await syncDimensions(client, this.repos, addDays(today, -(DIMENSIONS_NIGHTLY_DAYS - 1)), today);
        log.info('nightly: recomputing score snapshots');
        writeSnapshots(this.repos);
        return rows;
      }
      case 'backfill': {
        let rows = 0;
        log.info('backfill: roster');
        rows += await syncRoster(client, this.repos);
        log.info('backfill: walking usage history day by day');
        rows += await runBackfill(client, this.repos, resolver, this.env, onProgress);
        log.info('backfill: hourly tail');
        rows += await syncHourlyTail(client, this.repos, resolver, this.env.hourlyBackfillDays);
        // Cost history reaches back to the earliest usage day the backfill
        // discovered (or the configured start); per-key and dimension usage
        // use a fixed 90-day depth — governance views don't need a year.
        const today = todayUtc();
        const earliest = this.repos.sync.getState(STATE_BACKFILL_EARLIEST) ?? this.env.backfillStart;
        const costStart = earliest ?? addDays(today, -(COST_BACKFILL_FALLBACK_DAYS - 1));
        log.info(`backfill: cost report from ${costStart}`);
        rows += await syncCostReport(client, this.repos, costStart, today);
        log.info('backfill: api-key usage');
        rows += await syncApiKeyUsage(client, this.repos, addDays(today, -(API_KEY_USAGE_BACKFILL_DAYS - 1)), today);
        log.info('backfill: usage dimensions');
        rows += await syncDimensions(client, this.repos, addDays(today, -(DIMENSIONS_BACKFILL_DAYS - 1)), today);
        log.info('backfill: org metadata');
        rows += await syncOrgMeta(client, this.repos);
        log.info('backfill: recomputing score snapshots');
        writeSnapshots(this.repos);
        return rows;
      }
      default: {
        const exhaustive: never = run.jobType;
        throw new Error(`unknown job type ${String(exhaustive)}`);
      }
    }
  }

  /**
   * Nightly/intraday daily portion: re-sync every UTC day since the persisted
   * watermark (the day that was "today" at the last successful run — it may be
   * partial, so it is re-synced inclusively), with a minimum window of the
   * last 3 days and a 30-day cap so a very long outage does not turn this
   * into a full backfill (beyond that, re-run backfill manually).
   */
  private async syncRecentDays(client: AnthropicClient, resolver: ActorResolver): Promise<number> {
    const today = todayUtc();
    const watermark = this.repos.sync.getState('daily_watermark');
    let start = addDays(today, -2);
    if (watermark !== null && /^\d{4}-\d{2}-\d{2}$/.test(watermark) && watermark < start) {
      start = watermark; // catch up every day since the last successful run
    }
    const cap = addDays(today, -30);
    if (start < cap) start = cap;
    let rows = 0;
    for (let date = start; date <= today; date = addDays(date, 1)) {
      rows += await syncDay(client, this.repos, resolver, date);
    }
    this.repos.sync.setState('daily_watermark', today);
    return rows;
  }
}
