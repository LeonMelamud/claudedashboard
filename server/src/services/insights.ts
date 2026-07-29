import {
  BADGE_CATALOG,
  computeInsightCards,
  daysBetween,
  type BadgeId,
  type InsightCard,
  type InsightUserInput,
  type InsightsResponse,
  type SegmentTier,
} from '@dash/shared';
import type { Repos } from '../repos';
import type { SnapshotRow } from '../repos/syncRepo';
import { toUserDto } from '../repos/userRepo';
import { todayIl } from '../util/time';
import { buildLeaderboardData, sortEntries, type RangeParams } from './scoring';

const ADOPTION_GAP_THRESHOLD = 0.3;
const SNAPSHOT_RANGE_KEY = '30d';

/** Tier order for promotion detection — only upward moves are celebrated. */
const SEGMENT_RANK: Record<SegmentTier, number> = { starter: 0, explorer: 1, producer: 2, champion: 3 };

interface Capability {
  id: string;
  label: string;
  recommendation: string;
  adopted: (m: CapMetrics) => boolean;
  metric: (m: CapMetrics) => number;
}

interface CapMetrics {
  userId: number;
  pullRequests: number;
  commits: number;
  significantModels: number;
  cacheRatio: number;
}

const CAPABILITIES: Capability[] = [
  {
    id: 'prs',
    label: 'PR creation',
    recommendation:
      'Most active users never create pull requests from Claude Code. Share the /pr workflow and let the champions demo how they ship PRs straight from a session.',
    adopted: (m) => m.pullRequests > 0,
    metric: (m) => m.pullRequests,
  },
  {
    id: 'commits',
    label: 'Commit creation',
    recommendation:
      'Few active users let Claude Code commit for them. Encourage committing from the session — it keeps attribution and speeds up the loop.',
    adopted: (m) => m.commits > 0,
    metric: (m) => m.commits,
  },
  {
    id: 'multi_model',
    label: 'Multi-model usage',
    recommendation:
      'Most users stick to one model. Suggest cheaper/faster models for simple tasks and stronger models for hard ones — the champions can share their model-switching habits.',
    adopted: (m) => m.significantModels >= 2,
    metric: (m) => m.significantModels,
  },
  {
    id: 'cache',
    label: 'Prompt caching',
    recommendation:
      'Cache hit rates are low. Longer-lived sessions and context reuse cut cost dramatically — ask the top cache users to share how they structure their sessions.',
    adopted: (m) => m.cacheRatio >= 0.3,
    metric: (m) => m.cacheRatio,
  },
];

export interface InsightsQuery extends RangeParams {
  teamId?: number;
}

export function getInsights(repos: Repos, q: InsightsQuery): InsightsResponse {
  const range = { from: q.from, to: q.to };
  const data = buildLeaderboardData(repos, range);
  const settings = repos.settings.getMerged();
  const today = todayIl();

  // --- composite rank over the org-wide user-actor leaderboard ---
  const rankedEntries = sortEntries(data.entries.filter((e) => e.user.actorType === 'user'));
  const rankByUserId = new Map<number, number>();
  let rank = 0;
  for (const entry of rankedEntries) {
    if (entry.scores.composite === null) continue;
    rank += 1;
    rankByUserId.set(entry.user.id, rank);
  }

  // --- snapshot diff (two most recent snapshot dates) ---
  const snapshotDates = repos.sync.latestSnapshotDates(SNAPSHOT_RANGE_KEY, 2);
  const latestDate = snapshotDates[0];
  const prevDate = snapshotDates[1];
  const latestSnaps: Map<number, SnapshotRow> = latestDate
    ? repos.sync.snapshotsForDate(latestDate, SNAPSHOT_RANGE_KEY)
    : new Map<number, SnapshotRow>();
  const prevSnaps: Map<number, SnapshotRow> = prevDate
    ? repos.sync.snapshotsForDate(prevDate, SNAPSHOT_RANGE_KEY)
    : new Map<number, SnapshotRow>();

  const diffForUser = (userId: number): { newBadges: string[]; newSegment: SegmentTier | null } => {
    const latest = latestSnaps.get(userId);
    const prev = prevSnaps.get(userId);
    if (!latest || !prev) return { newBadges: [], newSegment: null };
    let latestBadges: string[] = [];
    let prevBadges: string[] = [];
    try {
      latestBadges = JSON.parse(latest.badges_json) as string[];
      prevBadges = JSON.parse(prev.badges_json) as string[];
    } catch {
      return { newBadges: [], newSegment: null };
    }
    const prevSet = new Set(prevBadges);
    const newBadges = latestBadges
      .filter((id) => !prevSet.has(id))
      .map((id) => BADGE_CATALOG[id as BadgeId]?.name ?? id);
    const newSegment =
      latest.segment &&
      prev.segment &&
      SEGMENT_RANK[latest.segment as SegmentTier] > SEGMENT_RANK[prev.segment as SegmentTier]
        ? (latest.segment as SegmentTier)
        : null;
    return { newBadges, newSegment };
  };

  // --- per-user inputs for the shared rule engine ---
  const scopeUsers = data.userRows.filter(
    (u) => u.actor_type === 'user' && (q.teamId === undefined || u.team_id === q.teamId),
  );

  const userInputs: InsightUserInput[] = scopeUsers.map((row) => {
    const entry = data.entryByUserId.get(row.id);
    const input = data.inputByUserId.get(row.id);
    const s14 = data.sessions14ByUserId.get(row.id);
    const lastActive = data.lastActiveByUserId.get(row.id) ?? null;
    const diff = diffForUser(row.id);
    return {
      userId: row.id,
      name: row.name,
      inRoster: row.in_roster === 1,
      addedAt: row.added_at,
      teamId: row.team_id,
      sessionsLast14: s14?.last14 ?? 0,
      sessionsPrior14: s14?.prior14 ?? 0,
      sessions: input?.sessions ?? 0,
      toolAccepted: input?.toolAccepted ?? 0,
      toolRejected: input?.toolRejected ?? 0,
      inputTokens: input?.inputTokens ?? 0,
      cacheReadTokens: input?.cacheReadTokens ?? 0,
      costCents: input?.costCents ?? 0,
      lastActiveDate: lastActive,
      daysIdle: lastActive ? Math.max(0, daysBetween(lastActive, today)) : null,
      newBadges: diff.newBadges,
      newSegment: diff.newSegment,
      compositeRank: entry ? (rankByUserId.get(row.id) ?? null) : null,
    };
  });

  const cards: InsightCard[] = computeInsightCards(userInputs, settings, {
    teamId: q.teamId ?? null,
  });

  // --- org-level adoption-gap cards ---
  const activeEntries = data.entries.filter(
    (e) =>
      e.user.actorType === 'user' &&
      e.metrics.sessions > 0 &&
      (q.teamId === undefined || e.user.teamId === q.teamId),
  );
  if (activeEntries.length > 0) {
    const capMetrics: CapMetrics[] = activeEntries.map((e) => ({
      userId: e.user.id,
      pullRequests: e.metrics.pullRequests,
      commits: e.metrics.commits,
      significantModels: e.metrics.significantModels,
      cacheRatio: e.metrics.cacheRatio ?? 0,
    }));
    // Claude Code's PR flow is GitHub-only — in an org that doesn't use
    // GitHub, nobody ORG-WIDE (not just in the team scope) creates a PR in
    // range, so the PR-creation gap card would be unactionable noise.
    const orgHasPrs = data.entries.some(
      (e) => e.user.actorType === 'user' && e.metrics.pullRequests > 0,
    );
    for (const cap of CAPABILITIES) {
      if (cap.id === 'prs' && !orgHasPrs) continue;
      const adopters = capMetrics.filter((m) => cap.adopted(m));
      const share = adopters.length / capMetrics.length;
      if (share >= ADOPTION_GAP_THRESHOLD) continue;
      const champions = [...capMetrics]
        .filter((m) => cap.metric(m) > 0)
        .sort((a, b) => cap.metric(b) - cap.metric(a))
        .slice(0, 5)
        .map((m) => m.userId);
      cards.push({
        id: `adoption-gap-${cap.id}`,
        kind: 'adoption_gap',
        severity: 'info',
        title: `${cap.label} is used by only ${Math.round(share * 100)}%`,
        body: cap.recommendation,
        userIds: [],
        championUserIds: champions,
        teamId: q.teamId ?? null,
      });
    }
  }

  // --- non-adopters: rostered user-actors with zero sessions in range ---
  const nonAdopters = scopeUsers
    .filter((row) => {
      if (row.in_roster !== 1) return false;
      const input = data.inputByUserId.get(row.id);
      return (input?.sessions ?? 0) === 0;
    })
    .map((row) => {
      const lastActive = data.lastActiveByUserId.get(row.id) ?? null;
      return {
        user: toUserDto(row),
        daysIdle: lastActive ? Math.max(0, daysBetween(lastActive, today)) : null,
        lastActiveDate: lastActive,
      };
    })
    .sort((a, b) => {
      // never-active first, then longest idle
      if (a.daysIdle === null && b.daysIdle === null) return a.user.name.localeCompare(b.user.name);
      if (a.daysIdle === null) return -1;
      if (b.daysIdle === null) return 1;
      return b.daysIdle - a.daysIdle;
    });

  return { range, cards, nonAdopters };
}
