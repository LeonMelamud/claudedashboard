-- Daily aggregates from Claude Code OpenTelemetry log events, ingested at
-- POST /otel/v1/logs (devs point OTEL_EXPORTER_OTLP_ENDPOINT at this server).
-- One row per UTC day x user x entity; counters only ever increment.

-- claude_code.skill_activated (+ api_request cost attribution via skill.name)
CREATE TABLE otel_skill_daily (
  id          INTEGER PRIMARY KEY,
  date        TEXT NOT NULL,                -- 'YYYY-MM-DD' UTC
  user_id     INTEGER NOT NULL REFERENCES users(id),
  skill_name  TEXT NOT NULL,
  invocations INTEGER NOT NULL DEFAULT 0,
  user_slash  INTEGER NOT NULL DEFAULT 0,   -- invocation_trigger='user-slash'
  proactive   INTEGER NOT NULL DEFAULT 0,   -- invocation_trigger='claude-proactive'
  nested      INTEGER NOT NULL DEFAULT 0,   -- invocation_trigger='nested-skill'
  cost_cents  REAL NOT NULL DEFAULT 0,      -- api_request cost_usd*100; round at display
  UNIQUE (date, user_id, skill_name)
);
CREATE INDEX ix_otel_skill_daily_date ON otel_skill_daily(date);

-- claude_code.tool_result where tool_name is Agent/Task (subagent_type from
-- tool_parameters JSON) + api_request cost attribution via agent.name
CREATE TABLE otel_agent_daily (
  id            INTEGER PRIMARY KEY,
  date          TEXT NOT NULL,              -- 'YYYY-MM-DD' UTC
  user_id       INTEGER NOT NULL REFERENCES users(id),
  subagent_type TEXT NOT NULL,
  invocations   INTEGER NOT NULL DEFAULT 0,
  success       INTEGER NOT NULL DEFAULT 0,
  failure       INTEGER NOT NULL DEFAULT 0,
  cost_cents    REAL NOT NULL DEFAULT 0,
  UNIQUE (date, user_id, subagent_type)
);
CREATE INDEX ix_otel_agent_daily_date ON otel_agent_daily(date);

-- claude_code.tool_result (uses/success/failure) + claude_code.tool_decision
-- (accepted/rejected) for every tool, MCP tools included.
CREATE TABLE otel_tool_daily (
  id        INTEGER PRIMARY KEY,
  date      TEXT NOT NULL,                  -- 'YYYY-MM-DD' UTC
  user_id   INTEGER NOT NULL REFERENCES users(id),
  tool_name TEXT NOT NULL,
  uses      INTEGER NOT NULL DEFAULT 0,
  success   INTEGER NOT NULL DEFAULT 0,
  failure   INTEGER NOT NULL DEFAULT 0,
  accepted  INTEGER NOT NULL DEFAULT 0,
  rejected  INTEGER NOT NULL DEFAULT 0,
  UNIQUE (date, user_id, tool_name)
);
CREATE INDEX ix_otel_tool_daily_date ON otel_tool_daily(date);
