import { addDays } from '@dash/shared';
import type { Repos } from '../repos';
import { buildLeaderboardData } from '../services/scoring';
import { todayLocal } from '../util/time';

export const SNAPSHOT_RANGE_KEY = '30d';

/**
 * After a nightly/backfill sync: recompute the 30d leaderboard (same service
 * the API route uses) and upsert today's score snapshot per user-actor.
 * Returns the number of snapshots written.
 */
export function writeSnapshots(repos: Repos): number {
  const to = todayLocal();
  const from = addDays(to, -29);
  const data = buildLeaderboardData(repos, { from, to });

  let written = 0;
  for (const entry of data.entries) {
    if (entry.user.actorType !== 'user') continue;
    const earnedBadgeIds = entry.badges.filter((b) => b.earned).map((b) => b.id);
    repos.sync.upsertSnapshot(
      to,
      entry.user.id,
      SNAPSHOT_RANGE_KEY,
      entry.scores.composite,
      entry.segment,
      earnedBadgeIds,
    );
    written += 1;
  }
  return written;
}
