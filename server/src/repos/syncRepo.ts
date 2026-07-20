import type { SyncJobType, SyncRunInfo } from '@dash/shared';
import type { Db } from '../db/connection';
import { nowIso } from '../util/time';

interface SyncRunRow {
  id: number;
  job_type: SyncJobType;
  trigger: 'cron' | 'manual' | 'startup';
  status: 'running' | 'success' | 'error' | 'cancelled';
  started_at: string;
  finished_at: string | null;
  rows_written: number;
  progress_json: string | null;
  error: string | null;
}

function toRunInfo(row: SyncRunRow): SyncRunInfo {
  let progress: SyncRunInfo['progress'] = null;
  if (row.progress_json) {
    try {
      progress = JSON.parse(row.progress_json) as SyncRunInfo['progress'];
    } catch {
      progress = null;
    }
  }
  return {
    id: row.id,
    jobType: row.job_type,
    trigger: row.trigger,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    rowsWritten: row.rows_written,
    progress,
    error: row.error,
  };
}

export interface SnapshotRow {
  user_id: number;
  composite: number | null;
  segment: string | null;
  badges_json: string;
}

export class SyncRepo {
  constructor(private readonly db: Db) {}

  // --- sync_runs -----------------------------------------------------------

  createRun(jobType: SyncJobType, trigger: 'cron' | 'manual' | 'startup'): SyncRunInfo {
    const res = this.db
      .prepare(`INSERT INTO sync_runs (job_type, trigger, status, started_at) VALUES (?, ?, 'running', ?)`)
      .run(jobType, trigger, nowIso());
    const run = this.getRun(Number(res.lastInsertRowid));
    if (!run) throw new Error('sync run insert failed');
    return run;
  }

  getRun(id: number): SyncRunInfo | undefined {
    const row = this.db.prepare(`SELECT * FROM sync_runs WHERE id = ?`).get(id) as SyncRunRow | undefined;
    return row ? toRunInfo(row) : undefined;
  }

  updateProgress(id: number, progress: NonNullable<SyncRunInfo['progress']>, rowsWritten?: number): void {
    if (rowsWritten === undefined) {
      this.db.prepare(`UPDATE sync_runs SET progress_json = ? WHERE id = ?`).run(JSON.stringify(progress), id);
    } else {
      this.db
        .prepare(`UPDATE sync_runs SET progress_json = ?, rows_written = ? WHERE id = ?`)
        .run(JSON.stringify(progress), rowsWritten, id);
    }
  }

  finishRun(id: number, status: 'success' | 'error' | 'cancelled', rowsWritten: number, error: string | null): void {
    this.db
      .prepare(`UPDATE sync_runs SET status = ?, finished_at = ?, rows_written = ?, error = ? WHERE id = ?`)
      .run(status, nowIso(), rowsWritten, error, id);
  }

  /** Any run left 'running' from a previous process crash → cancelled. */
  cancelStaleRunning(): void {
    this.db
      .prepare(
        `UPDATE sync_runs SET status = 'cancelled', finished_at = ?, error = 'process restarted'
         WHERE status = 'running'`,
      )
      .run(nowIso());
  }

  lastRunPerType(): Partial<Record<SyncJobType, SyncRunInfo>> {
    const rows = this.db
      .prepare(
        `SELECT r.* FROM sync_runs r
         JOIN (
           SELECT job_type, MAX(id) AS max_id FROM sync_runs WHERE status != 'running' GROUP BY job_type
         ) latest ON latest.max_id = r.id`,
      )
      .all() as SyncRunRow[];
    const out: Partial<Record<SyncJobType, SyncRunInfo>> = {};
    for (const row of rows) out[row.job_type] = toRunInfo(row);
    return out;
  }

  lastSuccessfulRun(jobType: SyncJobType): SyncRunInfo | undefined {
    const row = this.db
      .prepare(`SELECT * FROM sync_runs WHERE job_type = ? AND status = 'success' ORDER BY id DESC LIMIT 1`)
      .get(jobType) as SyncRunRow | undefined;
    return row ? toRunInfo(row) : undefined;
  }

  /** Most recent successful data-writing job — powers the freshness pill. */
  dataFreshAt(): string | null {
    const row = this.db
      .prepare(
        `SELECT MAX(finished_at) AS at FROM sync_runs
         WHERE status = 'success' AND job_type IN ('backfill', 'daily', 'hourly', 'nightly')`,
      )
      .get() as { at: string | null };
    return row.at;
  }

  // --- sync_state ----------------------------------------------------------

  getState(key: string): string | null {
    const row = this.db.prepare(`SELECT value FROM sync_state WHERE key = ?`).get(key) as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  }

  setState(key: string, value: string): void {
    this.db
      .prepare(`INSERT INTO sync_state (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`)
      .run(key, value);
  }

  deleteState(key: string): void {
    this.db.prepare(`DELETE FROM sync_state WHERE key = ?`).run(key);
  }

  allState(): Record<string, string> {
    const rows = this.db.prepare(`SELECT key, value FROM sync_state`).all() as Array<{
      key: string;
      value: string;
    }>;
    const out: Record<string, string> = {};
    for (const row of rows) out[row.key] = row.value;
    return out;
  }

  // --- score_snapshots -----------------------------------------------------

  upsertSnapshot(
    snapshotDate: string,
    userId: number,
    rangeKey: string,
    composite: number | null,
    segment: string,
    earnedBadgeIds: string[],
  ): void {
    this.db
      .prepare(
        `INSERT INTO score_snapshots (snapshot_date, user_id, range_key, composite, segment, badges_json)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (snapshot_date, user_id, range_key) DO UPDATE SET
           composite = excluded.composite,
           segment = excluded.segment,
           badges_json = excluded.badges_json`,
      )
      .run(snapshotDate, userId, rangeKey, composite, segment, JSON.stringify(earnedBadgeIds));
  }

  /** Most recent distinct snapshot dates for a range key, newest first. */
  latestSnapshotDates(rangeKey: string, limit = 2): string[] {
    const rows = this.db
      .prepare(
        `SELECT DISTINCT snapshot_date FROM score_snapshots WHERE range_key = ?
         ORDER BY snapshot_date DESC LIMIT ?`,
      )
      .all(rangeKey, limit) as Array<{ snapshot_date: string }>;
    return rows.map((r) => r.snapshot_date);
  }

  snapshotsForDate(snapshotDate: string, rangeKey: string): Map<number, SnapshotRow> {
    const rows = this.db
      .prepare(
        `SELECT user_id, composite, segment, badges_json FROM score_snapshots
         WHERE snapshot_date = ? AND range_key = ?`,
      )
      .all(snapshotDate, rangeKey) as SnapshotRow[];
    const map = new Map<number, SnapshotRow>();
    for (const row of rows) map.set(row.user_id, row);
    return map;
  }
}
