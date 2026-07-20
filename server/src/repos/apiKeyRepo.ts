import type { Db } from '../db/connection';

export interface WorkspaceUpsertRow {
  id: string;
  name: string;
  displayColor: string | null;
  archivedAt: string | null;
}

export interface ApiKeyUpsertRow {
  id: string;
  name: string;
  status: string;
  partialKeyHint: string | null;
  createdAt: string | null;
  createdByUserId: string | null;
  workspaceId: string | null;
}

export interface ApiKeyUsageUpsertRow {
  date: string;
  apiKeyId: string;
  uncachedInputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
}

export interface ApiKeyInventoryRow {
  id: string;
  name: string;
  status: string;
  partial_key_hint: string | null;
  created_at: string | null;
  created_by_name: string | null;
  workspace_name: string | null;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  last_active_date: string | null;
}

const KEY_TOKENS_SUM =
  '(a.uncached_input_tokens + a.cache_creation_tokens + a.cache_read_tokens + a.output_tokens)';

export class ApiKeyRepo {
  constructor(private readonly db: Db) {}

  // -------------------------------------------------------------------------
  // Sync writes (org meta = full replace per run; usage = upsert per day)
  // -------------------------------------------------------------------------

  replaceWorkspaces(rows: WorkspaceUpsertRow[]): number {
    const insert = this.db.prepare(
      `INSERT INTO workspaces (id, name, display_color, archived_at)
       VALUES (@id, @name, @displayColor, @archivedAt)`,
    );
    const txn = this.db.transaction((batch: WorkspaceUpsertRow[]) => {
      this.db.prepare(`DELETE FROM workspaces`).run();
      for (const row of batch) insert.run(row);
      return batch.length;
    });
    return txn(rows);
  }

  replaceApiKeys(rows: ApiKeyUpsertRow[]): number {
    const insert = this.db.prepare(
      `INSERT INTO api_keys (id, name, status, partial_key_hint, created_at, created_by_user_id, workspace_id)
       VALUES (@id, @name, @status, @partialKeyHint, @createdAt, @createdByUserId, @workspaceId)`,
    );
    const txn = this.db.transaction((batch: ApiKeyUpsertRow[]) => {
      this.db.prepare(`DELETE FROM api_keys`).run();
      for (const row of batch) insert.run(row);
      return batch.length;
    });
    return txn(rows);
  }

  upsertDailyUsage(rows: ApiKeyUsageUpsertRow[]): number {
    const upsert = this.db.prepare(
      `INSERT INTO usage_api_keys_daily (
         date, api_key_id, uncached_input_tokens, cache_creation_tokens, cache_read_tokens, output_tokens
       ) VALUES (@date, @apiKeyId, @uncachedInputTokens, @cacheCreationTokens, @cacheReadTokens, @outputTokens)
       ON CONFLICT (date, api_key_id) DO UPDATE SET
         uncached_input_tokens = excluded.uncached_input_tokens,
         cache_creation_tokens = excluded.cache_creation_tokens,
         cache_read_tokens     = excluded.cache_read_tokens,
         output_tokens         = excluded.output_tokens`,
    );
    const txn = this.db.transaction((batch: ApiKeyUsageUpsertRow[]) => {
      for (const row of batch) upsert.run(row);
      return batch.length;
    });
    return txn(rows);
  }

  // -------------------------------------------------------------------------
  // Route aggregates
  // -------------------------------------------------------------------------

  /**
   * Full key inventory (zero-usage keys included) with token aggregates over
   * the range, creator name via users.anthropic_user_id and workspace name.
   * Sorted by total tokens desc, then name.
   */
  inventoryWithUsage(from: string, to: string): ApiKeyInventoryRow[] {
    return this.db
      .prepare(
        `SELECT
           k.id AS id,
           k.name AS name,
           k.status AS status,
           k.partial_key_hint AS partial_key_hint,
           k.created_at AS created_at,
           COALESCE(NULLIF(u.name, ''), u.email) AS created_by_name,
           w.name AS workspace_name,
           COALESCE(SUM(a.uncached_input_tokens), 0) AS input_tokens,
           COALESCE(SUM(a.output_tokens), 0) AS output_tokens,
           COALESCE(SUM(a.cache_read_tokens), 0) AS cache_read_tokens,
           COALESCE(SUM(a.cache_creation_tokens), 0) AS cache_creation_tokens,
           MAX(CASE WHEN ${KEY_TOKENS_SUM} > 0 THEN a.date END) AS last_active_date
         FROM api_keys k
         LEFT JOIN usage_api_keys_daily a ON a.api_key_id = k.id AND a.date BETWEEN @from AND @to
         LEFT JOIN users u ON u.anthropic_user_id = k.created_by_user_id
         LEFT JOIN workspaces w ON w.id = k.workspace_id
         GROUP BY k.id
         ORDER BY (COALESCE(SUM(a.uncached_input_tokens), 0) + COALESCE(SUM(a.cache_creation_tokens), 0)
                 + COALESCE(SUM(a.cache_read_tokens), 0) + COALESCE(SUM(a.output_tokens), 0)) DESC,
                  k.name COLLATE NOCASE`,
      )
      .all({ from, to }) as ApiKeyInventoryRow[];
  }
}
