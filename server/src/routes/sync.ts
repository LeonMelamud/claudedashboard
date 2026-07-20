import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context';
import { BadRequestError, parseBody, zodMessage } from './shared';

const runBodySchema = z.object({
  type: z.enum(['backfill', 'daily', 'hourly', 'roster', 'nightly']),
});

const logsQuerySchema = z.object({
  after: z.coerce.number().int().min(0).default(0),
  runId: z.coerce.number().int().positive().optional(),
});

export function registerSyncRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/sync/status', async () => ctx.syncManager.getStatus());

  app.post('/api/sync/run', async (req, reply) => {
    if (ctx.env.demoMode) return reply.code(400).send({ error: 'demo_mode' });
    const body = parseBody(runBodySchema, req.body);
    const run = ctx.syncManager.tryStart(body.type, 'manual');
    if (!run) return reply.code(409).send({ error: 'sync_busy' });
    return reply.code(202).send({ run });
  });

  // Live log tail: poll with ?after=<seq> to get only newer lines.
  app.get('/api/sync/logs', async (req) => {
    const parsed = logsQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) throw new BadRequestError(zodMessage(parsed.error));
    return ctx.syncLog.since(parsed.data.after, parsed.data.runId);
  });
}
