import type { AxisScores, SegmentTier } from '../types.js';
import { normalize, percentile, clamp01 } from './normalize.js';

/**
 * Everything the scoring engine needs about one user for one date range.
 * The server assembles this from SQL aggregates; anything requiring raw rows
 * (streaks, night/early shares) is precomputed there.
 */
export interface ScoringInput {
  userId: number;
  sessions: number;
  activeDays: number;
  /** Sun–Thu days in the range */
  workdays: number;
  toolAccepted: number;
  toolRejected: number;
  linesAdded: number;
  commits: number;
  pullRequests: number;
  costCents: number;
  /** uncached input tokens (claude_code model_breakdown.tokens.input) */
  inputTokens: number;
  cacheReadTokens: number;
  /** total tokens per model, for Polyglot */
  modelTokens: Record<string, number>;
  /** share (0..1) of hourly activity in 22:00–04:59 / 05:00–08:59 org-local time; null = no hourly data */
  nightShare: number | null;
  earlyShare: number | null;
  /** trailing-90d consecutive active workdays */
  currentStreak: number;
  /** longest such run inside the trailing 90d — what streak badges are earned on */
  bestStreak: number;
}

/** Org-wide baselines, computed ONCE per range over the UNFILTERED nonzero-usage population. */
export interface Baselines {
  maxSessions: number;
  maxToolEvents: number;
  maxLinesAdded: number;
  maxCommits: number;
  maxPullRequests: number;
  maxLinesPerSession: number;
  maxLinesPerDollar: number;
  p80LinesAdded: number;
  p80Commits: number;
  p80PullRequests: number;
  p80LinesPerSession: number;
  p90Sessions: number;
  /** population size the baselines were computed over */
  sampleSize: number;
}

export const GUARDS = {
  /** below this many tool events, acceptance-based scores are low-confidence and halved */
  minToolEvents: 20,
  /** below this many sessions, efficiency is low-confidence and halved */
  minSessions: 10,
  /** below this many active days the composite is withheld */
  minActiveDays: 3,
  /** acceptance rate treated as "perfect" for the Trust axis */
  trustCalibration: 0.6,
} as const;

export function toolEvents(i: Pick<ScoringInput, 'toolAccepted' | 'toolRejected'>): number {
  return i.toolAccepted + i.toolRejected;
}

export function acceptanceRate(i: Pick<ScoringInput, 'toolAccepted' | 'toolRejected'>): number | null {
  const events = toolEvents(i);
  return events > 0 ? i.toolAccepted / events : null;
}

export function cacheRatio(i: Pick<ScoringInput, 'inputTokens' | 'cacheReadTokens'>): number | null {
  const denom = i.inputTokens + i.cacheReadTokens;
  return denom > 0 ? i.cacheReadTokens / denom : null;
}

export function linesPerSession(i: Pick<ScoringInput, 'linesAdded' | 'sessions'>): number {
  return i.sessions > 0 ? i.linesAdded / i.sessions : 0;
}

export function linesPerDollar(i: Pick<ScoringInput, 'linesAdded' | 'costCents'>): number {
  const dollars = i.costCents / 100;
  return dollars > 0 ? i.linesAdded / dollars : 0;
}

/** Models contributing >=5% of the user's total tokens. */
export function significantModelCount(modelTokens: Record<string, number>): number {
  const total = Object.values(modelTokens).reduce((a, b) => a + b, 0);
  if (total <= 0) return 0;
  return Object.values(modelTokens).filter((t) => t / total >= 0.05).length;
}

export function computeBaselines(population: ScoringInput[]): Baselines {
  const active = population.filter((u) => u.sessions > 0);
  const max = (f: (u: ScoringInput) => number) => active.reduce((m, u) => Math.max(m, f(u)), 0);
  const values = (f: (u: ScoringInput) => number) => active.map(f);
  return {
    maxSessions: max((u) => u.sessions),
    maxToolEvents: max(toolEvents),
    maxLinesAdded: max((u) => u.linesAdded),
    maxCommits: max((u) => u.commits),
    maxPullRequests: max((u) => u.pullRequests),
    maxLinesPerSession: max(linesPerSession),
    maxLinesPerDollar: max(linesPerDollar),
    p80LinesAdded: percentile(values((u) => u.linesAdded), 80),
    p80Commits: percentile(values((u) => u.commits), 80),
    p80PullRequests: percentile(values((u) => u.pullRequests), 80),
    p80LinesPerSession: percentile(values(linesPerSession), 80),
    p90Sessions: percentile(values((u) => u.sessions), 90),
    sampleSize: active.length,
  };
}

/**
 * The four axis scores + composite.
 *   Adoption   = 0.40·N(sessions) + 0.40·(activeDays/workdays·100) + 0.20·N(toolEvents)
 *   Impact     = 0.40·N(linesAdded) + 0.30·N(commits) + 0.30·N(PRs)
 *   Efficiency = 0.40·N(lines/session) + 0.30·N(lines/$) + 0.30·(cacheRatio·100)
 *   Trust      = clamp(acceptanceRate / 0.60, 0, 1) · 100
 *   Composite  = 0.35·Adoption + 0.35·Impact + 0.15·Efficiency + 0.15·Trust
 */
export function computeAxes(i: ScoringInput, b: Baselines): AxisScores {
  const consistency = i.workdays > 0 ? Math.min(1, i.activeDays / i.workdays) * 100 : 0;
  const adoption =
    0.4 * normalize(i.sessions, b.maxSessions) +
    0.4 * consistency +
    0.2 * normalize(toolEvents(i), b.maxToolEvents);

  // PRs-by-Claude-Code only exist on GitHub (the PR flow uses the gh CLI).
  // In orgs on another git host the org max is 0 forever — redistribute that
  // weight instead of capping everyone's Impact at 70.
  const impactWeights =
    b.maxPullRequests > 0
      ? { lines: 0.4, commits: 0.3, prs: 0.3 }
      : b.maxCommits > 0
        ? { lines: 4 / 7, commits: 3 / 7, prs: 0 }
        : { lines: 1, commits: 0, prs: 0 };
  const impact =
    impactWeights.lines * normalize(i.linesAdded, b.maxLinesAdded) +
    impactWeights.commits * normalize(i.commits, b.maxCommits) +
    impactWeights.prs * normalize(i.pullRequests, b.maxPullRequests);

  const ratio = cacheRatio(i) ?? 0;
  let efficiency =
    0.4 * normalize(linesPerSession(i), b.maxLinesPerSession) +
    0.3 * normalize(linesPerDollar(i), b.maxLinesPerDollar) +
    0.3 * (ratio * 100);
  const efficiencyLowConfidence = i.sessions < GUARDS.minSessions;
  if (efficiencyLowConfidence) efficiency /= 2;

  const rate = acceptanceRate(i);
  let trust = rate === null ? 0 : clamp01(rate / GUARDS.trustCalibration) * 100;
  const trustLowConfidence = toolEvents(i) < GUARDS.minToolEvents;
  if (trustLowConfidence) trust /= 2;

  const composite =
    i.activeDays < GUARDS.minActiveDays
      ? null
      : 0.35 * adoption + 0.35 * impact + 0.15 * efficiency + 0.15 * trust;

  const round1 = (v: number) => Math.round(v * 10) / 10;
  return {
    adoption: round1(adoption),
    impact: round1(impact),
    efficiency: round1(efficiency),
    trust: round1(trust),
    composite: composite === null ? null : round1(composite),
    trustLowConfidence,
    efficiencyLowConfidence,
  };
}

/** Two-axis segmentation, evaluated top-down. */
export function segmentFor(scores: Pick<AxisScores, 'adoption' | 'impact'>): SegmentTier {
  if (scores.adoption >= 70 && scores.impact >= 70) return 'champion';
  if (scores.adoption >= 50 && scores.impact >= 40) return 'producer';
  if (scores.adoption < 20) return 'starter';
  return 'explorer';
}
