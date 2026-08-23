/**
 * Fixed scoring targets — the reference every volume/ratio metric is scored
 * against. Replaces org-max normalization so one person's volume can never
 * rescale anyone else's score: an axis score is a pure function of the user's
 * own numbers and these constants.
 *
 * Volume targets are rates per workday (Sun–Thu) and scale with the selected
 * range via `workdaysBetween`; ratio targets are flat. Defaults were derived
 * from a real 31-user org's p90 rates (2026-08); admins can override any
 * subset via settings (`scoreTargets`) — unknown/invalid values fall back to
 * these defaults rather than zeroing anyone.
 */

export interface ScoreTargets {
  /** rate per workday; multiplied by max(1, workdays in range) */
  perWorkday: {
    sessions: number;
    toolEvents: number;
    linesAdded: number;
    commits: number;
    pullRequests: number;
  };
  /** range-independent ratios */
  flat: {
    linesPerSession: number;
    linesPerDollar: number;
  };
}

export const DEFAULT_SCORE_TARGETS: ScoreTargets = {
  perWorkday: { sessions: 8, toolEvents: 50, linesAdded: 1400, commits: 7.5, pullRequests: 0.5 },
  flat: { linesPerSession: 430, linesPerDollar: 48 },
};

/**
 * Share of active users (sessions > 0) with a nonzero value for each
 * git-derived Impact term, over a trailing-90d window — deliberately NOT the
 * selected range, so Impact weights are a stable org fact instead of flipping
 * with the date picker (a 7-day view has near-zero PR coverage even in a
 * GitHub org).
 */
export interface ImpactCoverage {
  pullRequests: number;
  commits: number;
}

/** Below this coverage a git-derived Impact term redistributes its weight. */
export const COVERAGE_MIN = 0.25;

const positive = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0;

/**
 * Deep-merge a (possibly partial/malformed) stored override over the
 * defaults. Only finite positive numbers are honored, per key — a bad or
 * partial value degrades to the default instead of breaking scoring.
 */
export function resolveTargets(override?: unknown): ScoreTargets {
  const o = (override ?? {}) as Partial<ScoreTargets>;
  const pick = <T extends Record<string, number>>(base: T, over: Partial<T> | undefined): T => {
    const out: Record<string, number> = { ...base };
    if (over && typeof over === 'object') {
      for (const key of Object.keys(base)) {
        const v = (over as Record<string, unknown>)[key];
        if (positive(v)) out[key] = v;
      }
    }
    return out as T;
  };
  return {
    perWorkday: pick(DEFAULT_SCORE_TARGETS.perWorkday, o.perWorkday),
    flat: pick(DEFAULT_SCORE_TARGETS.flat, o.flat),
  };
}
