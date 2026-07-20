-- Unified actors: human org members (actor_type='user') and API-key
-- pseudo-users (actor_type='api_key'). Departed members keep their rows
-- (in_roster=0) so history never loses attribution.
CREATE TABLE users (
  id                INTEGER PRIMARY KEY,
  actor_type        TEXT NOT NULL CHECK (actor_type IN ('user','api_key')),
  email             TEXT,
  api_key_name      TEXT,
  anthropic_user_id TEXT,
  name              TEXT NOT NULL DEFAULT '',
  role              TEXT,
  added_at          TEXT,
  in_roster         INTEGER NOT NULL DEFAULT 0,
  team_id           INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  first_seen_date   TEXT,
  last_seen_date    TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX ux_users_email   ON users(email)        WHERE actor_type = 'user' AND email IS NOT NULL;
CREATE UNIQUE INDEX ux_users_apikey  ON users(api_key_name) WHERE actor_type = 'api_key';
CREATE UNIQUE INDEX ux_users_anth_id ON users(anthropic_user_id) WHERE anthropic_user_id IS NOT NULL;
CREATE INDEX ix_users_team ON users(team_id);

CREATE TABLE teams (
  id           INTEGER PRIMARY KEY,
  name         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  color        TEXT NOT NULL DEFAULT '#6366f1',
  lead_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Raw API grain: one row per actor x terminal_type x customer_type x UTC day.
-- A user may have several rows per day; aggregates always SUM across them.
CREATE TABLE usage_daily (
  id             INTEGER PRIMARY KEY,
  date           TEXT NOT NULL,               -- 'YYYY-MM-DD' UTC
  user_id        INTEGER NOT NULL REFERENCES users(id),
  terminal_type  TEXT NOT NULL DEFAULT '',    -- '' when absent (NULL breaks UNIQUE)
  customer_type  TEXT NOT NULL DEFAULT '',
  num_sessions   INTEGER NOT NULL DEFAULT 0,
  lines_added    INTEGER NOT NULL DEFAULT 0,
  lines_removed  INTEGER NOT NULL DEFAULT 0,
  commits        INTEGER NOT NULL DEFAULT 0,
  pull_requests  INTEGER NOT NULL DEFAULT 0,
  edit_accepted        INTEGER NOT NULL DEFAULT 0,
  edit_rejected        INTEGER NOT NULL DEFAULT 0,
  multi_edit_accepted  INTEGER NOT NULL DEFAULT 0,
  multi_edit_rejected  INTEGER NOT NULL DEFAULT 0,
  write_accepted       INTEGER NOT NULL DEFAULT 0,
  write_rejected       INTEGER NOT NULL DEFAULT 0,
  notebook_accepted    INTEGER NOT NULL DEFAULT 0,
  notebook_rejected    INTEGER NOT NULL DEFAULT 0,
  raw_json       TEXT NOT NULL,               -- full API record; insurance for future columns
  synced_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (date, user_id, terminal_type, customer_type)
);
CREATE INDEX ix_usage_daily_date      ON usage_daily(date);
CREATE INDEX ix_usage_daily_user_date ON usage_daily(user_id, date);

CREATE TABLE usage_daily_models (
  id             INTEGER PRIMARY KEY,
  usage_daily_id INTEGER NOT NULL REFERENCES usage_daily(id) ON DELETE CASCADE,
  model          TEXT NOT NULL,
  input_tokens   INTEGER NOT NULL DEFAULT 0,
  output_tokens  INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens     INTEGER NOT NULL DEFAULT 0,
  cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
  cost_cents     REAL NOT NULL DEFAULT 0      -- API float verbatim; round at display only
);
CREATE INDEX ix_udm_parent ON usage_daily_models(usage_daily_id);
CREATE INDEX ix_udm_model  ON usage_daily_models(model);

-- Hourly token activity from usage_report/messages grouped by account_id.
-- OAuth (Claude Code sign-in) traffic only; API-key traffic has no account_id.
CREATE TABLE usage_hourly (
  id           INTEGER PRIMARY KEY,
  hour_utc     TEXT NOT NULL,                 -- 'YYYY-MM-DDTHH:00:00Z'
  user_id      INTEGER NOT NULL REFERENCES users(id),
  uncached_input_tokens INTEGER NOT NULL DEFAULT 0,
  cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens     INTEGER NOT NULL DEFAULT 0,
  output_tokens         INTEGER NOT NULL DEFAULT 0,
  UNIQUE (user_id, hour_utc)
);
CREATE INDEX ix_usage_hourly_hour ON usage_hourly(hour_utc);

CREATE TABLE sync_runs (
  id            INTEGER PRIMARY KEY,
  job_type      TEXT NOT NULL,   -- backfill | daily | hourly | roster | nightly
  trigger       TEXT NOT NULL,   -- cron | manual | startup
  status        TEXT NOT NULL,   -- running | success | error | cancelled
  started_at    TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at   TEXT,
  rows_written  INTEGER NOT NULL DEFAULT 0,
  progress_json TEXT,
  error         TEXT
);
CREATE INDEX ix_sync_runs_type ON sync_runs(job_type, started_at DESC);

CREATE TABLE sync_state (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL    -- JSON-encoded
);

-- Yesterday's badge/segment snapshot per user, for "new badge" celebration
-- diffs and Top Movers.
CREATE TABLE score_snapshots (
  snapshot_date TEXT NOT NULL,
  user_id       INTEGER NOT NULL REFERENCES users(id),
  range_key     TEXT NOT NULL,    -- e.g. '30d' — snapshots per range preset
  composite     REAL,
  segment       TEXT,
  badges_json   TEXT NOT NULL,    -- earned badge ids
  PRIMARY KEY (snapshot_date, user_id, range_key)
);
