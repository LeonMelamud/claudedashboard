import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context';
import { getOverview } from '../services/overview';
import { BadRequestError, parseRangeQuery, zodMessage } from './shared';

const granSchema = z.object({ gran: z.enum(['day', 'week', 'month']).optional() });

export function registerOverviewRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/overview', async (req) => {
    const q = parseRangeQuery(req.query);
    const parsed = granSchema.safeParse(req.query ?? {});
    if (!parsed.success) throw new BadRequestError(zodMessage(parsed.error));
    return getOverview(ctx.repos, { from: q.from, to: q.to, teamId: q.teamId, gran: parsed.data.gran });
  });
}
