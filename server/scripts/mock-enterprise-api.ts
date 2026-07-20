/**
 * Deterministic mock of the claude.ai Enterprise Analytics API for local
 * verification of the enterprise sync adapter — no real key exists yet.
 *
 *   tsx server/scripts/mock-enterprise-api.ts            # port 8899
 *   MOCK_PORT=9001 MOCK_KEY=test-key tsx server/scripts/mock-enterprise-api.ts
 *   MOCK_AUTH=bearer ...                                 # accept ONLY Authorization: Bearer
 *
 * Serves all 6 endpoints under /v1/organizations/analytics/:
 *   users (2-page pagination + too-recent-date error), user_usage_report
 *   (1d and 1h buckets), user_cost_report, cost_report, summaries.
 *
 * Timeline (all UTC): engagement lags 2 days → analytics/users knows the 5
 * days [today-6 .. today-2]; usage/cost/hourly are fresh through today;
 * summaries cover [max(2026-01-01, today-40) .. today-2]. Numbers are pure
 * functions of (date, user, model) so re-runs are reproducible.
 */
import http from 'node:http';

const PORT = Number(process.env['MOCK_PORT'] ?? 8899);
const KEY = process.env['MOCK_KEY'] ?? 'test-key';
/** 'x-api-key' (default) or 'bearer' — which auth style this mock accepts. */
const AUTH_MODE = process.env['MOCK_AUTH'] === 'bearer' ? 'bearer' : 'x-api-key';

const DATA_EPOCH = '2026-01-01';
const DAY_MS = 86_400_000;

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}
function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

const TODAY = todayUtc();
/** newest day the engagement endpoints know about (1–3 day lag → 2 here) */
const LATEST_ENGAGEMENT = addDays(TODAY, -2);
/** engagement window: the 5 available days */
const ENGAGEMENT_START = addDays(LATEST_ENGAGEMENT, -4);
/** usage/cost/hourly are ~4h fresh → data through today */
const USAGE_END = TODAY;
const SUMMARIES_START = addDays(TODAY, -40) > DATA_EPOCH ? addDays(TODAY, -40) : DATA_EPOCH;

interface MockUser {
  id: string;
  email: string;
  name: string;
  deleted: boolean;
  /** engagement records exist for this user (deleted users disappear from analytics/users) */
  engagement: boolean;
  /** all-zero claude_code metrics (chat-only seat) — still must reach the roster */
  zeroMetrics: boolean;
}

const USERS: MockUser[] = [
  { id: 'user_alice0000000000000001', email: 'alice@example.com', name: 'Alice Almog', deleted: false, engagement: true, zeroMetrics: false },
  { id: 'user_bob00000000000000000002', email: 'bob@example.com', name: 'Bob Barak', deleted: false, engagement: true, zeroMetrics: false },
  { id: 'user_carol000000000000000003', email: 'carol@example.com', name: 'Carol Cohen', deleted: false, engagement: true, zeroMetrics: true },
  { id: 'user_dave0000000000000000004', email: 'dave@example.com', name: 'Dave Dagan', deleted: true, engagement: false, zeroMetrics: false },
];

const MODELS = ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5'];

/** deterministic small hash → 0..(mod-1) */
function det(seed: string, mod: number): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % mod;
}

/** which models a user touches on a date (1..3, deterministic) */
function modelsFor(user: MockUser, date: string): string[] {
  if (user.zeroMetrics || user.deleted) return [MODELS[det(`${user.id}|${date}|m`, MODELS.length)] as string];
  const count = 2 + det(`${user.id}|${date}|n`, 2); // 2..3
  const start = det(`${user.id}|${date}|s`, MODELS.length);
  return Array.from({ length: count }, (_, i) => MODELS[(start + i) % MODELS.length] as string);
}

function tokensFor(user: MockUser, date: string, model: string) {
  const base = 1000 + det(`${user.id}|${date}|${model}|t`, 9000);
  return {
    uncached_input_tokens: base * 3,
    cache_creation: {
      ephemeral_5m_input_tokens: base * 2,
      ephemeral_1h_input_tokens: base,
    },
    cache_read_input_tokens: base * 20,
    output_tokens: base,
    total_tokens: base * 27,
    requests: 5 + det(`${user.id}|${date}|${model}|r`, 40),
    server_tool_use: { web_search_requests: det(`${user.id}|${date}|${model}|w`, 4) },
  };
}

/** fractional-cents decimal string, e.g. "41280.000000" */
function costFor(user: MockUser, date: string, model: string): string {
  const cents = 500 + det(`${user.id}|${date}|${model}|c`, 50000);
  return `${cents}.000000`;
}

function usageActor(user: MockUser) {
  return { user_id: user.id, email: user.email, name: user.name, deleted: user.deleted };
}

function engagementRecord(user: MockUser, date: string) {
  const z = user.zeroMetrics;
  const v = (salt: string, mod: number): number => (z ? 0 : det(`${user.id}|${date}|${salt}`, mod));
  return {
    user: { id: user.id, email_address: user.email },
    claude_code_metrics: {
      core_metrics: {
        commit_count: v('commits', 12),
        distinct_session_count: z ? 0 : 1 + det(`${user.id}|${date}|sess`, 14),
        lines_of_code: { added_count: v('la', 2500), removed_count: v('lr', 900) },
        pull_request_count: v('pr', 4),
      },
      tool_actions: {
        edit_tool: { accepted_count: v('ea', 120), rejected_count: v('er', 15) },
        multi_edit_tool: { accepted_count: v('ma', 40), rejected_count: v('mr', 8) },
        notebook_edit_tool: { accepted_count: v('na', 6), rejected_count: v('nr', 3) },
        write_tool: { accepted_count: v('wa', 30), rejected_count: v('wr', 6) },
      },
    },
    chat_metrics: { conversation_count: 2 + det(`${user.id}|${date}|chat`, 9) },
    cowork_metrics: { session_count: det(`${user.id}|${date}|cw`, 3) },
    web_search_count: det(`${user.id}|${date}|ws`, 10),
  };
}

/** users active in usage/cost on a date (deleted user only in the engagement window) */
function usageUsers(date: string): MockUser[] {
  return USERS.filter((u) => {
    if (u.deleted) return date >= ENGAGEMENT_START && date <= LATEST_ENGAGEMENT;
    return true;
  });
}

// ---------------------------------------------------------------------------
// endpoint handlers
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;

function errorBody(type: string, message: string): Json {
  return { type: 'error', error: { type, message } };
}

function handleUsers(q: URLSearchParams): { status: number; body: Json } {
  const date = q.get('date') ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { status: 400, body: errorBody('invalid_request_error', 'date: expected YYYY-MM-DD') };
  }
  if (date > LATEST_ENGAGEMENT) {
    return {
      status: 400,
      body: errorBody(
        'invalid_request_error',
        `Requested date ${date} is not yet available. The most recent date with available analytics data is ${LATEST_ENGAGEMENT}.`,
      ),
    };
  }
  if (date < ENGAGEMENT_START) {
    return { status: 200, body: { data: [], next_page: null } };
  }
  const engaged = USERS.filter((u) => u.engagement);
  const page = q.get('page');
  const pageMarker = `users-${date}-p2`;
  // 2-page response: page 1 → first 2 users + cursor; page 2 → the rest.
  if (page === null) {
    return { status: 200, body: { data: engaged.slice(0, 2).map((u) => engagementRecord(u, date)), next_page: pageMarker } };
  }
  if (page === pageMarker) {
    return { status: 200, body: { data: engaged.slice(2).map((u) => engagementRecord(u, date)), next_page: null } };
  }
  return { status: 400, body: errorBody('invalid_request_error', 'invalid page cursor for these query params') };
}

/** [start, endExclusive) UTC dates covered by starting_at/ending_at, clamped to data range. */
function datesInRange(q: URLSearchParams): string[] | null {
  const startIso = q.get('starting_at');
  const endIso = q.get('ending_at');
  if (!startIso || !endIso) return null;
  const startMs = Date.parse(startIso);
  const endMs = Date.parse(endIso);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;
  const out: string[] = [];
  let day = new Date(startMs).toISOString().slice(0, 10);
  const endDay = new Date(endMs - 1).toISOString().slice(0, 10);
  while (day <= endDay) {
    if (day >= DATA_EPOCH && day <= USAGE_END) out.push(day);
    day = addDays(day, 1);
  }
  return out;
}

function handleUserUsageReport(q: URLSearchParams): { status: number; body: Json } {
  const dates = datesInRange(q);
  if (!dates) {
    return { status: 400, body: errorBody('invalid_request_error', 'starting_at and ending_at (RFC3339) are required') };
  }
  const bucket = q.get('bucket_width') ?? '1d';
  const data: Json[] = [];
  if (bucket === '1h') {
    // rows are actor × hour; deterministic active hours per user/day
    for (const date of dates) {
      for (const user of usageUsers(date)) {
        const hours = [8 + det(`${user.id}|${date}|h1`, 3), 12 + det(`${user.id}|${date}|h2`, 3), 15 + det(`${user.id}|${date}|h3`, 5)];
        for (const hour of [...new Set(hours)]) {
          const hh = String(hour).padStart(2, '0');
          const t = tokensFor(user, `${date}H${hh}`, 'all');
          data.push({
            actor: usageActor(user),
            uncached_input_tokens: t.uncached_input_tokens,
            cache_creation: t.cache_creation,
            cache_read_input_tokens: t.cache_read_input_tokens,
            output_tokens: t.output_tokens,
            total_tokens: t.total_tokens,
            requests: t.requests,
            server_tool_use: t.server_tool_use,
            starting_at: `${date}T${hh}:00:00Z`,
            ending_at: `${date}T${hh}:59:59Z`,
          });
        }
      }
    }
  } else {
    const groupedByModel = q.getAll('group_by[]').includes('model');
    for (const date of dates) {
      for (const user of usageUsers(date)) {
        for (const model of groupedByModel ? modelsFor(user, date) : ['']) {
          const t = tokensFor(user, date, model || 'any');
          data.push({
            actor: usageActor(user),
            ...(groupedByModel ? { model } : {}),
            uncached_input_tokens: t.uncached_input_tokens,
            cache_creation: t.cache_creation,
            cache_read_input_tokens: t.cache_read_input_tokens,
            output_tokens: t.output_tokens,
            total_tokens: t.total_tokens,
            requests: t.requests,
            server_tool_use: t.server_tool_use,
            starting_at: `${date}T00:00:00Z`,
            ending_at: `${addDays(date, 1)}T00:00:00Z`,
          });
        }
      }
    }
  }
  return {
    status: 200,
    body: { data, data_refreshed_at: new Date().toISOString(), has_more: false, next_page: null },
  };
}

function handleUserCostReport(q: URLSearchParams): { status: number; body: Json } {
  const dates = datesInRange(q);
  if (!dates) {
    return { status: 400, body: errorBody('invalid_request_error', 'starting_at and ending_at (RFC3339) are required') };
  }
  const groupedByModel = q.getAll('group_by[]').includes('model');
  const data: Json[] = [];
  for (const date of dates) {
    for (const user of usageUsers(date)) {
      for (const model of groupedByModel ? modelsFor(user, date) : ['']) {
        const amount = costFor(user, date, model || 'any');
        data.push({
          actor: usageActor(user),
          ...(groupedByModel ? { model } : {}),
          amount,
          list_amount: amount,
          currency: 'USD',
          starting_at: `${date}T00:00:00Z`,
          ending_at: `${addDays(date, 1)}T00:00:00Z`,
        });
      }
    }
  }
  return { status: 200, body: { data, data_refreshed_at: new Date().toISOString(), has_more: false, next_page: null } };
}

function handleOrgCostReport(q: URLSearchParams): { status: number; body: Json } {
  const dates = datesInRange(q);
  if (!dates) {
    return { status: 400, body: errorBody('invalid_request_error', 'starting_at and ending_at (RFC3339) are required') };
  }
  const data: Json[] = [];
  for (const date of dates) {
    const results: Json[] = MODELS.map((model) => ({
      amount: `${20000 + det(`${date}|${model}|org`, 400000)}.500000`,
      currency: 'USD',
      cost_type: 'tokens',
      model,
    }));
    results.push({ amount: `${det(`${date}|ws|org`, 3000)}.000000`, currency: 'USD', cost_type: 'web_search', model: null });
    results.push({ amount: `${det(`${date}|ce|org`, 1500)}.000000`, currency: 'USD', cost_type: 'code_execution', model: null });
    data.push({ starting_at: `${date}T00:00:00Z`, ending_at: `${addDays(date, 1)}T00:00:00Z`, results });
  }
  return { status: 200, body: { data, has_more: false, next_page: null } };
}

function handleSummaries(q: URLSearchParams): { status: number; body: Json } {
  const start = q.get('starting_date') ?? '';
  const end = q.get('ending_date') ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start > end) {
    return { status: 400, body: errorBody('invalid_request_error', 'starting_date and ending_date (YYYY-MM-DD) are required') };
  }
  const summaries: Json[] = [];
  for (let date = start; date <= end; date = addDays(date, 1)) {
    if (date < SUMMARIES_START || date > LATEST_ENGAGEMENT) continue;
    const dau = 2 + det(`${date}|dau`, 2); // 2..3
    summaries.push({
      starting_at: `${date}T00:00:00Z`,
      ending_at: `${addDays(date, 1)}T00:00:00Z`,
      assigned_seat_count: 25,
      pending_invite_count: 3,
      daily_active_user_count: dau,
      weekly_active_user_count: 3,
      monthly_active_user_count: 4,
      daily_adoption_rate: dau / 25,
      weekly_adoption_rate: 3 / 25,
      monthly_adoption_rate: 4 / 25,
      claude_code_daily_active_user_count: dau - 1,
    });
  }
  return { status: 200, body: { summaries } };
}

// ---------------------------------------------------------------------------
// server
// ---------------------------------------------------------------------------

function authorized(req: http.IncomingMessage): boolean {
  if (AUTH_MODE === 'bearer') {
    return req.headers['authorization'] === `Bearer ${KEY}`;
  }
  return req.headers['x-api-key'] === KEY;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const send = (status: number, body: Json): void => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  if (!authorized(req)) {
    send(401, errorBody('authentication_error', AUTH_MODE === 'bearer' ? 'invalid bearer token' : 'invalid x-api-key'));
    return;
  }
  if (req.headers['anthropic-version'] !== '2023-06-01') {
    send(400, errorBody('invalid_request_error', 'anthropic-version header is required'));
    return;
  }

  const q = url.searchParams;
  switch (url.pathname) {
    case '/v1/organizations/analytics/users': {
      const r = handleUsers(q);
      send(r.status, r.body);
      return;
    }
    case '/v1/organizations/analytics/user_usage_report': {
      const r = handleUserUsageReport(q);
      send(r.status, r.body);
      return;
    }
    case '/v1/organizations/analytics/user_cost_report': {
      const r = handleUserCostReport(q);
      send(r.status, r.body);
      return;
    }
    case '/v1/organizations/analytics/cost_report': {
      const r = handleOrgCostReport(q);
      send(r.status, r.body);
      return;
    }
    case '/v1/organizations/analytics/summaries': {
      const r = handleSummaries(q);
      send(r.status, r.body);
      return;
    }
    default:
      send(404, errorBody('not_found_error', `no such endpoint: ${url.pathname}`));
  }
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(
    `mock enterprise analytics api on :${PORT} (auth=${AUTH_MODE}, key=${KEY})\n` +
      `  engagement days: ${ENGAGEMENT_START}..${LATEST_ENGAGEMENT} (today=${TODAY} errors with latest-day hint)\n` +
      `  usage/cost/hourly through ${USAGE_END}; summaries ${SUMMARIES_START}..${LATEST_ENGAGEMENT}`,
  );
});
