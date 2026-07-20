import { addDays } from '@dash/shared';
import type { AnthropicClient } from '../anthropic/client';
import type { RawMessagesBucket } from '../anthropic/types';
import type { Repos } from '../repos';
import type { DimensionUpsertRow } from '../repos/dimensionsRepo';

/** Backfill depth for dimension slices — fixed, no env knob. */
export const DIMENSIONS_BACKFILL_DAYS = 90;

/** Nightly re-sync depth. */
export const DIMENSIONS_NIGHTLY_DAYS = 3;

const n = (v: number | null | undefined): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/**
 * Sync daily service_tier × context_window token slices for
 * [fromDate, toDate] (inclusive UTC days) from usage_report/messages.
 * Null tier/window map to '' (NULL breaks the UNIQUE constraint). Rows are
 * upserted ON CONFLICT (date, service_tier, context_window).
 * Returns rows written.
 */
export async function syncDimensions(
  client: AnthropicClient,
  repos: Repos,
  fromDate: string,
  toDate: string,
): Promise<number> {
  // Aggregate defensively — one upsert per (date, tier, window).
  const bySlice = new Map<string, DimensionUpsertRow>();
  for await (const buckets of client.paginate<RawMessagesBucket>('/v1/organizations/usage_report/messages', {
    starting_at: `${fromDate}T00:00:00Z`,
    ending_at: `${addDays(toDate, 1)}T00:00:00Z`,
    bucket_width: '1d',
    'group_by[]': ['service_tier', 'context_window'],
    limit: 31,
  })) {
    for (const bucket of buckets) {
      const date = bucket.starting_at.slice(0, 10);
      for (const result of bucket.results ?? []) {
        const serviceTier = result.service_tier ?? '';
        const contextWindow = result.context_window ?? '';
        const mapKey = `${date}|${serviceTier}|${contextWindow}`;
        let row = bySlice.get(mapKey);
        if (!row) {
          row = {
            date,
            serviceTier,
            contextWindow,
            uncachedInputTokens: 0,
            cacheCreationTokens: 0,
            cacheReadTokens: 0,
            outputTokens: 0,
          };
          bySlice.set(mapKey, row);
        }
        row.uncachedInputTokens += n(result.uncached_input_tokens);
        row.cacheCreationTokens +=
          n(result.cache_creation?.ephemeral_1h_input_tokens) + n(result.cache_creation?.ephemeral_5m_input_tokens);
        row.cacheReadTokens += n(result.cache_read_input_tokens);
        row.outputTokens += n(result.output_tokens);
      }
    }
  }
  const rows = [...bySlice.values()];
  return rows.length > 0 ? repos.dimensions.upsertDaily(rows) : 0;
}
