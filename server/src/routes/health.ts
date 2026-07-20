import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context';

export function registerHealthRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/health', async () => ({
    ok: true,
    demoMode: ctx.env.demoMode,
    lastSync: ctx.repos.sync.dataFreshAt(),
  }));
}
