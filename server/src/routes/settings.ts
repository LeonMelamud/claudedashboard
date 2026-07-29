import type { AppSettings } from '@dash/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context';
import { parseBody } from './shared';

// displayTimezone is deliberately absent: the zone comes from ORG_TIMEZONE, and
// an editable copy that nothing honoured is worse than no field at all.
const settingsPatchSchema = z.object({
  linesPerMinute: z.number().positive().optional(),
  hourlyRateUsd: z.number().nonnegative().optional(),
  seatCostUsdMonthly: z.number().nonnegative().optional(),
  inactiveDays: z.number().int().positive().optional(),
  decliningPct: z.number().min(0).max(100).optional(),
});

export function registerSettingsRoutes(app: FastifyInstance, ctx: AppContext): void {
  /** The stored settings, with the zone overridden by ORG_TIMEZONE. */
  const merged = (stored: AppSettings): AppSettings => ({ ...stored, displayTimezone: ctx.env.orgTimezone });

  app.get('/api/settings', async (): Promise<AppSettings> => merged(ctx.repos.settings.getMerged()));

  app.put('/api/settings', async (req): Promise<AppSettings> => {
    const patch = parseBody(settingsPatchSchema, req.body);
    return merged(ctx.repos.settings.setMany(patch));
  });
}
