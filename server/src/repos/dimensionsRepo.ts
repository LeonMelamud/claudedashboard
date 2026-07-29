import { utcHourRangeOfLocalDays } from '@dash/shared';
import type { Db } from '../db/connection';
import { orgTimezone } from '../util/time';

export interface DimensionUpsertRow {
  date: string;
  /** '' when the API returned null for the slice */
  serviceTier: string;
  contextWindow: string;
  uncachedInputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
}

export interface DimensionSliceRow {
  key: string;
  uncached_input_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  output_tokens: number;
}

export interface CustomerTypeSessionsRow {
  customer_type: string;
  sessions: number;
}

export interface CustomerTypeCostRow {
  customer_type: string;
  cost_cents: number;
}

export interface WebSearchUserRow {
  user_id: number;
  name: string;
  requests: number;
}

export class DimensionsRepo {
  constructor(private readonly db: Db) {}

  // -------------------------------------------------------------------------
  // Sync writes
  // -------------------------------------------------------------------------

  upsertDaily(rows: DimensionUpsertRow[]): number {
    const upsert = this.db.prepare(
      `INSERT INTO usage_dimensions_daily (
         date, service_tier, context_window,
         uncached_input_tokens, cache_creation_tokens, cache_read_tokens, output_tokens
       ) VALUES (@date, @serviceTier, @contextWindow,
                 @uncachedInputTokens, @cacheCreationTokens, @cacheReadTokens, @outputTokens)
       ON CONFLICT (date, service_tier, context_window) DO UPDATE SET
         uncached_input_tokens = excluded.uncached_input_tokens,
         cache_creation_tokens = excluded.cache_creation_tokens,
         cache_read_tokens     = excluded.cache_read_tokens,
         output_tokens         = excluded.output_tokens`,
    );
    const txn = this.db.transaction((batch: DimensionUpsertRow[]) => {
      for (const row of batch) upsert.run(row);
      return batch.length;
    });
    return txn(rows);
  }

  // -------------------------------------------------------------------------
  // Route aggregates
  // -------------------------------------------------------------------------

  slices(from: string, to: string, dimension: 'service_tier' | 'context_window'): DimensionSliceRow[] {
    // dimension is a compile-time union, never user input — safe to inline
    return this.db
      .prepare(
        `SELECT ${dimension} AS key,
                COALESCE(SUM(uncached_input_tokens), 0) AS uncached_input_tokens,
                COALESCE(SUM(cache_creation_tokens), 0) AS cache_creation_tokens,
                COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
                COALESCE(SUM(output_tokens), 0) AS output_tokens
         FROM usage_dimensions_daily
         WHERE date BETWEEN ? AND ?
         GROUP BY ${dimension}
         ORDER BY (COALESCE(SUM(uncached_input_tokens), 0) + COALESCE(SUM(cache_creation_tokens), 0)
                 + COALESCE(SUM(cache_read_tokens), 0) + COALESCE(SUM(output_tokens), 0)) DESC`,
      )
      .all(from, to) as DimensionSliceRow[];
  }

  hasData(from: string, to: string): boolean {
    const row = this.db
      .prepare(`SELECT 1 AS one FROM usage_dimensions_daily WHERE date BETWEEN ? AND ? LIMIT 1`)
      .get(from, to) as { one: number } | undefined;
    return row !== undefined;
  }

  /** Sessions by customer_type (api | subscription) from claude_code daily usage. */
  customerTypeSessions(from: string, to: string): CustomerTypeSessionsRow[] {
    return this.db
      .prepare(
        `SELECT customer_type, COALESCE(SUM(num_sessions), 0) AS sessions
         FROM usage_daily
         WHERE date BETWEEN ? AND ?
         GROUP BY customer_type`,
      )
      .all(from, to) as CustomerTypeSessionsRow[];
  }

  /** Estimated cost by customer_type via each row's model breakdown. */
  customerTypeCost(from: string, to: string): CustomerTypeCostRow[] {
    return this.db
      .prepare(
        `SELECT d.customer_type AS customer_type, COALESCE(SUM(m.cost_cents), 0) AS cost_cents
         FROM usage_daily_models m
         JOIN usage_daily d ON d.id = m.usage_daily_id
         WHERE d.date BETWEEN ? AND ?
         GROUP BY d.customer_type`,
      )
      .all(from, to) as CustomerTypeCostRow[];
  }

  webSearchTotal(from: string, to: string): number {
    const { fromHour, toHour } = utcHourRangeOfLocalDays(from, to, orgTimezone());
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(web_search_requests), 0) AS total
         FROM usage_hourly
         WHERE hour_utc >= ? AND hour_utc <= ?`,
      )
      .get(fromHour, toHour) as { total: number };
    return row.total;
  }

  webSearchTopUsers(from: string, to: string, limit: number): WebSearchUserRow[] {
    const { fromHour, toHour } = utcHourRangeOfLocalDays(from, to, orgTimezone());
    return this.db
      .prepare(
        `SELECT h.user_id AS user_id, u.name AS name,
                COALESCE(SUM(h.web_search_requests), 0) AS requests
         FROM usage_hourly h
         JOIN users u ON u.id = h.user_id
         WHERE h.hour_utc >= ? AND h.hour_utc <= ?
         GROUP BY h.user_id
         HAVING COALESCE(SUM(h.web_search_requests), 0) > 0
         ORDER BY requests DESC
         LIMIT ?`,
      )
      .all(fromHour, toHour, limit) as WebSearchUserRow[];
  }
}
