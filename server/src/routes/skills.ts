import type { AgentUsageRow, SkillsResponse, SkillUsageRow, ToolUsageRow, UserSkillRow } from '@dash/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context';
import type { OtelScope } from '../repos/otelRepo';
import { parseRangeQuery, rangeQuerySchema, zodMessage, BadRequestError } from './shared';

const TOOL_CAP = 25;

const skillsQuerySchema = rangeQuerySchema.extend({
  /** scopes skills/agents/tools to one user; users[] comes back empty */
  userId: z.coerce.number().int().positive().optional(),
});

function rate(success: number, failure: number): number | null {
  const total = success + failure;
  return total > 0 ? success / total : null;
}

export function registerSkillRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/skills', async (req): Promise<SkillsResponse> => {
    const parsed = skillsQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) throw new BadRequestError(zodMessage(parsed.error));
    const q = parseRangeQuery(req.query);
    const userId = parsed.data.userId;

    const scope: OtelScope = {};
    if (q.teamId !== undefined) scope.teamId = q.teamId;
    if (userId !== undefined) scope.userId = userId;

    const skills: SkillUsageRow[] = ctx.repos.otel.skillTotals(q.from, q.to, scope).map((r) => ({
      skillName: r.skill_name,
      invocations: r.invocations,
      users: r.users,
      costCents: r.cost_cents,
      userSlash: r.user_slash,
      proactive: r.proactive,
      nested: r.nested,
    }));

    const agents: AgentUsageRow[] = ctx.repos.otel.agentTotals(q.from, q.to, scope).map((r) => ({
      subagentType: r.subagent_type,
      invocations: r.invocations,
      users: r.users,
      successRate: rate(r.success, r.failure),
      costCents: r.cost_cents,
    }));

    const tools: ToolUsageRow[] = ctx.repos.otel.toolTotals(q.from, q.to, scope, TOOL_CAP).map((r) => ({
      toolName: r.tool_name,
      uses: r.uses,
      accepted: r.accepted,
      rejected: r.rejected,
      successRate: rate(r.success, r.failure),
    }));

    // per-user rollup only makes sense org/team-wide
    const users: UserSkillRow[] =
      userId !== undefined
        ? []
        : ctx.repos.otel.userRollup(q.from, q.to, scope).map((r) => ({
            userId: r.user_id,
            name: r.name,
            email: r.email,
            skillInvocations: r.skill_invocations,
            distinctSkills: r.distinct_skills,
            agentInvocations: r.agent_invocations,
            topSkill: r.top_skill,
          }));

    const eventsIngested = Number(ctx.repos.sync.getState('otel_events_ingested') ?? '0');

    return {
      range: { from: q.from, to: q.to },
      hasData: ctx.repos.otel.hasData(q.from, q.to, scope),
      totals: ctx.repos.otel.totals(q.from, q.to, scope),
      skills,
      agents,
      tools,
      users,
      ingest: {
        eventsIngested: Number.isFinite(eventsIngested) ? eventsIngested : 0,
        lastEventAt: ctx.repos.sync.getState('otel_last_event_at'),
      },
    };
  });
}
