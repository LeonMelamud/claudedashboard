import type { AppSettings } from '@dash/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context';
import { parseBody } from './shared';

const settingsPatchSchema = z.object({
  displayTimezone: z.string().trim().min(1).optional(),
  linesPerMinute: z.number().positive().optional(),
  hourlyRateUsd: z.number().nonnegative().optional(),
  seatCostUsdMonthly: z.number().nonnegative().optional(),
  inactiveDays: z.number().int().positive().optional(),
  decliningPct: z.number().min(0).max(100).optional(),
});

export function registerSettingsRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/settings', async (): Promise<AppSettings> => ctx.repos.settings.getMerged());

  app.put('/api/settings', async (req): Promise<AppSettings> => {
    const patch = parseBody(settingsPatchSchema, req.body);
    return ctx.repos.settings.setMany(patch);
  });
}
