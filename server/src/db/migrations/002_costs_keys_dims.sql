-- Invoice-grade daily cost line items from GET /v1/organizations/cost_report
-- (bucket_width=1d, grouped by workspace_id + description). SQLite UNIQUE
-- treats NULLs as distinct, so every dimension column stores '' instead of
-- NULL (same trick as usage_daily.terminal_type); workspace_id '' means the
-- default workspace. amount_cents keeps the API's decimal value verbatim —
-- round at display only.
CREATE TABLE cost_daily (
  id             INTEGER PRIMARY KEY,
  date           TEXT NOT NULL,                -- 'YYYY-MM-DD' UTC
  workspace_id   TEXT NOT NULL DEFAULT '',     -- '' = default workspace
  cost_type      TEXT NOT NULL DEFAULT 'other',
  token_type     TEXT NOT NULL DEFAULT '',
  model          TEXT NOT NULL DEFAULT '',
  service_tier   TEXT NOT NULL DEFAULT '',
  context_window TEXT NOT NULL DEFAULT '',
  description    TEXT NOT NULL DEFAULT '',
  amount_cents   REAL NOT NULL DEFAULT 0,
  currency       TEXT NOT NULL DEFAULT 'USD',
  UNIQUE (date, workspace_id, cost_type, token_type, model, service_tier, context_window, description)
);
CREATE INDEX ix_cost_daily_date ON cost_daily(date);

-- Org workspaces (GET /v1/organizations/workspaces, include_archived=true).
-- Full replace every sync run — names feed the cost byWorkspace breakdown.
CREATE TABLE workspaces (
  id            TEXT PRIMARY KEY,               -- wrkspc_...
  name          TEXT NOT NULL,
  display_color TEXT,
  archived_at   TEXT
);

-- API key inventory (GET /v1/organizations/api_keys). Full replace per run.
-- created_by_user_id is the Anthropic user_... id — resolved to a display
-- name via users.anthropic_user_id at query time.
CREATE TABLE api_keys (
  id                 TEXT PRIMARY KEY,          -- apikey_...
  name               TEXT NOT NULL,
  status             TEXT NOT NULL,             -- active | inactive | archived | expired
  partial_key_hint   TEXT,
  created_at         TEXT,
  created_by_user_id TEXT,                      -- anthropic user_... id
  workspace_id       TEXT                       -- NULL = default workspace
);

-- Per-key daily token usage (usage_report/messages grouped by api_key_id).
CREATE TABLE usage_api_keys_daily (
  id                    INTEGER PRIMARY KEY,
  date                  TEXT NOT NULL,          -- 'YYYY-MM-DD' UTC
  api_key_id            TEXT NOT NULL,
  uncached_input_tokens INTEGER NOT NULL DEFAULT 0,
  cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens     INTEGER NOT NULL DEFAULT 0,
  output_tokens         INTEGER NOT NULL DEFAULT 0,
  UNIQUE (date, api_key_id)
);
CREATE INDEX ix_uakd_date ON usage_api_keys_daily(date);

-- Org-level consumption slices (usage_report/messages grouped by
-- service_tier + context_window). '' = the API returned null for the slice.
CREATE TABLE usage_dimensions_daily (
  id                    INTEGER PRIMARY KEY,
  date                  TEXT NOT NULL,          -- 'YYYY-MM-DD' UTC
  service_tier          TEXT NOT NULL DEFAULT '',
  context_window        TEXT NOT NULL DEFAULT '',
  uncached_input_tokens INTEGER NOT NULL DEFAULT 0,
  cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens     INTEGER NOT NULL DEFAULT 0,
  output_tokens         INTEGER NOT NULL DEFAULT 0,
  UNIQUE (date, service_tier, context_window)
);
CREATE INDEX ix_udd_date ON usage_dimensions_daily(date);

-- Server-side web search calls per user-hour (usage_report/messages
-- results[].server_tool_use.web_search_requests).
ALTER TABLE usage_hourly ADD COLUMN web_search_requests INTEGER NOT NULL DEFAULT 0;
