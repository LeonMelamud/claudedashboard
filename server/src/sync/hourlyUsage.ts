import type { AnthropicClient } from '../anthropic/client';
import type { RawMessagesBucket } from '../anthropic/types';
import type { Repos } from '../repos';
import type { HourlyUpsertRow } from '../repos/usageRepo';
import { hourIsoOf, truncToHourIso } from '../util/time';
import type { ActorResolver } from './actors';

const WINDOW_MS = 7 * 24 * 3_600_000;
const n = (v: number | null | undefined): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/**
 * Sync hourly token buckets (messages usage report, grouped by account_id)
 * for [fromMs, toMs). Requests are chunked into 7-day windows. Rows are
 * upserted ON CONFLICT (user_id, hour_utc). Returns rows written.
 */
export async function syncHourlyRange(
  client: AnthropicClient,
  repos: Repos,
  resolver: ActorResolver,
  fromMs: number,
  toMs: number,
): Promise<number> {
  let written = 0;
  for (let windowStart = fromMs; windowStart < toMs; windowStart += WINDOW_MS) {
    const windowEnd = Math.min(windowStart + WINDOW_MS, toMs);
    const rows: HourlyUpsertRow[] = [];
    for await (const buckets of client.paginate<RawMessagesBucket>(
      '/v1/organizations/usage_report/messages',
      {
        starting_at: new Date(windowStart).toISOString(),
        ending_at: new Date(windowEnd).toISOString(),
        bucket_width: '1h',
        'group_by[]': 'account_id',
        limit: 168,
      },
    )) {
      for (const bucket of buckets) {
        const hourUtc = truncToHourIso(bucket.starting_at);
        for (const result of bucket.results ?? []) {
          if (!result.account_id) continue; // API-key traffic has no account attribution
          const userId = resolver.resolveAccountId(result.account_id);
          rows.push({
            userId,
            hourUtc,
            uncachedInputTokens: n(result.uncached_input_tokens),
            cacheCreationTokens:
              n(result.cache_creation?.ephemeral_1h_input_tokens) +
              n(result.cache_creation?.ephemeral_5m_input_tokens),
            cacheReadTokens: n(result.cache_read_input_tokens),
            outputTokens: n(result.output_tokens),
            webSearchRequests: n(result.server_tool_use?.web_search_requests),
          });
        }
      }
    }
    if (rows.length > 0) written += repos.usage.upsertHourly(rows);
  }
  return written;
}

const HOURLY_WATERMARK_KEY = 'hourly_watermark';
const REWIND_MS = 3 * 3_600_000;

/**
 * Tail sync: from watermark−3h to now; when no watermark exists yet, backfill
 * the configured number of days. Advances the watermark on success.
 */
export async function syncHourlyTail(
  client: AnthropicClient,
  repos: Repos,
  resolver: ActorResolver,
  hourlyBackfillDays: number,
): Promise<number> {
  const now = Date.now();
  const watermark = repos.sync.getState(HOURLY_WATERMARK_KEY);
  let fromMs: number;
  if (watermark) {
    const parsed = Date.parse(watermark);
    fromMs = Number.isFinite(parsed) ? parsed - REWIND_MS : now - hourlyBackfillDays * 24 * 3_600_000;
  } else {
    fromMs = now - hourlyBackfillDays * 24 * 3_600_000;
  }
  // align to hour boundaries
  const fromHour = Date.parse(hourIsoOf(new Date(fromMs)));
  const written = await syncHourlyRange(client, repos, resolver, fromHour, now);
  repos.sync.setState(HOURLY_WATERMARK_KEY, hourIsoOf(new Date(now)));
  return written;
}
