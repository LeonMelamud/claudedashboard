import type { AppSettings, InsightCard, SegmentTier } from '../types.js';

/**
 * Rule-based insight cards for team/org views. Pure functions over
 * pre-aggregated inputs; the server assembles the inputs and renders these
 * into InsightsResponse. Positive cards always sort first.
 */

export interface InsightUserInput {
  userId: number;
  name: string;
  inRoster: boolean;
  addedAt: string | null; // ISO
  teamId: number | null;
  /** sessions in the current 14d window vs the prior 14d window */
  sessionsLast14: number;
  sessionsPrior14: number;
  /** whole selected range */
  sessions: number;
  toolAccepted: number;
  toolRejected: number;
  inputTokens: number;
  cacheReadTokens: number;
  costCents: number;
  lastActiveDate: string | null;
  daysIdle: number | null; // null = never active
  /** newly earned since previous snapshot (server-diffed) */
  newBadges: string[];
  newSegment: SegmentTier | null;
  /** composite rank in org, 1-based, for champion picking */
  compositeRank: number | null;
}

const CACHE_LEAK_RATIO = 0.3;
const CACHE_LEAK_MIN_TOKENS = 500_000;
const LOW_ACCEPTANCE_RATE = 0.25;
const LOW_ACCEPTANCE_MIN_EVENTS = 20;
const NEVER_ACTIVATED_DAYS = 14;
const DECLINING_MIN_PRIOR = 10;

const severityOrder = { positive: 0, warn: 1, info: 2 } as const;

export function computeInsightCards(
  users: InsightUserInput[],
  settings: Pick<AppSettings, 'inactiveDays' | 'decliningPct'>,
  scope: { teamId: number | null },
): InsightCard[] {
  const cards: InsightCard[] = [];
  const champions = users
    .filter((u) => u.compositeRank !== null)
    .sort((a, b) => (a.compositeRank! - b.compositeRank!))
    .slice(0, 5)
    .map((u) => u.userId);

  for (const u of users) {
    if (!u.inRoster) continue;

    // Celebrate — always first
    if (u.newSegment === 'champion' || u.newSegment === 'producer') {
      cards.push({
        id: `celebrate-tier-${u.userId}`,
        kind: 'celebrate',
        severity: 'positive',
        title: `🏆 ${u.name} reached ${u.newSegment === 'champion' ? 'Champion' : 'Producer'}`,
        body: 'Tier promotion this week — worth a shout-out.',
        userIds: [u.userId],
        championUserIds: [],
        teamId: scope.teamId,
      });
    } else if (u.newBadges.length > 0) {
      cards.push({
        id: `celebrate-badge-${u.userId}`,
        kind: 'celebrate',
        severity: 'positive',
        title: `🎉 ${u.name} earned ${u.newBadges.length === 1 ? 'a new badge' : `${u.newBadges.length} new badges`}`,
        body: u.newBadges.join(', '),
        userIds: [u.userId],
        championUserIds: [],
        teamId: scope.teamId,
      });
    }

    // Never activated
    const addedDaysAgo = u.addedAt
      ? Math.floor((Date.now() - new Date(u.addedAt).getTime()) / 86_400_000)
      : null;
    if (u.daysIdle === null && addedDaysAgo !== null && addedDaysAgo >= NEVER_ACTIVATED_DAYS) {
      cards.push({
        id: `never-${u.userId}`,
        kind: 'never_activated',
        severity: 'warn',
        title: `${u.name} never activated Claude Code`,
        body: `On the roster for ${addedDaysAgo} days with zero sessions — pair them with a champion for a first session.`,
        userIds: [u.userId],
        championUserIds: champions,
        teamId: scope.teamId,
      });
      continue; // don't also flag as inactive
    }

    // Inactive
    if (u.daysIdle !== null && u.daysIdle >= settings.inactiveDays) {
      cards.push({
        id: `inactive-${u.userId}`,
        kind: 'inactive',
        severity: 'warn',
        title: `${u.name} has been inactive ${u.daysIdle} days`,
        body: 'Worth a check-in? Their last session is getting stale.',
        userIds: [u.userId],
        championUserIds: [],
        teamId: scope.teamId,
      });
    }

    // Declining
    if (
      u.sessionsPrior14 >= DECLINING_MIN_PRIOR &&
      u.sessionsLast14 < u.sessionsPrior14 * (1 - settings.decliningPct / 100)
    ) {
      const dropPct = Math.round((1 - u.sessionsLast14 / u.sessionsPrior14) * 100);
      cards.push({
        id: `declining-${u.userId}`,
        kind: 'declining',
        severity: 'info',
        title: `${u.name}'s usage is down ${dropPct}%`,
        body: `${u.sessionsLast14} sessions in the last two weeks vs ${u.sessionsPrior14} before — did something get in the way?`,
        userIds: [u.userId],
        championUserIds: [],
        teamId: scope.teamId,
      });
    }

    // Low acceptance
    const events = u.toolAccepted + u.toolRejected;
    if (events >= LOW_ACCEPTANCE_MIN_EVENTS && u.toolAccepted / events < LOW_ACCEPTANCE_RATE) {
      cards.push({
        id: `low-accept-${u.userId}`,
        kind: 'low_acceptance',
        severity: 'info',
        title: `${u.name} accepts only ${Math.round((u.toolAccepted / events) * 100)}% of edits`,
        body: 'Low acceptance often means overly broad prompts — worth sharing the prompting guide.',
        userIds: [u.userId],
        championUserIds: champions,
        teamId: scope.teamId,
      });
    }

    // Cache leak
    const tokenVolume = u.inputTokens + u.cacheReadTokens;
    if (tokenVolume >= CACHE_LEAK_MIN_TOKENS) {
      const ratio = u.cacheReadTokens / tokenVolume;
      if (ratio < CACHE_LEAK_RATIO) {
        // rough recoverable estimate: cache reads cost ~10% of fresh input;
        // moving to a 70% ratio would re-price that share of input volume
        const recoverableCents = u.costCents * 0.25;
        cards.push({
          id: `cache-leak-${u.userId}`,
          kind: 'cache_leak',
          severity: 'info',
          title: `${u.name} barely uses the prompt cache (${Math.round(ratio * 100)}%)`,
          body: `Roughly $${(recoverableCents / 100).toFixed(0)} of this period's spend could be recoverable with longer-lived sessions and context reuse.`,
          userIds: [u.userId],
          championUserIds: [],
          teamId: scope.teamId,
        });
      }
    }
  }

  return cards.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
}
