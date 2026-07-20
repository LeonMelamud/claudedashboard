import type { AnthropicClient } from '../anthropic/client';
import type { RawClaudeCodeRecord } from '../anthropic/types';
import type { Repos } from '../repos';
import type { DailyInsertRow } from '../repos/usageRepo';
import type { ActorResolver } from './actors';

const n = (v: number | null | undefined): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

interface Accumulator {
  row: DailyInsertRow;
  modelsByName: Map<string, DailyInsertRow['models'][number]>;
  raw: RawClaudeCodeRecord[];
}

/**
 * Sync one UTC day of the claude_code usage report.
 * Fetches all pages first (async), then writes the whole day in ONE
 * transaction: DELETE existing rows (model children cascade), insert fresh
 * rows + model breakdowns, and widen users' first/last_seen dates.
 * Returns the number of usage_daily rows written.
 */
export async function syncDay(
  client: AnthropicClient,
  repos: Repos,
  resolver: ActorResolver,
  date: string,
): Promise<number> {
  const records: RawClaudeCodeRecord[] = [];
  for await (const page of client.paginate<RawClaudeCodeRecord>(
    '/v1/organizations/usage_report/claude_code',
    { starting_at: date, limit: 1000 },
  )) {
    records.push(...page);
  }

  // Aggregate by (user, terminal, customer) — merge any duplicate records.
  const byKey = new Map<string, Accumulator>();
  // Program tier per user seen this day (customer_type + subscription plan).
  const tierByUser = new Map<number, { customerType: string; subscriptionType: string | null }>();
  for (const record of records) {
    const recordDate = record.date ? record.date.slice(0, 10) : date;
    if (recordDate !== date) continue; // defensive: only this day belongs here
    const userId = resolver.resolveDailyActor(record.actor);
    if (userId === null) continue;

    const terminalType = record.terminal_type ?? '';
    const customerType = record.customer_type ?? '';
    if (customerType !== '') {
      tierByUser.set(userId, { customerType, subscriptionType: record.subscription_type ?? null });
    }
    const key = `${userId}|${terminalType}|${customerType}`;

    let acc = byKey.get(key);
    if (!acc) {
      acc = {
        row: {
          date,
          userId,
          terminalType,
          customerType,
          numSessions: 0,
          linesAdded: 0,
          linesRemoved: 0,
          commits: 0,
          pullRequests: 0,
          editAccepted: 0,
          editRejected: 0,
          multiEditAccepted: 0,
          multiEditRejected: 0,
          writeAccepted: 0,
          writeRejected: 0,
          notebookAccepted: 0,
          notebookRejected: 0,
          rawJson: '',
          models: [],
        },
        modelsByName: new Map(),
        raw: [],
      };
      byKey.set(key, acc);
    }

    const core = record.core_metrics;
    acc.row.numSessions += n(core?.num_sessions);
    acc.row.linesAdded += n(core?.lines_of_code?.added);
    acc.row.linesRemoved += n(core?.lines_of_code?.removed);
    acc.row.commits += n(core?.commits_by_claude_code);
    acc.row.pullRequests += n(core?.pull_requests_by_claude_code);

    const tools = record.tool_actions;
    acc.row.editAccepted += n(tools?.edit_tool?.accepted);
    acc.row.editRejected += n(tools?.edit_tool?.rejected);
    acc.row.multiEditAccepted += n(tools?.multi_edit_tool?.accepted);
    acc.row.multiEditRejected += n(tools?.multi_edit_tool?.rejected);
    acc.row.writeAccepted += n(tools?.write_tool?.accepted);
    acc.row.writeRejected += n(tools?.write_tool?.rejected);
    acc.row.notebookAccepted += n(tools?.notebook_edit_tool?.accepted);
    acc.row.notebookRejected += n(tools?.notebook_edit_tool?.rejected);

    for (const mb of record.model_breakdown ?? []) {
      const model = mb?.model ?? 'unknown';
      let m = acc.modelsByName.get(model);
      if (!m) {
        m = { model, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, costCents: 0 };
        acc.modelsByName.set(model, m);
      }
      m.inputTokens += n(mb?.tokens?.input);
      m.outputTokens += n(mb?.tokens?.output);
      m.cacheReadTokens += n(mb?.tokens?.cache_read);
      m.cacheCreationTokens += n(mb?.tokens?.cache_creation);
      m.costCents += n(mb?.estimated_cost?.amount);
    }

    acc.raw.push(record);
  }

  const rows: DailyInsertRow[] = [];
  for (const acc of byKey.values()) {
    acc.row.models = [...acc.modelsByName.values()];
    acc.row.rawJson = JSON.stringify(acc.raw.length === 1 ? acc.raw[0] : acc.raw);
    rows.push(acc.row);
  }

  const written = repos.usage.replaceDay(date, rows, (userId, d) => repos.users.touchSeenDates(userId, d));
  for (const [userId, tier] of tierByUser) {
    repos.users.updateProgramTier(userId, date, tier.customerType, tier.subscriptionType);
  }
  return written;
}
