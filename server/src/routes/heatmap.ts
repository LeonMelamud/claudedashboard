import type { HeatmapResponse } from '@dash/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context';
import { parseRangeQuery, rangeQuerySchema, zodMessage, BadRequestError } from './shared';

const COVERAGE_NOTE =
  'Hourly activity covers OAuth-authenticated Claude Code traffic only; API-key usage has no per-user hourly attribution.';

export function registerHeatmapRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/heatmap', async (req): Promise<HeatmapResponse> => {
    const schema = rangeQuerySchema.extend({
      userId: z.coerce.number().int().positive().optional(),
    });
    const parsed = schema.safeParse(req.query ?? {});
    if (!parsed.success) throw new BadRequestError(zodMessage(parsed.error));
    const q = parseRangeQuery(req.query);

    const rows = ctx.repos.usage.heatmap(q.from, q.to, {
      teamId: q.teamId,
      userId: parsed.data.userId,
    });

    return {
      range: { from: q.from, to: q.to },
      hours: rows.map((r) => ({
        hourUtc: r.hour_utc,
        tokens: r.tokens,
        activeUsers: r.active_users,
      })),
      coverageNote: COVERAGE_NOTE,
    };
  });
}
