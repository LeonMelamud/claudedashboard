/**
 * GET /api/telemetry/plugins — plugins ranked by their skills' runs, each with
 * its own skill breakdown. Runs against a real, fully migrated in-memory DB so
 * the attribution rules are proven on the actual schema.
 */
import Database from 'better-sqlite3';
import Fastify, { type FastifyInstance } from 'fastify';
import type { PluginsResponse } from '@dash/shared';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppContext } from '../src/context';
import type { Db } from '../src/db/connection';
import { migrate } from '../src/db/migrate';
import { OtelPacksRepo } from '../src/repos/otelPacksRepo';
import { OtelRepo } from '../src/repos/otelRepo';
import { registerTelemetryPackRoutes } from '../src/routes/telemetryPacks';

const RANGE = 'from=2026-10-01&to=2026-10-31';

function addUser(db: Db, email: string, teamId: number | null = null): number {
  return Number(
    db.prepare(`INSERT INTO users (actor_type, email, name, team_id) VALUES ('user', ?, ?, ?)`).run(email, email, teamId)
      .lastInsertRowid,
  );
}

function skill(db: Db, date: string, userId: number, name: string, invocations: number, costCents = 0): void {
  db.prepare(
    `INSERT INTO otel_skill_daily (date, user_id, skill_name, invocations, cost_cents) VALUES (?, ?, ?, ?, ?)`,
  ).run(date, userId, name, invocations, costCents);
}

function meta(db: Db, name: string, pluginName: string | null): void {
  db.prepare(
    `INSERT INTO otel_skill_meta (skill_name, source, plugin_name, first_seen_at, last_seen_at)
     VALUES (?, 'plugin', ?, '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z')`,
  ).run(name, pluginName);
}

function load(db: Db, date: string, userId: number, pluginName: string, loads: number, installs = 0): void {
  db.prepare(`INSERT INTO otel_plugin_daily (date, user_id, plugin_name, installs, loads) VALUES (?, ?, ?, ?, ?)`).run(
    date,
    userId,
    pluginName,
    installs,
    loads,
  );
}

let app: FastifyInstance | null = null;
afterEach(async () => {
  await app?.close();
  app = null;
});

function build(): Db {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  const ctx = { repos: { otel: new OtelRepo(db), otelPacks: new OtelPacksRepo(db) } } as unknown as AppContext;
  app = Fastify();
  registerTelemetryPackRoutes(app, ctx);
  return db;
}

async function get(qs = RANGE): Promise<PluginsResponse> {
  const res = await app!.inject({ method: 'GET', url: `/api/telemetry/plugins?${qs}` });
  expect(res.statusCode).toBe(200);
  return res.json() as PluginsResponse;
}

describe('GET /api/telemetry/plugins', () => {
  it('ranks plugins by the sum of their skills, with a per-skill breakdown', async () => {
    const db = build();
    const a = addUser(db, 'a@x.com');
    const b = addUser(db, 'b@x.com');
    // superpowers: 3 + 5 + 4 = 12 runs by 2 people across 2 skills
    meta(db, 'superpowers:brainstorming', 'superpowers');
    meta(db, 'superpowers:writing-plans', 'superpowers');
    skill(db, '2026-10-02', a, 'superpowers:brainstorming', 3, 10);
    skill(db, '2026-10-03', b, 'superpowers:brainstorming', 5, 20);
    skill(db, '2026-10-03', a, 'superpowers:writing-plans', 4, 5);
    // atlassian: one skill, 20 runs by one person — ranks first on runs
    meta(db, 'atlassian:jira', 'atlassian');
    skill(db, '2026-10-04', b, 'atlassian:jira', 20, 1);
    load(db, '2026-10-02', a, 'superpowers', 7, 1);
    load(db, '2026-10-02', b, 'superpowers', 2);

    const body = await get();
    expect(body.hasData).toBe(true);
    expect(body.plugins.map((p) => p.pluginName)).toEqual(['atlassian', 'superpowers']);
    const sp = body.plugins[1]!;
    expect(sp).toMatchObject({ invocations: 12, users: 2, costCents: 35, loads: 9, installs: 1, loadUsers: 2 });
    expect(sp.skills).toEqual([
      { skillName: 'superpowers:brainstorming', invocations: 8, users: 2, costCents: 30 },
      { skillName: 'superpowers:writing-plans', invocations: 4, users: 1, costCents: 5 },
    ]);
  });

  it('attributes a prefix only when that prefix is a plugin Claude Code loaded', async () => {
    const db = build();
    const a = addUser(db, 'a@x.com');
    load(db, '2026-10-01', a, 'agentic-media-stack', 1);
    skill(db, '2026-10-02', a, 'agentic-media-stack:easy-media', 2); // no meta, known plugin → counts
    skill(db, '2026-10-02', a, 'agentic-core:git-workflow', 9); // project-folder prefix → not a plugin
    skill(db, '2026-10-02', a, 'review', 4); // no prefix at all
    meta(db, 'frontend-design', 'frontend-design'); // telemetry names the plugin, no prefix
    skill(db, '2026-10-02', a, 'frontend-design', 3);

    const body = await get();
    expect(body.plugins.map((p) => [p.pluginName, p.invocations])).toEqual([
      ['frontend-design', 3],
      ['agentic-media-stack', 2],
    ]);
  });

  it('keeps loaded-but-unused plugins after the used ones, and honors the range', async () => {
    const db = build();
    const a = addUser(db, 'a@x.com');
    meta(db, 'superpowers:brainstorming', 'superpowers');
    skill(db, '2026-10-02', a, 'superpowers:brainstorming', 1);
    skill(db, '2026-09-15', a, 'superpowers:brainstorming', 50); // outside range
    load(db, '2026-10-05', a, 'cc-plugin-telemetry', 40);

    const body = await get();
    expect(body.plugins.map((p) => [p.pluginName, p.invocations, p.loads])).toEqual([
      ['superpowers', 1, 0],
      ['cc-plugin-telemetry', 0, 40],
    ]);
    expect(body.plugins[1]!.skills).toEqual([]);
  });

  it('scopes to a team', async () => {
    const db = build();
    const team = Number(db.prepare(`INSERT INTO teams (name) VALUES ('Core')`).run().lastInsertRowid);
    const inTeam = addUser(db, 'in@x.com', team);
    const out = addUser(db, 'out@x.com');
    meta(db, 'superpowers:brainstorming', 'superpowers');
    skill(db, '2026-10-02', inTeam, 'superpowers:brainstorming', 2);
    skill(db, '2026-10-02', out, 'superpowers:brainstorming', 30);

    const body = await get(`${RANGE}&teamId=${team}`);
    expect(body.plugins[0]).toMatchObject({ pluginName: 'superpowers', invocations: 2, users: 1 });
  });

  it('reports hasData:false on an empty range', async () => {
    build();
    const body = await get();
    expect(body).toMatchObject({ hasData: false, plugins: [] });
  });
});
