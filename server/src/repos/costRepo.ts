import type { Db } from '../db/connection';

/** One cost_report line item. Dimension fields use '' instead of NULL (UNIQUE). */
export interface CostInsertRow {
  date: string;
  /** '' = default workspace */
  workspaceId: string;
  costType: string;
  tokenType: string;
  model: string;
  serviceTier: string;
  contextWindow: string;
  description: string;
  amountCents: number;
  currency: string;
}

export interface CostDailyTypeRow {
  date: string;
  cost_type: string;
  amount_cents: number;
}

export interface CostWorkspaceRow {
  workspace_id: string;
  workspace_name: string | null;
  amount_cents: number;
}

export interface CostModelRow {
  model: string;
  amount_cents: number;
}

export class CostRepo {
  constructor(private readonly db: Db) {}

  // -------------------------------------------------------------------------
  // Sync writes
  // -------------------------------------------------------------------------

  /**
   * Replace every covered date atomically: DELETE each date's rows, then
   * insert the fresh line items. Duplicate dimension tuples (e.g. split
   * across pages) are summed on conflict — safe because the dates were just
   * cleared. Returns rows written.
   */
  replaceDates(dates: string[], rows: CostInsertRow[]): number {
    const deleteDate = this.db.prepare(`DELETE FROM cost_daily WHERE date = ?`);
    const insert = this.db.prepare(
      `INSERT INTO cost_daily (
         date, workspace_id, cost_type, token_type, model, service_tier, context_window, description,
         amount_cents, currency
       ) VALUES (
         @date, @workspaceId, @costType, @tokenType, @model, @serviceTier, @contextWindow, @description,
         @amountCents, @currency
       )
       ON CONFLICT (date, workspace_id, cost_type, token_type, model, service_tier, context_window, description)
       DO UPDATE SET amount_cents = amount_cents + excluded.amount_cents`,
    );
    const txn = this.db.transaction((coveredDates: string[], lineItems: CostInsertRow[]) => {
      for (const date of coveredDates) deleteDate.run(date);
      for (const row of lineItems) insert.run(row);
      return lineItems.length;
    });
    return txn(dates, rows);
  }

  // -------------------------------------------------------------------------
  // Route aggregates
  // -------------------------------------------------------------------------

  dailyByType(from: string, to: string): CostDailyTypeRow[] {
    return this.db
      .prepare(
        `SELECT date, cost_type, COALESCE(SUM(amount_cents), 0) AS amount_cents
         FROM cost_daily
         WHERE date BETWEEN ? AND ?
         GROUP BY date, cost_type
         ORDER BY date`,
      )
      .all(from, to) as CostDailyTypeRow[];
  }

  byWorkspace(from: string, to: string): CostWorkspaceRow[] {
    return this.db
      .prepare(
        `SELECT c.workspace_id AS workspace_id, w.name AS workspace_name,
                COALESCE(SUM(c.amount_cents), 0) AS amount_cents
         FROM cost_daily c
         LEFT JOIN workspaces w ON w.id = c.workspace_id
         WHERE c.date BETWEEN ? AND ?
         GROUP BY c.workspace_id
         ORDER BY amount_cents DESC`,
      )
      .all(from, to) as CostWorkspaceRow[];
  }

  byModel(from: string, to: string): CostModelRow[] {
    return this.db
      .prepare(
        `SELECT model, COALESCE(SUM(amount_cents), 0) AS amount_cents
         FROM cost_daily
         WHERE date BETWEEN ? AND ? AND model != ''
         GROUP BY model
         ORDER BY amount_cents DESC`,
      )
      .all(from, to) as CostModelRow[];
  }

  hasData(from: string, to: string): boolean {
    const row = this.db
      .prepare(`SELECT 1 AS one FROM cost_daily WHERE date BETWEEN ? AND ? LIMIT 1`)
      .get(from, to) as { one: number } | undefined;
    return row !== undefined;
  }
}
