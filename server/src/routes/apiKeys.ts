import type { ApiKeyRow, ApiKeysResponse } from '@dash/shared';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context';
import { parseRangeQuery } from './shared';

export function registerApiKeyRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/api-keys', async (req): Promise<ApiKeysResponse> => {
    const q = parseRangeQuery(req.query);
    const rows = ctx.repos.apiKeys.inventoryWithUsage(q.from, q.to);

    const totalOf = (r: (typeof rows)[number]): number =>
      r.input_tokens + r.output_tokens + r.cache_read_tokens + r.cache_creation_tokens;
    const grandTotal = rows.reduce((sum, r) => sum + totalOf(r), 0);

    const keys: ApiKeyRow[] = rows.map((r) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      createdAt: r.created_at,
      createdByName: r.created_by_name,
      workspaceName: r.workspace_name,
      partialKeyHint: r.partial_key_hint,
      tokens: {
        input: r.input_tokens,
        output: r.output_tokens,
        cacheRead: r.cache_read_tokens,
        cacheCreation: r.cache_creation_tokens,
      },
      tokenShare: grandTotal > 0 ? totalOf(r) / grandTotal : 0,
      lastActiveDate: r.last_active_date,
    }));

    return { range: { from: q.from, to: q.to }, keys };
  });
}
