/**
 * Work-week math over 'YYYY-MM-DD' date strings, plus the org-local ⇄ UTC
 * conversions the daily and hourly tables need.
 *
 * Workdays are Sunday–Thursday; Friday/Saturday are the weekend and NEVER
 * break a streak. Daily dates are ORG-LOCAL calendar days (see `localDateOf`,
 * used by the telemetry ingest) — the weekday is a property of the date string
 * itself, no timezone conversion involved there. Hour tables stay UTC, so any
 * hour-bounded query over a local-day range must go through
 * `utcHourRangeOfLocalDays` rather than pasting 'T00:00:00Z' onto a local date.
 *
 * The zone defaults to Asia/Jerusalem and is overridable per call; the server
 * passes ORG_TIMEZONE. Sun–Thu is still hardcoded — an org on a Mon–Fri week
 * needs more than a zone.
 */

const DAY_MS = 86_400_000;

export const DEFAULT_ORG_TIMEZONE = 'Asia/Jerusalem';

/**
 * Numeric parts of an instant in `tz`. Formatters are cached per zone and read
 * through `formatToParts`: a locale's *pattern* is not guaranteed (an ICU build
 * without en-CA falls back to en-US and yields '07/29/2026'), but the part
 * values are, and these values become database keys.
 */
const partsFmtByZone = new Map<string, Intl.DateTimeFormat>();

function partsOf(instant: Date, tz: string): Record<string, number> {
  let fmt = partsFmtByZone.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    partsFmtByZone.set(tz, fmt);
  }
  const out: Record<string, number> = {};
  for (const p of fmt.formatToParts(instant)) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return out;
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/**
 * Org-local calendar day of an instant. The daily bucket MUST be local:
 * everything downstream (Sun–Thu workweek, streaks, active days) is local, so
 * a UTC key files work done after midnight local time under the previous day —
 * silently emptying the new day and breaking streaks.
 */
export function localDateOf(instant: string | Date, tz: string = DEFAULT_ORG_TIMEZONE): string {
  const d = typeof instant === 'string' ? new Date(instant) : instant;
  if (Number.isNaN(d.getTime())) throw new RangeError(`localDateOf: invalid instant ${String(instant)}`);
  const p = partsOf(d, tz);
  // h23 renders midnight as 00, but a stray '24' would still belong to that day
  return `${pad(p['year'] ?? 0, 4)}-${pad(p['month'] ?? 1)}-${pad(p['day'] ?? 1)}`;
}

/** ms to add to a UTC instant to get its wall-clock reading in `tz`. */
function zoneOffsetMs(instantMs: number, tz: string): number {
  const p = partsOf(new Date(instantMs), tz);
  const wall = Date.UTC(
    p['year'] ?? 1970,
    (p['month'] ?? 1) - 1,
    p['day'] ?? 1,
    (p['hour'] ?? 0) % 24,
    p['minute'] ?? 0,
    p['second'] ?? 0,
  );
  return wall - instantMs;
}

/** UTC instant of a local wall-clock time, given that time as if it were UTC. */
function instantOfLocalWall(wallAsUtcMs: number, tz: string): number {
  // one correction pass, then a second so a DST shift between the guess and the
  // corrected instant still resolves
  const guess = wallAsUtcMs - zoneOffsetMs(wallAsUtcMs, tz);
  return wallAsUtcMs - zoneOffsetMs(guess, tz);
}

/**
 * UTC hour buckets ('YYYY-MM-DDTHH:00:00Z') spanning the local days
 * [from, to] inclusive. The hour tables are keyed by UTC hour while every range
 * in the app is a local day; string-pasting 'T00:00:00Z' onto a local date
 * shifts the window by the zone offset, which drops the range's first local
 * hours and leaks the same number from the day after `to`.
 */
export function utcHourRangeOfLocalDays(
  from: string,
  to: string,
  tz: string = DEFAULT_ORG_TIMEZONE,
): { fromHour: string; toHour: string } {
  const startMs = instantOfLocalWall(Date.parse(`${from}T00:00:00Z`), tz);
  const endMs = instantOfLocalWall(Date.parse(`${to}T23:00:00Z`), tz);
  return {
    fromHour: `${new Date(startMs).toISOString().slice(0, 13)}:00:00Z`,
    toHour: `${new Date(endMs).toISOString().slice(0, 13)}:00:00Z`,
  };
}

export function toUtcDate(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

export function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  return toDateString(new Date(toUtcDate(date).getTime() + days * DAY_MS));
}

/** 0=Sunday … 6=Saturday */
export function weekdayOf(date: string): number {
  return toUtcDate(date).getUTCDay();
}

export function isWorkday(date: string): boolean {
  const wd = weekdayOf(date);
  return wd >= 0 && wd <= 4; // Sun–Thu
}

/** Count Sun–Thu days in [from, to] inclusive. */
export function workdaysBetween(from: string, to: string): number {
  let count = 0;
  const end = toUtcDate(to).getTime();
  for (let t = toUtcDate(from).getTime(); t <= end; t += DAY_MS) {
    const wd = new Date(t).getUTCDay();
    if (wd <= 4) count++;
  }
  return count;
}

export function daysBetween(from: string, to: string): number {
  return Math.round((toUtcDate(to).getTime() - toUtcDate(from).getTime()) / DAY_MS);
}

/**
 * Walk back from `date` over days that don't count: an IDLE Fri/Sat. An active
 * Fri/Sat counts (working the weekend extends a streak), an idle workday stops
 * the walk (it breaks the streak).
 */
function skipIdleWeekend(activeDates: ReadonlySet<string>, date: string): string {
  let cursor = date;
  while (!activeDates.has(cursor) && !isWorkday(cursor)) cursor = addDays(cursor, -1);
  return cursor;
}

/**
 * Current streak of consecutive active days ending at (or just before) `asOf`.
 * Idle Fri/Sat are skipped transparently; an ACTIVE Fri/Sat counts as a streak
 * day. If the last counting day is idle (e.g. today, partial data), it is
 * granted grace: the streak is measured ending one counting day earlier — but
 * only one such grace day, and only for `asOf` itself.
 */
export function currentWorkdayStreak(activeDates: ReadonlySet<string>, asOf: string): number {
  let cursor = skipIdleWeekend(activeDates, asOf);
  if (!activeDates.has(cursor)) {
    // grace only when the missing day is asOf itself (or the weekend rewind of it)
    cursor = skipIdleWeekend(activeDates, addDays(cursor, -1));
  }
  let streak = 0;
  while (activeDates.has(cursor)) {
    streak++;
    cursor = skipIdleWeekend(activeDates, addDays(cursor, -1));
  }
  return streak;
}

/** Longest run of consecutive active days anywhere in the set (idle Fri/Sat bridge). */
export function bestWorkdayStreak(activeDates: ReadonlySet<string>): number {
  if (activeDates.size === 0) return 0;
  const sorted = [...activeDates].sort();
  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const date of sorted) {
    // contiguous when every day between prev and date is an idle weekend day
    let contiguous = prev !== null;
    if (prev !== null) {
      for (let d = addDays(prev, 1); d < date; d = addDays(d, 1)) {
        if (isWorkday(d)) {
          contiguous = false;
          break;
        }
      }
    }
    run = contiguous ? run + 1 : 1;
    if (run > best) best = run;
    prev = date;
  }
  return best;
}
