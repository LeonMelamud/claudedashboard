import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context';
import { getLeaderboard } from '../services/scoring';
import { parseRangeQuery } from './shared';

export function registerLeaderboardRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/leaderboard', async (req) => {
    const q = parseRangeQuery(req.query);
    return getLeaderboard(ctx.repos, {
      from: q.from,
      to: q.to,
      teamId: q.teamId,
      actorType: q.actorType ?? 'user',
    });
  });
}
