import { addDays } from '@dash/shared';
import type { AnthropicClient } from '../anthropic/client';
import type { Env } from '../env';
import type { Repos } from '../repos';
import { todayUtc } from '../util/time';
import type { ActorResolver } from './actors';
import { syncDay } from './dailyUsage';

const HARD_CAP_DAYS = 400;

export const STATE_BACKFILL_CURSOR = 'backfill_cursor';
export const STATE_BACKFILL_DONE = 'backfill_done';
export const STATE_BACKFILL_EARLIEST = 'backfill_earliest_date';

export interface BackfillProgress {
  currentDate?: string;
  daysDone?: number;
  emptyStreak?: number;
  earliestFound?: string;
}

/**
 * Walk daily usage newest→oldest starting at today UTC (or the persisted
 * cursor when resuming). Stops at BACKFILL_START, or — when no explicit start
 * is configured — after BACKFILL_EMPTY_STREAK consecutive empty days, with a
 * hard cap of 400 days. Progress is persisted after every day.
 */
export async function runBackfill(
  client: AnthropicClient,
  repos: Repos,
  resolver: ActorResolver,
  env: Env,
  onProgress: (progress: BackfillProgress, rowsWritten: number) => void,
): Promise<number> {
  // A re-run after completion is a deliberate restart from today — the
  // persisted cursor points at ancient pre-history and must not be resumed.
  const alreadyDone = repos.sync.getState(STATE_BACKFILL_DONE) === '1';
  let cursor = alreadyDone ? todayUtc() : (repos.sync.getState(STATE_BACKFILL_CURSOR) ?? todayUtc());
  let earliestFound = repos.sync.getState(STATE_BACKFILL_EARLIEST) ?? undefined;
  let emptyStreak = 0;
  let daysDone = 0;
  let rowsWritten = 0;
  let finished = false;

  for (let i = 0; i < HARD_CAP_DAYS; i++) {
    if (env.backfillStart !== null && cursor < env.backfillStart) {
      finished = true;
      break;
    }
    if (env.backfillStart === null && emptyStreak >= env.backfillEmptyStreak) {
      finished = true;
      break;
    }

    const rows = await syncDay(client, repos, resolver, cursor);
    rowsWritten += rows;
    daysDone += 1;
    if (rows === 0) {
      emptyStreak += 1;
    } else {
      emptyStreak = 0;
      if (earliestFound === undefined || cursor < earliestFound) {
        earliestFound = cursor;
        repos.sync.setState(STATE_BACKFILL_EARLIEST, earliestFound);
      }
    }

    const next = addDays(cursor, -1);
    repos.sync.setState(STATE_BACKFILL_CURSOR, next);
    const progress: BackfillProgress = { currentDate: cursor, daysDone, emptyStreak };
    if (earliestFound !== undefined) progress.earliestFound = earliestFound;
    onProgress(progress, rowsWritten);
    cursor = next;
  }

  // Only a genuine stop condition (BACKFILL_START reached / empty streak)
  // marks the backfill done. Hitting the hard cap leaves the flag unset so
  // the boot catch-up re-enqueues a backfill that resumes from the cursor.
  if (finished) repos.sync.setState(STATE_BACKFILL_DONE, '1');
  repos.sync.setState('daily_watermark', todayUtc());
  return rowsWritten;
}
