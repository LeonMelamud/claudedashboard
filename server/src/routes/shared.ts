import { addDays, type ActorType } from '@dash/shared';
import { z } from 'zod';
import { todayLocal } from '../util/time';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Real calendar date check: format AND round-trips through Date. */
const isValidDate = (s: string): boolean => {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

/** Thrown by parsing helpers; the app error handler maps it to 400 JSON. */
export class BadRequestError extends Error {}

const dateSchema = z.string().refine(isValidDate, 'expected a valid YYYY-MM-DD date');

export const rangeQuerySchema = z.object({
  from: dateSchema.optional(),
  to: dateSchema.optional(),
  teamId: z.coerce.number().int().positive().optional(),
  actorType: z.enum(['user', 'api_key', 'all']).optional(),
});

export interface ParsedRangeQuery {
  from: string;
  to: string;
  teamId?: number;
  actorType?: ActorType | 'all';
}

export function zodMessage(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
}

/** from/to default to the last 30 days ending today (org-local day). */
export function parseRangeQuery(query: unknown): ParsedRangeQuery {
  const parsed = rangeQuerySchema.safeParse(query ?? {});
  if (!parsed.success) throw new BadRequestError(zodMessage(parsed.error));
  const to = parsed.data.to ?? todayLocal();
  const from = parsed.data.from ?? addDays(to, -29);
  if (from > to) throw new BadRequestError('from must be <= to');
  const out: ParsedRangeQuery = { from, to };
  if (parsed.data.teamId !== undefined) out.teamId = parsed.data.teamId;
  if (parsed.data.actorType !== undefined) out.actorType = parsed.data.actorType;
  return out;
}

export function parseBody<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) throw new BadRequestError(zodMessage(parsed.error));
  return parsed.data as z.infer<T>;
}
