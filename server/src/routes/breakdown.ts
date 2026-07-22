/**
 * GET /api/breakdown — the "who are the users" drill-down behind any
 * aggregate count. Same range/team query contract as the other analytics
 * endpoints; dimension/entity select an allowlisted per-user query
 * (see repos/breakdownRepo.ts).
 */
import { BREAKDOWN_DIMENSIONS, type BreakdownResponse } from '@dash/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context';
import { BadRequestError, parseRangeQuery, zodMessage } from './shared';

const breakdownQuerySchema = z.object({
  dimension: z.enum(BREAKDOWN_DIMENSIONS),
  entity: z.string().max(500).default(''),
});

export function registerBreakdownRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/breakdown', async (req): Promise<BreakdownResponse> => {
    const parsed = breakdownQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) throw new BadRequestError(zodMessage(parsed.error));
    const { dimension, entity } = parsed.data;
    const q = parseRangeQuery(req.query);

    const { columns, rows } = ctx.repos.breakdown.query(dimension, entity, q.from, q.to, q.teamId);
    return { dimension, entity, range: { from: q.from, to: q.to }, columns, rows };
  });
}
