-- Telemetry mode: the OTLP receiver becomes a first-class data source.
-- Metric deltas are ADDITIVE upserts (unlike the replace-day console sync), so
-- usage_daily_models first needs a real upsert key: coalesce any historical
-- duplicate (usage_daily_id, model) rows into the first row, then enforce
-- uniqueness.
UPDATE usage_daily_models AS m SET
  input_tokens = (SELECT SUM(d.input_tokens) FROM usage_daily_models d
                  WHERE d.usage_daily_id = m.usage_daily_id AND d.model = m.model),
  output_tokens = (SELECT SUM(d.output_tokens) FROM usage_daily_models d
                   WHERE d.usage_daily_id = m.usage_daily_id AND d.model = m.model),
  cache_read_tokens = (SELECT SUM(d.cache_read_tokens) FROM usage_daily_models d
                       WHERE d.usage_daily_id = m.usage_daily_id AND d.model = m.model),
  cache_creation_tokens = (SELECT SUM(d.cache_creation_tokens) FROM usage_daily_models d
                           WHERE d.usage_daily_id = m.usage_daily_id AND d.model = m.model),
  cost_cents = (SELECT SUM(d.cost_cents) FROM usage_daily_models d
                WHERE d.usage_daily_id = m.usage_daily_id AND d.model = m.model)
WHERE m.id IN (
  SELECT MIN(id) FROM usage_daily_models GROUP BY usage_daily_id, model HAVING COUNT(*) > 1
);
DELETE FROM usage_daily_models WHERE id NOT IN (
  SELECT MIN(id) FROM usage_daily_models GROUP BY usage_daily_id, model
);
CREATE UNIQUE INDEX ux_udm_parent_model ON usage_daily_models(usage_daily_id, model);

-- claude_code.active_time.total (seconds) + session/prompt counters per UTC day.
CREATE TABLE otel_activity_daily (
  id            INTEGER PRIMARY KEY,
  date          TEXT NOT NULL,                -- 'YYYY-MM-DD' UTC
  user_id       INTEGER NOT NULL REFERENCES users(id),
  active_user_s REAL NOT NULL DEFAULT 0,      -- active_time.total{type=user}
  active_cli_s  REAL NOT NULL DEFAULT 0,      -- active_time.total{type=cli}
  prompts       INTEGER NOT NULL DEFAULT 0,
  sessions      INTEGER NOT NULL DEFAULT 0,   -- session.count
  UNIQUE (date, user_id)
);
CREATE INDEX ix_otel_activity_daily_date ON otel_activity_daily(date);

-- Hour-bucketed activity counters ('YYYY-MM-DDTHH:00:00Z', like usage_hourly).
CREATE TABLE otel_activity_hourly (
  id               INTEGER PRIMARY KEY,
  hour_utc         TEXT NOT NULL,
  user_id          INTEGER NOT NULL REFERENCES users(id),
  prompts          INTEGER NOT NULL DEFAULT 0,
  api_requests     INTEGER NOT NULL DEFAULT 0,
  sessions_started INTEGER NOT NULL DEFAULT 0,
  UNIQUE (user_id, hour_utc)
);
CREATE INDEX ix_otel_activity_hourly_hour ON otel_activity_hourly(hour_utc);

-- One row per observed Claude Code session (pruned after 90 days).
CREATE TABLE otel_sessions (
  session_id     TEXT PRIMARY KEY,
  user_id        INTEGER NOT NULL REFERENCES users(id),
  date           TEXT NOT NULL,               -- 'YYYY-MM-DD' UTC of first event
  first_event_at TEXT NOT NULL,
  last_event_at  TEXT NOT NULL,
  events         INTEGER NOT NULL DEFAULT 0,
  prompts        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX ix_otel_sessions_date_user ON otel_sessions(date, user_id);

-- API reliability per UTC day x user x model ('' when the model is unknown).
CREATE TABLE otel_reliability_daily (
  id                INTEGER PRIMARY KEY,
  date              TEXT NOT NULL,            -- 'YYYY-MM-DD' UTC
  user_id           INTEGER NOT NULL REFERENCES users(id),
  model             TEXT NOT NULL DEFAULT '',
  api_requests      INTEGER NOT NULL DEFAULT 0,
  api_errors        INTEGER NOT NULL DEFAULT 0,
  errors_429        INTEGER NOT NULL DEFAULT 0,
  errors_5xx        INTEGER NOT NULL DEFAULT 0,
  errors_other      INTEGER NOT NULL DEFAULT 0,
  refusals          INTEGER NOT NULL DEFAULT 0,
  compactions       INTEGER NOT NULL DEFAULT 0,
  internal_errors   INTEGER NOT NULL DEFAULT 0,
  total_duration_ms REAL NOT NULL DEFAULT 0,
  UNIQUE (date, user_id, model)
);
CREATE INDEX ix_otel_reliability_daily_date ON otel_reliability_daily(date);

-- Permission decisions per UTC day x user, split by decision source.
CREATE TABLE otel_governance_daily (
  id                      INTEGER PRIMARY KEY,
  date                    TEXT NOT NULL,      -- 'YYYY-MM-DD' UTC
  user_id                 INTEGER NOT NULL REFERENCES users(id),
  src_config              INTEGER NOT NULL DEFAULT 0,
  src_hook                INTEGER NOT NULL DEFAULT 0,
  src_user_permanent      INTEGER NOT NULL DEFAULT 0,
  src_user_temporary      INTEGER NOT NULL DEFAULT 0,
  src_user_abort          INTEGER NOT NULL DEFAULT 0,
  src_user_reject         INTEGER NOT NULL DEFAULT 0,
  permission_mode_changes INTEGER NOT NULL DEFAULT 0,
  UNIQUE (date, user_id)
);

-- Which permission modes users switch into, per UTC day.
CREATE TABLE otel_permission_mode_daily (
  id      INTEGER PRIMARY KEY,
  date    TEXT NOT NULL,                      -- 'YYYY-MM-DD' UTC
  user_id INTEGER NOT NULL REFERENCES users(id),
  mode    TEXT NOT NULL,
  changes INTEGER NOT NULL DEFAULT 0,
  UNIQUE (date, user_id, mode)
);

-- MCP server ecosystem usage per UTC day x user x server.
CREATE TABLE otel_mcp_daily (
  id                  INTEGER PRIMARY KEY,
  date                TEXT NOT NULL,          -- 'YYYY-MM-DD' UTC
  user_id             INTEGER NOT NULL REFERENCES users(id),
  server_name         TEXT NOT NULL,
  tool_calls          INTEGER NOT NULL DEFAULT 0,
  tool_failures       INTEGER NOT NULL DEFAULT 0,
  tokens              INTEGER NOT NULL DEFAULT 0,
  cost_cents          REAL NOT NULL DEFAULT 0,
  connections         INTEGER NOT NULL DEFAULT 0,
  connection_failures INTEGER NOT NULL DEFAULT 0,
  UNIQUE (date, user_id, server_name)
);
CREATE INDEX ix_otel_mcp_daily_date ON otel_mcp_daily(date);

-- Plugin installs/loads per UTC day x user x plugin.
CREATE TABLE otel_plugin_daily (
  id          INTEGER PRIMARY KEY,
  date        TEXT NOT NULL,                  -- 'YYYY-MM-DD' UTC
  user_id     INTEGER NOT NULL REFERENCES users(id),
  plugin_name TEXT NOT NULL,
  installs    INTEGER NOT NULL DEFAULT 0,
  loads       INTEGER NOT NULL DEFAULT 0,
  UNIQUE (date, user_id, plugin_name)
);

-- Token/cost mix per UTC day x user x (model, speed, effort) — '' when absent.
CREATE TABLE otel_token_mix_daily (
  id         INTEGER PRIMARY KEY,
  date       TEXT NOT NULL,                   -- 'YYYY-MM-DD' UTC
  user_id    INTEGER NOT NULL REFERENCES users(id),
  model      TEXT NOT NULL DEFAULT '',
  speed      TEXT NOT NULL DEFAULT '',
  effort     TEXT NOT NULL DEFAULT '',
  tokens     INTEGER NOT NULL DEFAULT 0,
  cost_cents REAL NOT NULL DEFAULT 0,
  UNIQUE (date, user_id, model, speed, effort)
);

-- Ingest replay protection: SHA-256 of each raw OTLP request body, kept for
-- 15 minutes (exporter retries resend byte-identical bodies).
CREATE TABLE otel_ingest_dedup (
  hash        TEXT PRIMARY KEY,
  received_at TEXT NOT NULL
);

-- Latest observed Claude Code app version per user (resource attr app.version),
-- guarded by cc_app_version_as_of so replayed old batches never downgrade it.
ALTER TABLE users ADD COLUMN cc_app_version TEXT;
ALTER TABLE users ADD COLUMN cc_app_version_as_of TEXT;
