import type { Db } from '../db/connection';

/** One analytics/summaries day (enterprise mode only; empty in console/demo). */
export interface OrgSummaryUpsertRow {
  date: string;
  assignedSeatCount: number;
  pendingInviteCount: number;
  dau: number;
  wau: number;
  mau: number;
  claudeCodeDau: number | null;
  rawJson: string;
}

export interface OrgSummaryRow {
  date: string;
  assigned_seat_count: number;
  pending_invite_count: number;
  dau: number;
  wau: number;
  mau: number;
  claude_code_dau: number | null;
}

export class OrgSummaryRepo {
  constructor(private readonly db: Db) {}

  upsertMany(rows: OrgSummaryUpsertRow[]): number {
    const upsert = this.db.prepare(
      `INSERT INTO org_summaries (
         date, assigned_seat_count, pending_invite_count, dau, wau, mau, claude_code_dau, raw_json
       ) VALUES (@date, @assignedSeatCount, @pendingInviteCount, @dau, @wau, @mau, @claudeCodeDau, @rawJson)
       ON CONFLICT (date) DO UPDATE SET
         assigned_seat_count  = excluded.assigned_seat_count,
         pending_invite_count = excluded.pending_invite_count,
         dau                  = excluded.dau,
         wau                  = excluded.wau,
         mau                  = excluded.mau,
         claude_code_dau      = excluded.claude_code_dau,
         raw_json             = excluded.raw_json`,
    );
    const txn = this.db.transaction((batch: OrgSummaryUpsertRow[]) => {
      for (const row of batch) upsert.run(row);
      return batch.length;
    });
    return txn(rows);
  }

  getRange(from: string, to: string): OrgSummaryRow[] {
    return this.db
      .prepare(
        `SELECT date, assigned_seat_count, pending_invite_count, dau, wau, mau, claude_code_dau
         FROM org_summaries WHERE date BETWEEN ? AND ? ORDER BY date`,
      )
      .all(from, to) as OrgSummaryRow[];
  }

  /** Most recent assigned_seat_count on record — the enterprise roster denominator. */
  latestSeatCount(): number | null {
    const row = this.db
      .prepare(`SELECT assigned_seat_count AS n FROM org_summaries ORDER BY date DESC LIMIT 1`)
      .get() as { n: number } | undefined;
    return row?.n ?? null;
  }
}
