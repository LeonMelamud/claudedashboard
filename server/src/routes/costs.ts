import { addDays, type CostType, type CostsResponse } from '@dash/shared';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context';
import { parseRangeQuery } from './shared';

const KNOWN_COST_TYPES = new Set<string>(['tokens', 'web_search', 'code_execution', 'session_usage', 'other']);

/** Unknown upstream cost types collapse into 'other' so the union stays closed. */
const asCostType = (raw: string): CostType => (KNOWN_COST_TYPES.has(raw) ? (raw as CostType) : 'other');

export function registerCostRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/costs', async (req): Promise<CostsResponse> => {
    const q = parseRangeQuery(req.query);
    const { from, to } = q;

    // --- actual daily spend split by cost type ---
    const typeRows = ctx.repos.cost.dailyByType(from, to);
    const byDate = new Map<string, { byCostType: Partial<Record<CostType, number>>; totalCents: number }>();
    let actualTotal = 0;
    let webSearchCents = 0;
    let codeExecutionCents = 0;
    for (const row of typeRows) {
      let entry = byDate.get(row.date);
      if (!entry) {
        entry = { byCostType: {}, totalCents: 0 };
        byDate.set(row.date, entry);
      }
      const type = asCostType(row.cost_type);
      entry.byCostType[type] = (entry.byCostType[type] ?? 0) + row.amount_cents;
      entry.totalCents += row.amount_cents;
      actualTotal += row.amount_cents;
      if (type === 'web_search') webSearchCents += row.amount_cents;
      if (type === 'code_execution') codeExecutionCents += row.amount_cents;
    }
    const actualDaily = [...byDate.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([date, entry]) => ({ date, byCostType: entry.byCostType, totalCents: entry.totalCents }));

    // --- estimated (claude_code model estimates, ALL actors) vs actual ---
    const estimatedByDate = new Map(ctx.repos.usage.dailyCost(from, to).map((r) => [r.date, r.cost_cents]));
    let estimatedTotal = 0;
    const estimatedVsActual: CostsResponse['estimatedVsActual'] = [];
    for (let date = from; date <= to; date = addDays(date, 1)) {
      const estimatedCents = estimatedByDate.get(date) ?? 0;
      estimatedTotal += estimatedCents;
      estimatedVsActual.push({ date, estimatedCents, actualCents: byDate.get(date)?.totalCents ?? 0 });
    }

    // --- workspace / model breakdowns ---
    const byWorkspace = ctx.repos.cost.byWorkspace(from, to).map((r) => ({
      workspaceId: r.workspace_id === '' ? null : r.workspace_id,
      workspaceName: r.workspace_id === '' ? 'Default workspace' : (r.workspace_name ?? r.workspace_id),
      totalCents: r.amount_cents,
    }));
    const byModel = ctx.repos.cost.byModel(from, to).map((r) => ({ model: r.model, totalCents: r.amount_cents }));

    return {
      range: { from, to },
      actualDaily,
      estimatedVsActual,
      byWorkspace,
      byModel,
      totals: {
        actualCents: actualTotal,
        estimatedCents: estimatedTotal,
        webSearchCents,
        codeExecutionCents,
      },
      hasData: ctx.repos.cost.hasData(from, to),
    };
  });
}
