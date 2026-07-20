/**
 * OTLP/HTTP JSON metrics ingest for Claude Code telemetry. Walks
 * resourceMetrics → scopeMetrics → metrics → sum.dataPoints and aggregates
 * datapoint deltas per (date/hour, user, dimension), then writes everything
 * in ONE transaction (dedup check included).
 *
 * Two write classes:
 *  - [CORE]  usage_daily / usage_daily_models / usage_hourly — ONLY when
 *            env.dataSource === 'telemetry' (in console/enterprise mode those
 *            tables belong to the API sync and additive deltas would double-count);
 *  - packs   otel_activity_* / otel_mcp_daily / otel_token_mix_daily and the
 *            users.cc_app_version observation — written in EVERY mode.
 *
 * Only DELTA temporality sums are accepted; cumulative datapoints are dropped
 * and counted in sync_state.otel_metrics_dropped_cumulative.
 */
import type { TelemetryPolicyResponse } from '@dash/shared';
import type { AppContext } from '../context';
import type {
  ActivityDailyDelta,
  ActivityHourlyDelta,
  McpDailyDelta,
  TokenMixDelta,
} from '../repos/otelRepo';
import type { DailyDeltaRow, HourlyUpsertRow, ModelDeltaRow } from '../repos/usageRepo';
import { attrsToMap, getString, metricTime, type AttrMap, type EmailUserResolver } from './common';
import { sanitize } from './privacy';

const SEP = '\u0000';

/** Metric names we understand; everything else is ignored silently. */
const KNOWN_METRICS = new Set([
  'claude_code.session.count',
  'claude_code.lines_of_code.count',
  'claude_code.commit.count',
  'claude_code.pull_request.count',
  'claude_code.code_edit_tool.decision',
  'claude_code.token.usage',
  'claude_code.cost.usage',
  'claude_code.active_time.total',
]);

function hourIsoOfIso(iso: string): string {
  return `${iso.slice(0, 13)}:00:00Z`;
}

/** sum datapoint value: asDouble | asInt (int64 arrives as a string). */
function pointValue(dp: Record<string, unknown>): number | null {
  const d = dp['asDouble'];
  if (typeof d === 'number' && Number.isFinite(d)) return d;
  const i = dp['asInt'];
  if (typeof i === 'string' || typeof i === 'number') {
    const n = Number(i);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

// opentelemetry-proto: AGGREGATION_TEMPORALITY_DELTA = 1, CUMULATIVE = 2
function isDeltaTemporality(sum: Record<string, unknown>): boolean {
  const t = sum['aggregationTemporality'];
  return t === 1 || t === 'AGGREGATION_TEMPORALITY_DELTA';
}

// ---------------------------------------------------------------------------
// Batch aggregation
// ---------------------------------------------------------------------------

class MetricsAgg {
  readonly dailyCore = new Map<string, DailyDeltaRow>();
  readonly models = new Map<string, ModelDeltaRow>();
  readonly hourly = new Map<string, HourlyUpsertRow>();
  readonly activityDaily = new Map<string, ActivityDailyDelta>();
  readonly activityHourly = new Map<string, ActivityHourlyDelta>();
  readonly mcpDaily = new Map<string, McpDailyDelta>();
  readonly tokenMix = new Map<string, TokenMixDelta>();
  /** userId → newest {version, iso} observed in this batch. */
  readonly appVersions = new Map<number, { version: string; iso: string }>();
  datapoints = 0;
  droppedCumulative = 0;
  droppedNoUser = 0;

  core(date: string, userId: number, terminalType: string): DailyDeltaRow {
    const key = `${date}${SEP}${userId}${SEP}${terminalType}`;
    let d = this.dailyCore.get(key);
    if (!d) {
      d = {
        date,
        userId,
        terminalType,
        customerType: '',
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
      };
      this.dailyCore.set(key, d);
    }
    return d;
  }

  model(date: string, userId: number, terminalType: string, model: string): ModelDeltaRow {
    const key = `${date}${SEP}${userId}${SEP}${terminalType}${SEP}${model}`;
    let d = this.models.get(key);
    if (!d) {
      d = {
        date,
        userId,
        terminalType,
        customerType: '',
        model,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        costCents: 0,
      };
      this.models.set(key, d);
    }
    return d;
  }

  hour(userId: number, hourUtc: string): HourlyUpsertRow {
    const key = `${userId}${SEP}${hourUtc}`;
    let d = this.hourly.get(key);
    if (!d) {
      d = {
        userId,
        hourUtc,
        uncachedInputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        outputTokens: 0,
        webSearchRequests: 0,
      };
      this.hourly.set(key, d);
    }
    return d;
  }

  activity(date: string, userId: number): ActivityDailyDelta {
    const key = `${date}${SEP}${userId}`;
    let d = this.activityDaily.get(key);
    if (!d) {
      d = { date, userId, activeUserS: 0, activeCliS: 0, prompts: 0, sessions: 0 };
      this.activityDaily.set(key, d);
    }
    return d;
  }

  activityHour(userId: number, hourUtc: string): ActivityHourlyDelta {
    const key = `${userId}${SEP}${hourUtc}`;
    let d = this.activityHourly.get(key);
    if (!d) {
      d = { userId, hourUtc, prompts: 0, apiRequests: 0, sessionsStarted: 0 };
      this.activityHourly.set(key, d);
    }
    return d;
  }

  mcp(date: string, userId: number, serverName: string): McpDailyDelta {
    const key = `${date}${SEP}${userId}${SEP}${serverName}`;
    let d = this.mcpDaily.get(key);
    if (!d) {
      d = {
        date,
        userId,
        serverName,
        toolCalls: 0,
        toolFailures: 0,
        tokens: 0,
        costCents: 0,
        connections: 0,
        connectionFailures: 0,
      };
      this.mcpDaily.set(key, d);
    }
    return d;
  }

  mix(date: string, userId: number, model: string, speed: string, effort: string): TokenMixDelta {
    const key = `${date}${SEP}${userId}${SEP}${model}${SEP}${speed}${SEP}${effort}`;
    let d = this.tokenMix.get(key);
    if (!d) {
      d = { date, userId, model, speed, effort, tokens: 0, costCents: 0 };
      this.tokenMix.set(key, d);
    }
    return d;
  }

  observeAppVersion(userId: number, version: string, iso: string): void {
    const prev = this.appVersions.get(userId);
    if (!prev || iso > prev.iso) this.appVersions.set(userId, { version, iso });
  }
}

/** One sanitized datapoint → the aggregate maps. */
function applyPoint(
  agg: MetricsAgg,
  metricName: string,
  attrs: AttrMap,
  userId: number,
  date: string,
  iso: string,
  terminalType: string,
  value: number,
): void {
  const hourUtc = hourIsoOfIso(iso);
  switch (metricName) {
    case 'claude_code.session.count': {
      agg.core(date, userId, terminalType).numSessions += value;
      agg.activity(date, userId).sessions += value;
      agg.activityHour(userId, hourUtc).sessionsStarted += value;
      break;
    }
    case 'claude_code.lines_of_code.count': {
      const type = getString(attrs, 'type');
      const core = agg.core(date, userId, terminalType);
      if (type === 'added') core.linesAdded += value;
      else if (type === 'removed') core.linesRemoved += value;
      break;
    }
    case 'claude_code.commit.count': {
      agg.core(date, userId, terminalType).commits += value;
      break;
    }
    case 'claude_code.pull_request.count': {
      agg.core(date, userId, terminalType).pullRequests += value;
      break;
    }
    case 'claude_code.code_edit_tool.decision': {
      const tool = getString(attrs, 'tool_name');
      const decision = getString(attrs, 'decision');
      if (decision !== 'accept' && decision !== 'reject') break;
      const core = agg.core(date, userId, terminalType);
      const accept = decision === 'accept';
      if (tool === 'Edit') accept ? (core.editAccepted += value) : (core.editRejected += value);
      else if (tool === 'MultiEdit') accept ? (core.multiEditAccepted += value) : (core.multiEditRejected += value);
      else if (tool === 'Write') accept ? (core.writeAccepted += value) : (core.writeRejected += value);
      else if (tool === 'NotebookEdit') accept ? (core.notebookAccepted += value) : (core.notebookRejected += value);
      break;
    }
    case 'claude_code.token.usage': {
      const type = getString(attrs, 'type');
      const model = getString(attrs, 'model') ?? 'unknown';
      const m = agg.model(date, userId, terminalType, model);
      const h = agg.hour(userId, hourUtc);
      if (type === 'input') {
        m.inputTokens += value;
        h.uncachedInputTokens += value;
      } else if (type === 'output') {
        m.outputTokens += value;
        h.outputTokens += value;
      } else if (type === 'cacheRead') {
        m.cacheReadTokens += value;
        h.cacheReadTokens += value;
      } else if (type === 'cacheCreation') {
        m.cacheCreationTokens += value;
        h.cacheCreationTokens += value;
      } else {
        break; // unknown token type — ignore
      }
      const mcpServer = getString(attrs, 'mcp_server.name');
      if (mcpServer) agg.mcp(date, userId, mcpServer).tokens += value;
      agg.mix(
        date,
        userId,
        getString(attrs, 'model') ?? '',
        getString(attrs, 'speed') ?? '',
        getString(attrs, 'effort') ?? '',
      ).tokens += value;
      break;
    }
    case 'claude_code.cost.usage': {
      const cents = value * 100;
      const model = getString(attrs, 'model') ?? 'unknown';
      agg.model(date, userId, terminalType, model).costCents += cents;
      const mcpServer = getString(attrs, 'mcp_server.name');
      if (mcpServer) agg.mcp(date, userId, mcpServer).costCents += cents;
      agg.mix(
        date,
        userId,
        getString(attrs, 'model') ?? '',
        getString(attrs, 'speed') ?? '',
        getString(attrs, 'effort') ?? '',
      ).costCents += cents;
      break;
    }
    case 'claude_code.active_time.total': {
      const type = getString(attrs, 'type');
      const activity = agg.activity(date, userId);
      if (type === 'user') activity.activeUserS += value; // docs say seconds — stored raw
      else if (type === 'cli') activity.activeCliS += value;
      break;
    }
  }
}

/** Walk the OTLP payload; sanitize is the single choke point before mapping. */
function buildAgg(
  payload: unknown,
  resolver: EmailUserResolver,
  policy: TelemetryPolicyResponse,
): MetricsAgg {
  const agg = new MetricsAgg();
  if (typeof payload !== 'object' || payload === null) return agg;
  const resourceMetrics = (payload as { resourceMetrics?: unknown }).resourceMetrics;
  if (!Array.isArray(resourceMetrics)) return agg;
  for (const rm of resourceMetrics) {
    if (typeof rm !== 'object' || rm === null) continue;
    const resource = (rm as { resource?: unknown }).resource as { attributes?: unknown } | undefined;
    const resourceAttrs = attrsToMap(resource?.attributes);
    const scopeMetrics = (rm as { scopeMetrics?: unknown }).scopeMetrics;
    if (!Array.isArray(scopeMetrics)) continue;
    for (const sm of scopeMetrics) {
      if (typeof sm !== 'object' || sm === null) continue;
      const metrics = (sm as { metrics?: unknown }).metrics;
      if (!Array.isArray(metrics)) continue;
      for (const metric of metrics) {
        if (typeof metric !== 'object' || metric === null) continue;
        const name = (metric as { name?: unknown }).name;
        if (typeof name !== 'string' || !KNOWN_METRICS.has(name)) continue;
        const sum = (metric as { sum?: unknown }).sum;
        if (typeof sum !== 'object' || sum === null) continue; // gauge/histogram — skip
        const dataPoints = (sum as { dataPoints?: unknown }).dataPoints;
        if (!Array.isArray(dataPoints)) continue;
        if (!isDeltaTemporality(sum as Record<string, unknown>)) {
          agg.droppedCumulative += dataPoints.length; // cumulative would double-count
          continue;
        }
        for (const dp of dataPoints) {
          if (typeof dp !== 'object' || dp === null) continue;
          const point = dp as Record<string, unknown>;
          const value = pointValue(point);
          if (value === null || value <= 0) continue;
          // datapoint attrs win, resource attrs fill the gaps
          const merged: AttrMap = new Map(resourceAttrs);
          for (const [k, v] of attrsToMap(point['attributes'])) merged.set(k, v);
          const attrs = sanitize(name, merged, policy);
          const email = getString(attrs, 'user.email');
          if (!email) {
            agg.droppedNoUser += 1;
            continue;
          }
          const userId = resolver.resolve(email);
          const { date, iso } = metricTime(point['timeUnixNano'], point['startTimeUnixNano']);
          const terminalType = getString(attrs, 'terminal.type') ?? '';
          applyPoint(agg, name, attrs, userId, date, iso, terminalType, value);
          const appVersion = getString(attrs, 'app.version');
          if (appVersion) agg.observeAppVersion(userId, appVersion, iso);
          agg.datapoints += 1;
        }
      }
    }
  }
  return agg;
}

// ---------------------------------------------------------------------------
// Ingest — one transaction: dedup + core (telemetry mode only) + pack tables
// ---------------------------------------------------------------------------

export interface MetricsIngestResult {
  status: 'ok' | 'duplicate';
  datapoints: number;
  droppedCumulative: number;
}

export function ingestMetricsPayload(
  ctx: AppContext,
  payload: unknown,
  rawBodyHash: string | null,
  resolver: EmailUserResolver,
  policy: TelemetryPolicyResponse,
): MetricsIngestResult {
  const agg = buildAgg(payload, resolver, policy);
  const writeCore = ctx.env.dataSource === 'telemetry';

  const txn = ctx.db.transaction((): 'ok' | 'duplicate' => {
    if (rawBodyHash !== null && !ctx.repos.otel.tryMarkIngest(rawBodyHash)) return 'duplicate';
    if (writeCore) {
      if (agg.dailyCore.size > 0) ctx.repos.usage.upsertDailyDeltas([...agg.dailyCore.values()]);
      if (agg.models.size > 0) ctx.repos.usage.upsertModelDeltas([...agg.models.values()]);
      if (agg.hourly.size > 0) ctx.repos.usage.upsertHourlyDeltas([...agg.hourly.values()]);
      for (const row of agg.dailyCore.values()) ctx.repos.users.touchSeenDates(row.userId, row.date);
    }
    ctx.repos.otel.addActivityDaily([...agg.activityDaily.values()]);
    ctx.repos.otel.addActivityHourly([...agg.activityHourly.values()]);
    ctx.repos.otel.addMcpDaily([...agg.mcpDaily.values()]);
    ctx.repos.otel.addTokenMixDaily([...agg.tokenMix.values()]);
    for (const [userId, obs] of agg.appVersions) {
      ctx.repos.users.updateAppVersion(userId, obs.version, obs.iso);
    }
    if (agg.datapoints > 0) ctx.repos.otel.bumpCounter('otel_metrics_ingested', agg.datapoints);
    if (agg.droppedCumulative > 0) {
      ctx.repos.otel.bumpCounter('otel_metrics_dropped_cumulative', agg.droppedCumulative);
    }
    return 'ok';
  });

  return { status: txn(), datapoints: agg.datapoints, droppedCumulative: agg.droppedCumulative };
}
