import { addDays } from '@dash/shared';
import type { AnthropicClient } from '../anthropic/client';
import type { RawMessagesBucket } from '../anthropic/types';
import type { Repos } from '../repos';
import type { ApiKeyUsageUpsertRow } from '../repos/apiKeyRepo';

/** Backfill depth for per-key usage — fixed, no env knob. */
export const API_KEY_USAGE_BACKFILL_DAYS = 90;

/** Nightly re-sync depth. */
export const API_KEY_USAGE_NIGHTLY_DAYS = 3;

const n = (v: number | null | undefined): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/**
 * Sync per-API-key daily token usage for [fromDate, toDate] (inclusive UTC
 * days) from usage_report/messages grouped by api_key_id. Results without an
 * api_key_id (OAuth traffic) are skipped. Rows are upserted
 * ON CONFLICT (date, api_key_id). Returns rows written.
 */
export async function syncApiKeyUsage(
  client: AnthropicClient,
  repos: Repos,
  fromDate: string,
  toDate: string,
): Promise<number> {
  // Aggregate defensively — a (date, key) pair must yield exactly one upsert.
  const byKey = new Map<string, ApiKeyUsageUpsertRow>();
  for await (const buckets of client.paginate<RawMessagesBucket>('/v1/organizations/usage_report/messages', {
    starting_at: `${fromDate}T00:00:00Z`,
    ending_at: `${addDays(toDate, 1)}T00:00:00Z`,
    bucket_width: '1d',
    'group_by[]': 'api_key_id',
    limit: 31,
  })) {
    for (const bucket of buckets) {
      const date = bucket.starting_at.slice(0, 10);
      for (const result of bucket.results ?? []) {
        if (!result.api_key_id) continue; // OAuth traffic has no key attribution
        const mapKey = `${date}|${result.api_key_id}`;
        let row = byKey.get(mapKey);
        if (!row) {
          row = {
            date,
            apiKeyId: result.api_key_id,
            uncachedInputTokens: 0,
            cacheCreationTokens: 0,
            cacheReadTokens: 0,
            outputTokens: 0,
          };
          byKey.set(mapKey, row);
        }
        row.uncachedInputTokens += n(result.uncached_input_tokens);
        row.cacheCreationTokens +=
          n(result.cache_creation?.ephemeral_1h_input_tokens) + n(result.cache_creation?.ephemeral_5m_input_tokens);
        row.cacheReadTokens += n(result.cache_read_input_tokens);
        row.outputTokens += n(result.output_tokens);
      }
    }
  }
  const rows = [...byKey.values()];
  return rows.length > 0 ? repos.apiKeys.upsertDailyUsage(rows) : 0;
}
