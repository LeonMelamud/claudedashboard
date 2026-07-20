import { addDays } from '@dash/shared';
import type { AnthropicClient } from '../anthropic/client';
import type { RawCostBucket } from '../anthropic/types';
import type { Repos } from '../repos';
import type { CostInsertRow } from '../repos/costRepo';

/** cost_report supports at most 31 1d-buckets per request window. */
const WINDOW_DAYS = 31;

/** Nightly re-fetch depth: invoices can restate a few days back. */
export const COST_NIGHTLY_DAYS = 7;

/** Backfill fallback when no earliest usage date was ever discovered. */
export const COST_BACKFILL_FALLBACK_DAYS = 90;

/**
 * Sync invoice-grade cost line items for [fromDate, toDate] (inclusive UTC
 * days) from GET /v1/organizations/cost_report, grouped by workspace_id +
 * description, in 31-day windows (+ page pagination within each window).
 * `amount` is a decimal STRING denominated in cents — parsed with Number().
 * Idempotent: every covered date is DELETEd then re-inserted in one
 * transaction per window. Returns line items written.
 */
export async function syncCostReport(
  client: AnthropicClient,
  repos: Repos,
  fromDate: string,
  toDate: string,
): Promise<number> {
  let written = 0;
  for (let windowStart = fromDate; windowStart <= toDate; windowStart = addDays(windowStart, WINDOW_DAYS)) {
    const windowEndExclusive =
      addDays(windowStart, WINDOW_DAYS) < addDays(toDate, 1) ? addDays(windowStart, WINDOW_DAYS) : addDays(toDate, 1);

    const rows: CostInsertRow[] = [];
    for await (const buckets of client.paginate<RawCostBucket>('/v1/organizations/cost_report', {
      starting_at: `${windowStart}T00:00:00Z`,
      ending_at: `${windowEndExclusive}T00:00:00Z`,
      bucket_width: '1d',
      'group_by[]': ['workspace_id', 'description'],
      limit: WINDOW_DAYS,
    })) {
      for (const bucket of buckets) {
        const date = bucket.starting_at.slice(0, 10);
        for (const result of bucket.results ?? []) {
          const amountCents = Number(result.amount ?? '0'); // decimal string in cents
          if (!Number.isFinite(amountCents)) continue;
          rows.push({
            date,
            workspaceId: result.workspace_id ?? '', // '' = default workspace (NULL breaks UNIQUE)
            costType: result.cost_type ?? 'other',
            tokenType: result.token_type ?? '',
            model: result.model ?? '',
            serviceTier: result.service_tier ?? '',
            contextWindow: result.context_window ?? '',
            description: result.description ?? '',
            amountCents,
            currency: result.currency ?? 'USD',
          });
        }
      }
    }

    const coveredDates: string[] = [];
    for (let date = windowStart; date < windowEndExclusive; date = addDays(date, 1)) {
      coveredDates.push(date);
    }
    written += repos.cost.replaceDates(coveredDates, rows);
  }
  return written;
}
