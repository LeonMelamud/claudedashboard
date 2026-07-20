-- claude.ai Enterprise org-level daily summaries (GET analytics/summaries).
-- One row per UTC day; /api/adoption prefers these over usage_daily-derived
-- actives when rows exist (enterprise mode), and assigned_seat_count becomes
-- the rostered-users denominator (there is no seat-list endpoint).
CREATE TABLE org_summaries (
  date                 TEXT PRIMARY KEY,       -- 'YYYY-MM-DD' UTC
  assigned_seat_count  INTEGER NOT NULL DEFAULT 0,
  pending_invite_count INTEGER NOT NULL DEFAULT 0,
  dau                  INTEGER NOT NULL DEFAULT 0,
  wau                  INTEGER NOT NULL DEFAULT 0,
  mau                  INTEGER NOT NULL DEFAULT 0,
  claude_code_dau      INTEGER,                -- NULL when the API omits it
  raw_json             TEXT NOT NULL           -- full summary record; insurance for future columns
);
