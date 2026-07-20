import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context';
import { getInsights } from '../services/insights';
import { parseRangeQuery } from './shared';

export function registerInsightRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/insights', async (req) => {
    const q = parseRangeQuery(req.query);
    return getInsights(ctx.repos, { from: q.from, to: q.to, teamId: q.teamId });
  });
}
