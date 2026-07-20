import type { BadgeStatus } from '../types.js';
import { clamp01 } from './normalize.js';
import {
  type Baselines,
  type ScoringInput,
  acceptanceRate,
  cacheRatio,
  linesPerSession,
  significantModelCount,
  toolEvents,
} from './scores.js';
import type { AxisScores } from '../types.js';

const CACHE_MASTER_RATIO = 0.7;
const CACHE_MASTER_MIN_TOKENS = 1_000_000;
const TIME_BADGE_SHARE = 0.3;
const TIME_BADGE_MIN_ACTIVE_DAYS = 10;
const STREAK_TIERS = { streak_bronze: 5, streak_silver: 10, streak_gold: 20 } as const;
const POLYGLOT_MODELS = 3;

const fmt = (n: number) => (Number.isInteger(n) ? n.toLocaleString('en-US') : n.toFixed(1));
const pct = (n: number) => `${Math.round(n * 100)}%`;

/**
 * All 14 badge statuses (earned or not, with 0..1 progress) for one user.
 * Percentile thresholds come from the frozen org-wide baselines; every
 * percentile badge also has an absolute floor so a quiet week can't mint
 * champions.
 */
export function computeBadges(i: ScoringInput, b: Baselines, axes: AxisScores): BadgeStatus[] {
  const badges: BadgeStatus[] = [];
  const add = (id: BadgeStatus['id'], earned: boolean, progress: number, detail: string) =>
    badges.push({ id, earned, progress: earned ? 1 : clamp01(progress), detail });

  // PR Machine: PRs >= p80 AND >= 5. Claude Code's PR flow is GitHub-only —
  // when the whole org has zero PRs the badge is unattainable tooling-wise,
  // so mark it explicitly not-applicable rather than perpetually ghosted.
  {
    if (b.maxPullRequests === 0) {
      add('pr_machine', false, 0, 'Not applicable — no GitHub PR flow in this org');
    } else {
      const threshold = Math.max(b.p80PullRequests, 5);
      add(
        'pr_machine',
        i.pullRequests >= threshold && i.pullRequests >= 5,
        threshold > 0 ? i.pullRequests / threshold : 0,
        `${fmt(i.pullRequests)} / ${fmt(threshold)} PRs`,
      );
    }
  }

  // Ship It: commits >= p80 AND >= 15
  {
    const threshold = Math.max(b.p80Commits, 15);
    add(
      'ship_it',
      i.commits >= threshold,
      threshold > 0 ? i.commits / threshold : 0,
      `${fmt(i.commits)} / ${fmt(threshold)} commits`,
    );
  }

  // Cache Master: cacheRatio >= 0.70 AND (input + cache_read) >= 1M tokens
  {
    const ratio = cacheRatio(i) ?? 0;
    const volume = i.inputTokens + i.cacheReadTokens;
    const earned = ratio >= CACHE_MASTER_RATIO && volume >= CACHE_MASTER_MIN_TOKENS;
    add(
      'cache_master',
      earned,
      Math.min(ratio / CACHE_MASTER_RATIO, volume / CACHE_MASTER_MIN_TOKENS),
      `${pct(ratio)} cache ratio (need ${pct(CACHE_MASTER_RATIO)})`,
    );
  }

  // Night Owl / Early Bird: >=30% of hourly activity in the window, >=10 active
  // days; mutually exclusive — the higher share wins.
  {
    const night = i.nightShare ?? 0;
    const early = i.earlyShare ?? 0;
    const eligible = i.activeDays >= TIME_BADGE_MIN_ACTIVE_DAYS;
    const nightWins = night >= early;
    add(
      'night_owl',
      eligible && night >= TIME_BADGE_SHARE && nightWins,
      eligible ? night / TIME_BADGE_SHARE : 0,
      `${pct(night)} of activity 22:00–05:00`,
    );
    add(
      'early_bird',
      eligible && early >= TIME_BADGE_SHARE && !nightWins,
      eligible ? early / TIME_BADGE_SHARE : 0,
      `${pct(early)} of activity 05:00–09:00`,
    );
  }

  // Streaks (trailing 90d, workdays only)
  for (const [id, need] of Object.entries(STREAK_TIERS) as Array<
    [keyof typeof STREAK_TIERS, number]
  >) {
    add(id, i.currentStreak >= need, i.currentStreak / need, `${i.currentStreak} / ${need} workdays`);
  }

  // Polyglot: >=3 models each with >=5% of personal tokens
  {
    const count = significantModelCount(i.modelTokens);
    add('polyglot', count >= POLYGLOT_MODELS, count / POLYGLOT_MODELS, `${count} / ${POLYGLOT_MODELS} models`);
  }

  // Marathon: sessions >= p90 AND >= 60
  {
    const threshold = Math.max(b.p90Sessions, 60);
    add('marathon', i.sessions >= threshold, threshold > 0 ? i.sessions / threshold : 0, `${fmt(i.sessions)} / ${fmt(threshold)} sessions`);
  }

  // High Output: linesAdded >= p80 (percentile-only, self-calibrating)
  {
    const threshold = b.p80LinesAdded;
    add(
      'high_output',
      threshold > 0 && i.linesAdded >= threshold,
      threshold > 0 ? i.linesAdded / threshold : 0,
      `${fmt(i.linesAdded)} / ${fmt(threshold)} lines`,
    );
  }

  // Efficient: lines/session >= p80 AND sessions >= 10
  {
    const lps = linesPerSession(i);
    const threshold = b.p80LinesPerSession;
    const earned = threshold > 0 && lps >= threshold && i.sessions >= 10;
    add(
      'efficient',
      earned,
      threshold > 0 ? Math.min(lps / threshold, i.sessions / 10) : 0,
      `${fmt(lps)} / ${fmt(threshold)} lines per session`,
    );
  }

  // High Acceptance: rate >= 40% AND >= 20 events (reference rule, verbatim)
  {
    const rate = acceptanceRate(i) ?? 0;
    const events = toolEvents(i);
    add(
      'high_acceptance',
      rate >= 0.4 && events >= 20,
      Math.min(rate / 0.4, events / 20),
      `${pct(rate)} acceptance over ${fmt(events)} decisions`,
    );
  }

  // Experimenting: Adoption >= 60 AND Impact < 40 (positive framing)
  {
    const earned = axes.adoption >= 60 && axes.impact < 40;
    add(
      'experimenting',
      earned,
      earned ? 1 : Math.min(axes.adoption / 60, 1) * (axes.impact < 40 ? 1 : 0),
      `adoption ${axes.adoption}, impact ${axes.impact}`,
    );
  }

  return badges;
}
