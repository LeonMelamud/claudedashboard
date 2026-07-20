import { addDays, type SyncRunInfo } from '@dash/shared';
import { EnterpriseApiError, type EnterpriseClient } from '../anthropic/enterpriseClient';
import type {
  EntCostRow,
  EntOrgCostBucket,
  EntSummariesResponse,
  EntUsageActor,
  EntUsageRow,
  EntUsersRecord,
} from '../anthropic/enterpriseTypes';
import type { Env } from '../env';
import type { Repos } from '../repos';
import type { CostInsertRow } from '../repos/costRepo';
import type { DailyInsertRow, HourlyUpsertRow } from '../repos/usageRepo';
import { hourIsoOf, todayUtc, truncToHourIso } from '../util/time';
import type { SyncLogger } from './logBus';
import type { SyncPlan } from './manager';
import { writeSnapshots } from './snapshot';

/** Enterprise Analytics data exists from this day only. */
export const ENT_DATA_EPOCH = '2026-01-01';

/** Engagement lags 1–3 days; the nightly re-syncs this many trailing AVAILABLE days. */
const NIGHTLY_ENGAGEMENT_DAYS = 5;
/** Intraday: user_usage_report/cost are ~4h fresh — refresh just the last 2 days. */
const INTRADAY_USAGE_DAYS = 2;
/** Nightly org cost_report re-fetch depth (costs revised up to 30 days back). */
const COST_NIGHTLY_DAYS = 7;
/** Nightly summaries depth. */
const SUMMARIES_NIGHTLY_DAYS = 35;
/** summaries chunking for backfill (max range is 366 days — stay well under). */
const SUMMARIES_CHUNK_DAYS = 300;
/** cost_report windows (31 1d-buckets max per request). */
const COST_WINDOW_DAYS = 31;

// sync_state keys — namespaced 'ent_' so they never clash with console watermarks.
export const ENT_STATE_BACKFILL_CURSOR = 'ent_backfill_cursor';
export const ENT_STATE_BACKFILL_DONE = 'ent_backfill_done';
export const ENT_STATE_LATEST_AVAILABLE = 'ent_latest_available';
export const ENT_STATE_DAILY_WATERMARK = 'ent_daily_watermark';
export const ENT_STATE_HOURLY_WATERMARK = 'ent_hourly_watermark';

const DATE_RE = /\d{4}-\d{2}-\d{2}/;
const CUSTOMER_TYPE = 'enterprise';

const n = (v: number | null | undefined): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

function localPart(email: string): string {
  const at = email.indexOf('@');
  return at > 0 ? email.slice(0, at) : email;
}

function dayStartIso(date: string): string {
  return `${date}T00:00:00Z`;
}

/** ending_at for a day window; today's window ends at the next full hour, not in the future. */
function dayEndIso(date: string): string {
  const nextDay = dayStartIso(addDays(date, 1));
  const nowCeil = new Date(Math.ceil(Date.now() / 3_600_000) * 3_600_000).toISOString();
  return nextDay < nowCeil ? nextDay : nowCeil;
}

// ---------------------------------------------------------------------------
// Actor resolution — there is NO seat-list endpoint in enterprise mode.
// Every user seen in analytics/users or a usage/cost actor is upserted by
// lowercased email with anthropic_user_id, in_roster=1. in_roster is NEVER
// reset to 0 automatically (no authoritative roster to diff against).
// ---------------------------------------------------------------------------

class EnterpriseActorResolver {
  /** key → resolved user id; `named` tracks whether a real name was applied this run. */
  private readonly cache = new Map<string, { id: number; named: boolean }>();

  constructor(private readonly repos: Repos) {}

  resolve(email: string | null, anthropicUserId: string | null, name: string, deleted: boolean): number | null {
    if (!email) {
      // No email → fall back to the anthropic user id (stub row, like hourly console sync).
      if (!anthropicUserId) return null;
      const cached = this.cache.get(`id:${anthropicUserId}`);
      if (cached !== undefined) return cached.id;
      const existing = this.repos.users.getByAnthropicUserId(anthropicUserId);
      const id = existing ? existing.id : this.repos.users.insertStubForAccountId(anthropicUserId);
      this.cache.set(`id:${anthropicUserId}`, { id, named: false });
      return id;
    }

    const lower = email.toLowerCase();
    const cached = this.cache.get(`email:${lower}`);
    if (cached !== undefined) {
      // engagement records carry no name; a later usage actor may — apply it once
      if (name !== '' && !cached.named) {
        this.repos.users.applyEnterpriseIdentity(cached.id, {
          anthropicUserId: anthropicUserId ?? null,
          email: lower,
          name,
          markRostered: !deleted,
        });
        cached.named = true;
      }
      return cached.id;
    }

    const byEmail = this.repos.users.getByEmail(lower);
    const byAnthId = anthropicUserId ? this.repos.users.getByAnthropicUserId(anthropicUserId) : undefined;
    let id: number;
    if (byEmail && byAnthId && byEmail.id !== byAnthId.id) {
      // an hourly stub keyed by user_... id coexists with the email row — merge
      this.repos.users.mergeInto(byEmail.id, byAnthId.id);
      id = byEmail.id;
    } else if (byEmail) {
      id = byEmail.id;
    } else if (byAnthId) {
      id = byAnthId.id;
    } else {
      id = this.repos.users.insertUserActor(lower, name || localPart(lower));
    }
    this.repos.users.applyEnterpriseIdentity(id, {
      anthropicUserId: anthropicUserId ?? null,
      email: lower,
      name,
      markRostered: !deleted,
    });
    const entry = { id, named: name !== '' };
    this.cache.set(`email:${lower}`, entry);
    if (anthropicUserId) this.cache.set(`id:${anthropicUserId}`, entry);
    return id;
  }

  resolveUsageActor(actor: EntUsageActor | null | undefined): number | null {
    if (!actor) return null;
    return this.resolve(actor.email ?? null, actor.user_id ?? null, actor.name ?? '', actor.deleted === true);
  }
}

// ---------------------------------------------------------------------------
// Watermark discovery — a too-recent `date` on analytics/users returns an
// error that names the latest available day. Parse it instead of failing.
// ---------------------------------------------------------------------------

export async function discoverLatestAvailableDay(client: EnterpriseClient, repos: Repos): Promise<string> {
  const today = todayUtc();
  try {
    await client.fetchWithRetry(client.buildUrl('/v1/organizations/analytics/users', { date: today, limit: 1 }));
    repos.sync.setState(ENT_STATE_LATEST_AVAILABLE, today);
    return today;
  } catch (err) {
    if (err instanceof EnterpriseApiError && err.status < 500) {
      // The message repeats the (too-recent) requested date AND names the
      // latest available one — take the newest date strictly before today.
      const candidates = (`${err.body} ${err.message}`.match(new RegExp(DATE_RE, 'g')) ?? [])
        .filter((d) => d < today)
        .sort();
      const latest = candidates[candidates.length - 1];
      if (latest !== undefined) {
        repos.sync.setState(ENT_STATE_LATEST_AVAILABLE, latest);
        return latest;
      }
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Per-day fetchers
// ---------------------------------------------------------------------------

interface EngagementAcc {
  userId: number;
  row: Omit<DailyInsertRow, 'models'>;
}

/**
 * Fetch analytics/users for one day. EVERY user seen is upserted into the
 * roster (this IS the enterprise roster feed); records whose claude_code
 * metrics are entirely zero produce no usage_daily row but keep the user.
 */
async function fetchEngagementDay(
  client: EnterpriseClient,
  resolver: EnterpriseActorResolver,
  date: string,
): Promise<{ engaged: Map<number, EngagementAcc>; usersSeen: number }> {
  const engaged = new Map<number, EngagementAcc>();
  let usersSeen = 0;
  for await (const page of client.paginate<EntUsersRecord>('/v1/organizations/analytics/users', {
    date,
    limit: 1000,
  })) {
    for (const record of page) {
      const email = record.user?.email_address ?? null;
      const anthId = record.user?.id ?? null;
      const userId = resolver.resolve(email, anthId, '', false);
      if (userId === null) continue;
      usersSeen += 1;

      const cc = record.claude_code_metrics;
      const core = cc?.core_metrics;
      const tools = cc?.tool_actions;
      const metrics = {
        numSessions: n(core?.distinct_session_count),
        linesAdded: n(core?.lines_of_code?.added_count),
        linesRemoved: n(core?.lines_of_code?.removed_count),
        commits: n(core?.commit_count),
        pullRequests: n(core?.pull_request_count),
        editAccepted: n(tools?.edit_tool?.accepted_count),
        editRejected: n(tools?.edit_tool?.rejected_count),
        multiEditAccepted: n(tools?.multi_edit_tool?.accepted_count),
        multiEditRejected: n(tools?.multi_edit_tool?.rejected_count),
        writeAccepted: n(tools?.write_tool?.accepted_count),
        writeRejected: n(tools?.write_tool?.rejected_count),
        notebookAccepted: n(tools?.notebook_edit_tool?.accepted_count),
        notebookRejected: n(tools?.notebook_edit_tool?.rejected_count),
      };
      // all-zero claude_code metrics → user kept in roster, no usage row
      if (Object.values(metrics).every((v) => v === 0)) continue;

      engaged.set(userId, {
        userId,
        row: {
          date,
          userId,
          terminalType: '', // gone in the enterprise API
          customerType: CUSTOMER_TYPE,
          ...metrics,
          rawJson: JSON.stringify(record),
        },
      });
    }
  }
  return { engaged, usersSeen };
}

type ModelAcc = Map<number, Map<string, DailyInsertRow['models'][number]>>;

function modelSlot(acc: ModelAcc, userId: number, model: string): DailyInsertRow['models'][number] {
  let byModel = acc.get(userId);
  if (!byModel) {
    byModel = new Map();
    acc.set(userId, byModel);
  }
  let slot = byModel.get(model);
  if (!slot) {
    slot = { model, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, costCents: 0 };
    byModel.set(model, slot);
  }
  return slot;
}

/** user_usage_report bucket_width=1d grouped by model → per-user per-model tokens. */
async function fetchUsageDay(
  client: EnterpriseClient,
  resolver: EnterpriseActorResolver,
  date: string,
  acc: ModelAcc,
): Promise<void> {
  for await (const page of client.paginate<EntUsageRow>('/v1/organizations/analytics/user_usage_report', {
    starting_at: dayStartIso(date),
    ending_at: dayEndIso(date),
    bucket_width: '1d',
    'group_by[]': 'model',
    'products[]': 'claude_code',
    limit: 1000,
  })) {
    for (const row of page) {
      const userId = resolver.resolveUsageActor(row.actor);
      if (userId === null) continue;
      const slot = modelSlot(acc, userId, row.model ?? 'unknown');
      slot.inputTokens += n(row.uncached_input_tokens);
      slot.cacheCreationTokens +=
        n(row.cache_creation?.ephemeral_5m_input_tokens) + n(row.cache_creation?.ephemeral_1h_input_tokens);
      slot.cacheReadTokens += n(row.cache_read_input_tokens);
      slot.outputTokens += n(row.output_tokens);
    }
  }
}

/** user_cost_report grouped by model → cost_cents onto the matching (user, model) slot. */
async function fetchCostDay(
  client: EnterpriseClient,
  resolver: EnterpriseActorResolver,
  date: string,
  acc: ModelAcc,
): Promise<void> {
  for await (const page of client.paginate<EntCostRow>('/v1/organizations/analytics/user_cost_report', {
    starting_at: dayStartIso(date),
    ending_at: dayEndIso(date),
    'group_by[]': 'model',
    'products[]': 'claude_code',
    limit: 1000,
  })) {
    for (const row of page) {
      const userId = resolver.resolveUsageActor(row.actor);
      if (userId === null) continue;
      const cents = Number(row.amount ?? '0'); // decimal STRING in fractional cents
      if (!Number.isFinite(cents) || cents === 0) continue;
      // creates the model row even when the usage sync hasn't seen it —
      // tokens and costs can arrive at different times
      modelSlot(acc, userId, row.model ?? 'unknown').costCents += cents;
    }
  }
}

// ---------------------------------------------------------------------------
// Day-level syncs
// ---------------------------------------------------------------------------

/**
 * Full re-sync of one UTC day: engagement (analytics/users) + per-model tokens
 * (user_usage_report 1d) + per-model cost (user_cost_report), merged and
 * written in ONE transaction (replaceDay: delete day → insert engagement rows
 * with their model children) so model rows are never orphaned. Users with
 * model tokens but no engagement row yet (the 1–3 day lag) get a zero-metrics
 * parent that a later engagement re-sync fills.
 */
export async function syncEnterpriseDay(
  client: EnterpriseClient,
  repos: Repos,
  resolver: EnterpriseActorResolver,
  date: string,
): Promise<number> {
  const { engaged } = await fetchEngagementDay(client, resolver, date);
  const models: ModelAcc = new Map();
  await fetchUsageDay(client, resolver, date, models);
  await fetchCostDay(client, resolver, date, models);

  const rows: DailyInsertRow[] = [];
  const userIds = new Set<number>([...engaged.keys(), ...models.keys()]);
  for (const userId of userIds) {
    const engagement = engaged.get(userId);
    const row: DailyInsertRow = engagement
      ? { ...engagement.row, models: [] }
      : {
          // model tokens but no engagement yet → zero-metrics parent
          date,
          userId,
          terminalType: '',
          customerType: CUSTOMER_TYPE,
          numSessions: 0,
          linesAdded: 0,
          linesRemoved: 0,
          commits: 0,
          pullRequests: 0,
          editAccepted: 0,
          editRejected: 0,
          multiEditAccepted: 0,
          multiEditRejected: 0,
          writeAccepted: 0,
          writeRejected: 0,
          notebookAccepted: 0,
          notebookRejected: 0,
          rawJson: '{}',
          models: [],
        };
    row.models = [...(models.get(userId)?.values() ?? [])];
    rows.push(row);
  }

  return repos.usage.replaceDay(date, rows, (userId, d) => repos.users.touchSeenDates(userId, d));
}

/** Intraday: refresh ONLY tokens+cost (4h-fresh) for one day; engagement lags days. */
async function syncEnterpriseModelsOnlyDay(
  client: EnterpriseClient,
  repos: Repos,
  resolver: EnterpriseActorResolver,
  date: string,
): Promise<number> {
  const models: ModelAcc = new Map();
  await fetchUsageDay(client, resolver, date, models);
  await fetchCostDay(client, resolver, date, models);
  const entries = [...models.entries()].map(([userId, byModel]) => ({
    userId,
    customerType: CUSTOMER_TYPE,
    models: [...byModel.values()],
  }));
  if (entries.length === 0) return 0;
  return repos.usage.upsertModelsOnly(date, entries, (userId, d) => repos.users.touchSeenDates(userId, d));
}

/** user_usage_report bucket_width=1h for ONE day (ending_at required) → usage_hourly. */
export async function syncEnterpriseHourlyDay(
  client: EnterpriseClient,
  repos: Repos,
  resolver: EnterpriseActorResolver,
  date: string,
): Promise<number> {
  const byKey = new Map<string, HourlyUpsertRow>();
  for await (const page of client.paginate<EntUsageRow>('/v1/organizations/analytics/user_usage_report', {
    starting_at: dayStartIso(date),
    ending_at: dayEndIso(date),
    bucket_width: '1h',
    'products[]': 'claude_code',
    limit: 1000, // rows are actor × hour
  })) {
    for (const row of page) {
      const userId = resolver.resolveUsageActor(row.actor);
      if (userId === null || !row.starting_at) continue;
      const hourUtc = truncToHourIso(row.starting_at);
      const key = `${userId}|${hourUtc}`;
      let acc = byKey.get(key);
      if (!acc) {
        acc = {
          userId,
          hourUtc,
          uncachedInputTokens: 0,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          outputTokens: 0,
          webSearchRequests: 0,
        };
        byKey.set(key, acc);
      }
      acc.uncachedInputTokens += n(row.uncached_input_tokens);
      acc.cacheCreationTokens +=
        n(row.cache_creation?.ephemeral_5m_input_tokens) + n(row.cache_creation?.ephemeral_1h_input_tokens);
      acc.cacheReadTokens += n(row.cache_read_input_tokens);
      acc.outputTokens += n(row.output_tokens);
      acc.webSearchRequests += n(row.server_tool_use?.web_search_requests);
    }
  }
  const rows = [...byKey.values()];
  return rows.length > 0 ? repos.usage.upsertHourly(rows) : 0;
}

// ---------------------------------------------------------------------------
// Org-level syncs
// ---------------------------------------------------------------------------

/** Org billed cost (analytics/cost_report, 1d buckets, cost_type+model) → cost_daily. */
export async function syncEnterpriseCostReport(
  client: EnterpriseClient,
  repos: Repos,
  fromDate: string,
  toDate: string,
): Promise<number> {
  let written = 0;
  for (let windowStart = fromDate; windowStart <= toDate; windowStart = addDays(windowStart, COST_WINDOW_DAYS)) {
    const windowEndExclusive =
      addDays(windowStart, COST_WINDOW_DAYS) < addDays(toDate, 1)
        ? addDays(windowStart, COST_WINDOW_DAYS)
        : addDays(toDate, 1);

    const rows: CostInsertRow[] = [];
    for await (const buckets of client.paginate<EntOrgCostBucket>('/v1/organizations/analytics/cost_report', {
      starting_at: dayStartIso(windowStart),
      ending_at: dayStartIso(windowEndExclusive),
      bucket_width: '1d',
      'group_by[]': ['cost_type', 'model'],
      limit: COST_WINDOW_DAYS,
    })) {
      for (const bucket of buckets) {
        const date = bucket.starting_at.slice(0, 10);
        for (const result of bucket.results ?? []) {
          const amountCents = Number(result.amount ?? '0'); // decimal string in cents
          if (!Number.isFinite(amountCents)) continue;
          rows.push({
            date,
            workspaceId: '', // claude.ai Enterprise has no workspace dimension → default bucket
            costType: result.cost_type ?? 'other',
            tokenType: '', // not grouped by token_type — keep it simple
            model: result.model ?? '',
            serviceTier: '',
            contextWindow: '',
            description: '',
            amountCents,
            currency: result.currency ?? 'USD',
          });
        }
      }
    }

    const coveredDates: string[] = [];
    for (let date = windowStart; date < windowEndExclusive; date = addDays(date, 1)) {
      coveredDates.push(date);
    }
    written += repos.cost.replaceDates(coveredDates, rows);
  }
  return written;
}

/** analytics/summaries → org_summaries, chunked to stay under the 366-day range cap. */
export async function syncEnterpriseSummaries(
  client: EnterpriseClient,
  repos: Repos,
  fromDate: string,
  toDate: string,
): Promise<number> {
  let written = 0;
  for (let chunkStart = fromDate; chunkStart <= toDate; chunkStart = addDays(chunkStart, SUMMARIES_CHUNK_DAYS)) {
    const chunkEnd =
      addDays(chunkStart, SUMMARIES_CHUNK_DAYS - 1) < toDate ? addDays(chunkStart, SUMMARIES_CHUNK_DAYS - 1) : toDate;
    const res = await client.fetchWithRetry<EntSummariesResponse>(
      client.buildUrl('/v1/organizations/analytics/summaries', {
        starting_date: chunkStart,
        ending_date: chunkEnd,
      }),
    );
    const rows = (res.summaries ?? [])
      .filter((s) => typeof s.starting_at === 'string' && s.starting_at.length >= 10)
      .map((s) => ({
        date: s.starting_at.slice(0, 10),
        assignedSeatCount: n(s.assigned_seat_count),
        pendingInviteCount: n(s.pending_invite_count),
        dau: n(s.daily_active_user_count),
        wau: n(s.weekly_active_user_count),
        mau: n(s.monthly_active_user_count),
        claudeCodeDau:
          typeof s.claude_code_daily_active_user_count === 'number' ? s.claude_code_daily_active_user_count : null,
        rawJson: JSON.stringify(s),
      }));
    if (rows.length > 0) written += repos.orgSummaries.upsertMany(rows);
  }
  return written;
}

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

type OnProgress = Parameters<SyncPlan['runJob']>[1];

/**
 * claude.ai Enterprise Analytics sync plan (ENTERPRISE_ANALYTICS_KEY).
 * Console-only syncs (org users roster, api key usage, dimensions, org meta,
 * console usage/cost reports) never run here.
 */
export class EnterpriseSyncPlan implements SyncPlan {
  constructor(
    private readonly env: Env,
    private readonly repos: Repos,
    private readonly client: EnterpriseClient,
  ) {}

  isBackfillDone(): boolean {
    return this.repos.sync.getState(ENT_STATE_BACKFILL_DONE) === '1';
  }

  private backfillStart(): string {
    const configured = this.env.backfillStart ?? ENT_DATA_EPOCH;
    return configured > ENT_DATA_EPOCH ? configured : ENT_DATA_EPOCH;
  }

  async runJob(run: SyncRunInfo, onProgress: OnProgress, log: SyncLogger): Promise<number> {
    const resolver = new EnterpriseActorResolver(this.repos);
    switch (run.jobType) {
      case 'roster':
        log.info('roster: re-reading latest engagement day + summaries');
        return this.syncRosterish(resolver);
      case 'daily':
        log.info('daily: syncing intraday tokens + cost');
        return this.syncIntradayUsage(resolver);
      case 'hourly':
        log.info('hourly: syncing hourly activity tail');
        return this.syncHourlyTail(resolver);
      case 'nightly':
        log.info('nightly: engagement + cost + summaries + snapshots');
        return this.syncNightly(resolver);
      case 'backfill':
        log.info('backfill: walking engagement history day by day');
        return this.syncBackfill(resolver, onProgress);
      default: {
        const exhaustive: never = run.jobType;
        throw new Error(`unknown job type ${String(exhaustive)}`);
      }
    }
  }

  /**
   * There is no seat-list endpoint: a manual "roster" run re-reads the latest
   * available engagement day (which upserts every seen user) + refreshes
   * summaries (assigned_seat_count = the real seat denominator).
   */
  private async syncRosterish(resolver: EnterpriseActorResolver): Promise<number> {
    const latest = await discoverLatestAvailableDay(this.client, this.repos);
    const { usersSeen } = await fetchEngagementDay(this.client, resolver, latest);
    const today = todayUtc();
    const summaries = await syncEnterpriseSummaries(
      this.client,
      this.repos,
      addDays(today, -(SUMMARIES_NIGHTLY_DAYS - 1)),
      today,
    );
    return usersSeen + summaries;
  }

  /** Intraday tick: tokens+cost for the last 2 days only — engagement lags days. */
  private async syncIntradayUsage(resolver: EnterpriseActorResolver): Promise<number> {
    const today = todayUtc();
    let rows = 0;
    for (let i = INTRADAY_USAGE_DAYS - 1; i >= 0; i--) {
      rows += await syncEnterpriseModelsOnlyDay(this.client, this.repos, resolver, addDays(today, -i));
    }
    return rows;
  }

  /** Hourly tail: watermark−3h → now (or HOURLY_BACKFILL_DAYS back), one request per day. */
  private async syncHourlyTail(resolver: EnterpriseActorResolver): Promise<number> {
    const now = Date.now();
    const watermark = this.repos.sync.getState(ENT_STATE_HOURLY_WATERMARK);
    let fromMs: number;
    if (watermark) {
      const parsed = Date.parse(watermark);
      fromMs = Number.isFinite(parsed) ? parsed - 3 * 3_600_000 : now - this.env.hourlyBackfillDays * 86_400_000;
    } else {
      fromMs = now - this.env.hourlyBackfillDays * 86_400_000;
    }
    const epochMs = Date.parse(dayStartIso(ENT_DATA_EPOCH));
    if (fromMs < epochMs) fromMs = epochMs;

    const today = todayUtc();
    let rows = 0;
    for (let date = new Date(fromMs).toISOString().slice(0, 10); date <= today; date = addDays(date, 1)) {
      rows += await syncEnterpriseHourlyDay(this.client, this.repos, resolver, date);
    }
    this.repos.sync.setState(ENT_STATE_HOURLY_WATERMARK, hourIsoOf(new Date(now)));
    return rows;
  }

  private async syncNightly(resolver: EnterpriseActorResolver): Promise<number> {
    const latest = await discoverLatestAvailableDay(this.client, this.repos);
    let rows = 0;
    // trailing 5 AVAILABLE days: engagement + models + cost (one txn per day) + hourly
    for (let i = NIGHTLY_ENGAGEMENT_DAYS - 1; i >= 0; i--) {
      const date = addDays(latest, -i);
      if (date < ENT_DATA_EPOCH) continue;
      rows += await syncEnterpriseDay(this.client, this.repos, resolver, date);
      rows += await syncEnterpriseHourlyDay(this.client, this.repos, resolver, date);
    }
    this.repos.sync.setState(ENT_STATE_DAILY_WATERMARK, latest);

    const today = todayUtc();
    rows += await syncEnterpriseCostReport(this.client, this.repos, addDays(today, -(COST_NIGHTLY_DAYS - 1)), today);
    rows += await syncEnterpriseSummaries(this.client, this.repos, addDays(today, -(SUMMARIES_NIGHTLY_DAYS - 1)), today);
    writeSnapshots(this.repos);
    return rows;
  }

  /**
   * Historical backfill: newest→oldest day-by-day (same UX as console) from
   * the latest available day down to max(BACKFILL_START, 2026-01-01), each day
   * engagement+models+cost in one transaction + hourly. Resumable via the
   * ent_-namespaced cursor; then summaries (300-day chunks) and org cost
   * report (31-day windows) over the whole range.
   */
  private async syncBackfill(resolver: EnterpriseActorResolver, onProgress: OnProgress): Promise<number> {
    const latest = await discoverLatestAvailableDay(this.client, this.repos);
    const start = this.backfillStart();

    // A re-run after completion is a deliberate restart from the newest day.
    const alreadyDone = this.repos.sync.getState(ENT_STATE_BACKFILL_DONE) === '1';
    let cursor = alreadyDone ? latest : (this.repos.sync.getState(ENT_STATE_BACKFILL_CURSOR) ?? latest);
    if (cursor > latest) cursor = latest;

    let rows = 0;
    let daysDone = 0;
    while (cursor >= start) {
      rows += await syncEnterpriseDay(this.client, this.repos, resolver, cursor);
      rows += await syncEnterpriseHourlyDay(this.client, this.repos, resolver, cursor);
      daysDone += 1;
      const next = addDays(cursor, -1);
      this.repos.sync.setState(ENT_STATE_BACKFILL_CURSOR, next);
      onProgress({ currentDate: cursor, daysDone, earliestFound: start }, rows);
      cursor = next;
    }
    this.repos.sync.setState(ENT_STATE_BACKFILL_DONE, '1');

    const today = todayUtc();
    rows += await syncEnterpriseSummaries(this.client, this.repos, start, today);
    rows += await syncEnterpriseCostReport(this.client, this.repos, start, today);
    this.repos.sync.setState(ENT_STATE_HOURLY_WATERMARK, hourIsoOf(new Date()));
    writeSnapshots(this.repos);
    return rows;
  }
}
