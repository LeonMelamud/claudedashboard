/**
 * Israeli work-week math over 'YYYY-MM-DD' date strings.
 * Workdays are Sunday–Thursday; Friday/Saturday are the weekend and NEVER
 * break a streak. Daily usage dates are UTC calendar days — the weekday is a
 * property of the date string itself, no timezone conversion involved.
 */

const DAY_MS = 86_400_000;

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
 * Current streak of consecutive active WORKDAYS ending at (or just before)
 * `asOf`. Fri/Sat are skipped transparently. If `asOf` itself is a workday
 * with no activity yet (e.g. today, partial data), it is granted grace: the
 * streak is measured ending at the previous workday instead — but only one
 * such grace day, and only for `asOf` itself.
 */
export function currentWorkdayStreak(activeDates: ReadonlySet<string>, asOf: string): number {
  let cursor = asOf;
  // rewind weekend to the preceding workday
  while (!isWorkday(cursor)) cursor = addDays(cursor, -1);
  if (!activeDates.has(cursor)) {
    // grace only when the missing day is asOf itself (or the weekend rewind of it)
    let prev = addDays(cursor, -1);
    while (!isWorkday(prev)) prev = addDays(prev, -1);
    cursor = prev;
  }
  let streak = 0;
  while (activeDates.has(cursor)) {
    streak++;
    let prev = addDays(cursor, -1);
    while (!isWorkday(prev)) prev = addDays(prev, -1);
    cursor = prev;
  }
  return streak;
}

/** Longest run of consecutive active workdays anywhere in the set. */
export function bestWorkdayStreak(activeDates: ReadonlySet<string>): number {
  if (activeDates.size === 0) return 0;
  const sorted = [...activeDates].filter(isWorkday).sort();
  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const date of sorted) {
    if (prev !== null) {
      // next expected workday after prev
      let expected = addDays(prev, 1);
      while (!isWorkday(expected)) expected = addDays(expected, 1);
      run = date === expected ? run + 1 : 1;
    } else {
      run = 1;
    }
    if (run > best) best = run;
    prev = date;
  }
  return best;
}
