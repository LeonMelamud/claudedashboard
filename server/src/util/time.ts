/** UTC + Israel-time helpers used by scoring, sync and the seeder. */
import { ilDateOfIso } from '@dash/shared';

export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Today in the org's local zone — the zone the daily tables are keyed by (see
 * `ilDateOfIso`). Any read path that compares against a `date` column must use
 * this; the Admin-API sync paths keep `todayUtc()` because Anthropic buckets by
 * UTC day.
 */
export function todayIl(): string {
  return ilDateOfIso(new Date());
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** 'YYYY-MM-DDTHH:00:00Z' for any Date. */
export function hourIsoOf(d: Date): string {
  return `${d.toISOString().slice(0, 13)}:00:00Z`;
}

/** Truncate any RFC3339 UTC timestamp to its hour bucket 'YYYY-MM-DDTHH:00:00Z'. */
export function truncToHourIso(iso: string): string {
  return `${new Date(iso).toISOString().slice(0, 13)}:00:00Z`;
}

const IL_TZ = 'Asia/Jerusalem';

const hourFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: IL_TZ,
  hour: 'numeric',
  hourCycle: 'h23',
});

const weekdayFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: IL_TZ,
  weekday: 'short',
});

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const hourCache = new Map<string, number>();
const weekdayCache = new Map<string, number>();

/** Israel local hour (0-23) of a UTC hour timestamp; DST-correct via Intl. */
export function ilHourOfUtc(hourUtcIso: string): number {
  let v = hourCache.get(hourUtcIso);
  if (v === undefined) {
    v = Number(hourFmt.format(new Date(hourUtcIso)));
    hourCache.set(hourUtcIso, v);
  }
  return v;
}

/** Israel local weekday (0=Sunday .. 6=Saturday) of a UTC hour timestamp. */
export function ilWeekdayOfUtc(hourUtcIso: string): number {
  let v = weekdayCache.get(hourUtcIso);
  if (v === undefined) {
    v = WEEKDAY_INDEX[weekdayFmt.format(new Date(hourUtcIso))] ?? 0;
    weekdayCache.set(hourUtcIso, v);
  }
  return v;
}

export function isNightIlHour(h: number): boolean {
  return h >= 22 || h < 5;
}

export function isEarlyIlHour(h: number): boolean {
  return h >= 5 && h < 9;
}
