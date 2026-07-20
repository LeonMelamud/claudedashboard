import type { DimensionSlice, DimensionsResponse } from '@dash/shared';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context';
import type { DimensionSliceRow } from '../repos/dimensionsRepo';
import { parseRangeQuery } from './shared';

const TOP_WEB_SEARCH_USERS = 5;

/** Drop all-zero slices; '' (API returned null) reads as 'unknown'. */
function toSlices(rows: DimensionSliceRow[]): DimensionSlice[] {
  return rows
    .filter(
      (r) => r.uncached_input_tokens + r.cache_creation_tokens + r.cache_read_tokens + r.output_tokens > 0,
    )
    .map((r) => ({
      key: r.key === '' ? 'unknown' : r.key,
      tokens: {
        input: r.uncached_input_tokens,
        output: r.output_tokens,
        cacheRead: r.cache_read_tokens,
        cacheCreation: r.cache_creation_tokens,
      },
    }));
}

export function registerDimensionRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/dimensions', async (req): Promise<DimensionsResponse> => {
    const q = parseRangeQuery(req.query);
    const { from, to } = q;

    const serviceTier = toSlices(ctx.repos.dimensions.slices(from, to, 'service_tier'));
    const contextWindow = toSlices(ctx.repos.dimensions.slices(from, to, 'context_window'));

    // customer_type mix: sessions + estimated cost merged from two aggregates
    const costByType = new Map(
      ctx.repos.dimensions.customerTypeCost(from, to).map((r) => [r.customer_type, r.cost_cents]),
    );
    const customerType = ctx.repos.dimensions.customerTypeSessions(from, to).map((r) => ({
      key: r.customer_type === '' ? 'unknown' : r.customer_type,
      sessions: r.sessions,
      costCents: costByType.get(r.customer_type) ?? 0,
    }));

    const webSearch = {
      totalRequests: ctx.repos.dimensions.webSearchTotal(from, to),
      topUsers: ctx.repos.dimensions.webSearchTopUsers(from, to, TOP_WEB_SEARCH_USERS).map((r) => ({
        userId: r.user_id,
        name: r.name,
        requests: r.requests,
      })),
    };

    return {
      range: { from, to },
      serviceTier,
      contextWindow,
      customerType,
      webSearch,
      hasData: ctx.repos.dimensions.hasData(from, to),
    };
  });
}
