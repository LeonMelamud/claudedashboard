/**
 * Shared OTLP/HTTP JSON plumbing for the telemetry receiver: attribute and
 * timestamp parsing (proto3 JSON mapping, lowerCamelCase keys) plus the
 * email → user resolver used by both the logs and metrics endpoints.
 */
import { localDateOf } from '@dash/shared';
import type { UserRepo } from '../repos/userRepo';
import { orgTimezone } from '../util/time';

export type AttrValue = string | number | boolean;
export type AttrMap = Map<string, AttrValue>;

/** [{key, value:{stringValue|intValue|doubleValue|boolValue}}] → flat Map. */
export function attrsToMap(raw: unknown): AttrMap {
  const map: AttrMap = new Map();
  if (!Array.isArray(raw)) return map;
  for (const kv of raw) {
    if (typeof kv !== 'object' || kv === null) continue;
    const { key, value } = kv as { key?: unknown; value?: unknown };
    if (typeof key !== 'string' || key === '') continue;
    if (typeof value !== 'object' || value === null) continue;
    const v = value as { stringValue?: unknown; intValue?: unknown; doubleValue?: unknown; boolValue?: unknown };
    if (typeof v.stringValue === 'string') {
      map.set(key, v.stringValue);
    } else if (typeof v.boolValue === 'boolean') {
      map.set(key, v.boolValue);
    } else if (typeof v.intValue === 'string' || typeof v.intValue === 'number') {
      const n = Number(v.intValue); // proto3 JSON encodes int64 as string
      if (Number.isFinite(n)) map.set(key, n);
    } else if (typeof v.doubleValue === 'number' || typeof v.doubleValue === 'string') {
      const n = Number(v.doubleValue);
      if (Number.isFinite(n)) map.set(key, n);
    }
  }
  return map;
}

export function getString(attrs: AttrMap, key: string): string | null {
  const v = attrs.get(key);
  return typeof v === 'string' && v !== '' ? v : null;
}

export function getNumber(attrs: AttrMap, key: string): number | null {
  const v = attrs.get(key);
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/** true/false as real booleans or 'true'/'false' strings; null when absent. */
export function getBool(attrs: AttrMap, key: string): boolean | null {
  const v = attrs.get(key);
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const t = v.toLowerCase();
    if (t === 'true') return true;
    if (t === 'false') return false;
  }
  return null;
}

export interface EventTime {
  /** 'YYYY-MM-DD' — the ORG-LOCAL calendar day the daily tables are keyed by */
  date: string;
  /** full ISO, UTC — hour buckets stay UTC and are converted for display */
  iso: string;
}

/** timeUnixNano (string nanos) → { org-local 'YYYY-MM-DD', full UTC ISO }. */
export function timeOfUnixNano(n: unknown): EventTime | null {
  if (typeof n !== 'string' && typeof n !== 'number') return null;
  try {
    const ms = Number(BigInt(n) / 1_000_000n);
    if (!Number.isFinite(ms) || ms <= 0) return null;
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return null;
    const iso = d.toISOString();
    return { date: localDateOf(d, orgTimezone()), iso };
  } catch {
    return null; // non-integer strings, fractions, garbage
  }
}

const FUTURE_CLAMP_MS = 24 * 3_600_000;

/** Server-clock fallback when a record carries no usable timestamp. */
export function nowEventTime(): EventTime {
  const now = new Date();
  return { date: localDateOf(now, orgTimezone()), iso: now.toISOString() };
}

/**
 * Metric datapoint time: timeUnixNano → fallback startTimeUnixNano → server
 * now; timestamps more than 24h in the future are clamped to now (a skewed
 * client clock must not create rows on days that don't exist yet).
 */
export function metricTime(timeUnixNano: unknown, startTimeUnixNano: unknown): EventTime {
  const t = timeOfUnixNano(timeUnixNano) ?? timeOfUnixNano(startTimeUnixNano);
  if (!t) return nowEventTime();
  if (Date.parse(t.iso) > Date.now() + FUTURE_CLAMP_MS) return nowEventTime();
  return t;
}

export function parseToolParameters(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * email → user id cache; survives across batches. `clear()` on ingest failure
 * so a user merge that deleted a cached row cannot wedge the receiver.
 */
export class EmailUserResolver {
  private readonly cache = new Map<string, number>();

  constructor(private readonly users: UserRepo) {}

  resolve(rawEmail: string): number {
    const email = rawEmail.toLowerCase();
    const cached = this.cache.get(email);
    if (cached !== undefined) return cached;
    const existing = this.users.getByEmail(email);
    // unknown sender → non-roster user named after the email local-part
    const id = existing ? existing.id : this.users.insertUserActor(email, email.split('@')[0] ?? email);
    if (this.cache.size >= 10_000) this.cache.clear();
    this.cache.set(email, id);
    return id;
  }

  clear(): void {
    this.cache.clear();
  }
}
