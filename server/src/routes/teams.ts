import type {
  SegmentTier,
  TeamSummary,
  TeamsResponse,
  TeamsSummaryResponse,
} from '@dash/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context';
import { buildLeaderboardData } from '../services/scoring';
import { parseBody, parseRangeQuery } from './shared';

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

const createTeamSchema = z.object({
  name: z.string().trim().min(1).max(100),
  color: z.string().regex(HEX_COLOR_RE, 'expected #rrggbb').optional(),
  leadUserId: z.number().int().positive().nullable().optional(),
});

const updateTeamSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  color: z.string().regex(HEX_COLOR_RE, 'expected #rrggbb').optional(),
  leadUserId: z.number().int().positive().nullable().optional(),
});

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    String((err as { code: unknown }).code).startsWith('SQLITE_CONSTRAINT')
  );
}

const emptySegmentCounts = (): Record<SegmentTier, number> => ({
  starter: 0,
  explorer: 0,
  producer: 0,
  champion: 0,
});

export function registerTeamRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/teams', async (): Promise<TeamsResponse> => {
    return { teams: ctx.repos.teams.list() };
  });

  app.get('/api/teams/summary', async (req): Promise<TeamsSummaryResponse> => {
    const q = parseRangeQuery(req.query);
    const data = buildLeaderboardData(ctx.repos, { from: q.from, to: q.to });
    // Roster-scoped like memberCount, so activePct cannot exceed 100 when a
    // departed member still has usage inside the range.
    const userEntries = data.entries.filter((e) => e.user.actorType === 'user' && e.user.inRoster);

    const teams: TeamSummary[] = ctx.repos.teams.list().map((team) => {
      const members = userEntries.filter((e) => e.user.teamId === team.id);
      const active = members.filter((m) => m.metrics.sessions > 0);
      const sessions = members.reduce((s, m) => s + m.metrics.sessions, 0);
      const costCents = members.reduce((s, m) => s + m.metrics.costCents, 0);
      const linesAdded = members.reduce((s, m) => s + m.metrics.linesAdded, 0);
      const linesRemoved = members.reduce((s, m) => s + m.metrics.linesRemoved, 0);
      const accepted = members.reduce((s, m) => s + m.metrics.toolAccepted, 0);
      const rejected = members.reduce((s, m) => s + m.metrics.toolRejected, 0);
      const events = accepted + rejected;

      const scored = members.filter((m) => m.scores.composite !== null);
      const avg = (f: (m: (typeof scored)[number]) => number): number =>
        scored.length > 0 ? Math.round((scored.reduce((s, m) => s + f(m), 0) / scored.length) * 10) / 10 : 0;

      const segmentCounts = emptySegmentCounts();
      for (const member of members) segmentCounts[member.segment] += 1;

      return {
        team,
        activeMembers: active.length,
        activePct: team.memberCount > 0 ? (active.length / team.memberCount) * 100 : 0,
        sessions,
        sessionsPerActive: active.length > 0 ? sessions / active.length : null,
        costCents,
        costPerActiveCents: active.length > 0 ? costCents / active.length : null,
        linesAdded,
        netLines: linesAdded - linesRemoved,
        acceptanceRate: events > 0 ? accepted / events : null,
        avgScores: {
          adoption: avg((m) => m.scores.adoption),
          impact: avg((m) => m.scores.impact),
          efficiency: avg((m) => m.scores.efficiency),
          trust: avg((m) => m.scores.trust),
          composite: avg((m) => m.scores.composite ?? 0),
        },
        segmentCounts,
      };
    });

    return {
      range: { from: q.from, to: q.to },
      teams,
      unassignedCount: ctx.repos.users.unassignedRosteredCount(),
    };
  });

  app.post('/api/teams', async (req, reply) => {
    const body = parseBody(createTeamSchema, req.body);
    if (body.leadUserId != null && !ctx.repos.users.getById(body.leadUserId)) {
      return reply.code(404).send({ error: 'user_not_found' });
    }
    try {
      const team = ctx.repos.teams.create({
        name: body.name,
        color: body.color,
        leadUserId: body.leadUserId ?? null,
      });
      return reply.code(201).send(team);
    } catch (err) {
      if (isUniqueViolation(err)) return reply.code(409).send({ error: 'team_exists' });
      throw err;
    }
  });

  app.put('/api/teams/:id', async (req, reply) => {
    const teamId = Number((req.params as { id: string }).id);
    if (!Number.isInteger(teamId) || teamId <= 0) return reply.code(404).send({ error: 'team_not_found' });
    const body = parseBody(updateTeamSchema, req.body);
    if (body.leadUserId != null && !ctx.repos.users.getById(body.leadUserId)) {
      return reply.code(404).send({ error: 'user_not_found' });
    }
    try {
      const team = ctx.repos.teams.update(teamId, body);
      if (!team) return reply.code(404).send({ error: 'team_not_found' });
      return team;
    } catch (err) {
      if (isUniqueViolation(err)) return reply.code(409).send({ error: 'team_exists' });
      throw err;
    }
  });

  app.delete('/api/teams/:id', async (req, reply) => {
    const teamId = Number((req.params as { id: string }).id);
    if (!Number.isInteger(teamId) || teamId <= 0) return reply.code(404).send({ error: 'team_not_found' });
    const deleted = ctx.repos.teams.delete(teamId);
    if (!deleted) return reply.code(404).send({ error: 'team_not_found' });
    return reply.code(204).send();
  });
}
