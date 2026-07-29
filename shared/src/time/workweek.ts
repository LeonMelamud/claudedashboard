/**
 * Israeli work-week math over 'YYYY-MM-DD' date strings.
 * Workdays are Sunday–Thursday; Friday/Saturday are the weekend and NEVER
 * break a streak. Daily dates are Israel-local calendar days (see
 * `ilDateOfIso`, used by the telemetry ingest) — the weekday is a property of
 * the date string itself, no timezone conversion involved here.
 */

const DAY_MS = 86_400_000;

const IL_TZ = 'Asia/Jerusalem';

/** en-CA formats as 'YYYY-MM-DD'; Intl handles Israeli DST. */
const ilDateFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: IL_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * Israel-local calendar day of an instant. The daily bucket MUST be local:
 * everything downstream (Sun–Thu workweek, streaks, active days) is Israeli,
 * so a UTC key files work done after midnight Israel time under the previous
 * day — silently emptying the new day and breaking streaks.
 */
export function ilDateOfIso(iso: string | Date): string {
  return ilDateFmt.format(typeof iso === 'string' ? new Date(iso) : iso);
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
