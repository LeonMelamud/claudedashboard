import { resolveTargets, type AppSettings } from '@dash/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context';
import { parseBody } from './shared';

const targetNum = z.number().positive().finite();

// displayTimezone is deliberately absent: the zone comes from ORG_TIMEZONE, and
// an editable copy that nothing honoured is worse than no field at all.
const settingsPatchSchema = z.object({
  linesPerMinute: z.number().positive().optional(),
  hourlyRateUsd: z.number().nonnegative().optional(),
  seatCostUsdMonthly: z.number().nonnegative().optional(),
  inactiveDays: z.number().int().positive().optional(),
  decliningPct: z.number().min(0).max(100).optional(),
  // partial: unspecified targets keep their current value (deep-merged below)
  scoreTargets: z
    .object({
      perWorkday: z
        .object({
          sessions: targetNum,
          toolEvents: targetNum,
          linesAdded: targetNum,
          commits: targetNum,
          pullRequests: targetNum,
        })
        .partial()
        .optional(),
      flat: z
        .object({ linesPerSession: targetNum, linesPerDollar: targetNum })
        .partial()
        .optional(),
    })
    .optional(),
});

export function registerSettingsRoutes(app: FastifyInstance, ctx: AppContext): void {
  /** The stored settings, with the zone overridden by ORG_TIMEZONE. */
  const merged = (stored: AppSettings): AppSettings => ({ ...stored, displayTimezone: ctx.env.orgTimezone });

  app.get('/api/settings', async (): Promise<AppSettings> => merged(ctx.repos.settings.getMerged()));

  app.put('/api/settings', async (req): Promise<AppSettings> => {
    const patch = parseBody(settingsPatchSchema, req.body);
    if (patch.scoreTargets !== undefined) {
      // deep-merge the partial over what's currently effective, then store the
      // full resolved object — a stored value is always complete and valid
      const current = ctx.repos.settings.getMerged().scoreTargets;
      const overCurrent = {
        perWorkday: { ...current.perWorkday, ...patch.scoreTargets.perWorkday },
        flat: { ...current.flat, ...patch.scoreTargets.flat },
      };
      patch.scoreTargets = resolveTargets(overCurrent);
    }
    return merged(ctx.repos.settings.setMany(patch as Partial<AppSettings>));
  });
}
