/**
 * DELETE /api/users/:id — admin-only, irreversible erase of one user and every
 * row tied to them. Runs against a real, fully migrated in-memory SQLite DB so
 * the test proves the actual schema is cleared, not a hand-kept table list.
 */
import Database from 'better-sqlite3';
import Fastify, { type FastifyInstance } from 'fastify';
import type { DeleteUserResponse } from '@dash/shared';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppContext } from '../src/context';
import type { Db } from '../src/db/connection';
import { migrate } from '../src/db/migrate';
import { UserRepo } from '../src/repos/userRepo';
import { registerUserRoutes } from '../src/routes/users';

function seed(db: Db): { victim: number; bystander: number; teamId: number } {
  const victim = Number(
    db.prepare(`INSERT INTO users (actor_type, email, name) VALUES ('user', 'gone@x.com', 'Gone')`).run().lastInsertRowid,
  );
  const bystander = Number(
    db.prepare(`INSERT INTO users (actor_type, email, name) VALUES ('user', 'stays@x.com', 'Stays')`).run().lastInsertRowid,
  );
  const teamId = Number(db.prepare(`INSERT INTO teams (name, lead_user_id) VALUES ('Core', ?)`).run(victim).lastInsertRowid);
  db.prepare(`UPDATE users SET team_id = ? WHERE id IN (?, ?)`).run(teamId, victim, bystander);
  for (const uid of [victim, bystander]) {
    const daily = db
      .prepare(`INSERT INTO usage_daily (date, user_id, num_sessions, raw_json) VALUES ('2026-10-01', ?, 3, '{}')`)
      .run(uid).lastInsertRowid;
    db.prepare(`INSERT INTO usage_daily_models (usage_daily_id, model) VALUES (?, 'claude-opus-5-5')`).run(daily);
    db.prepare(`INSERT INTO usage_hourly (user_id, hour_utc) VALUES (?, '2026-10-01T10')`).run(uid);
    db.prepare(`INSERT INTO otel_skill_daily (date, user_id, skill_name, invocations) VALUES ('2026-10-01', ?, 'review', 2)`).run(uid);
    db.prepare(`INSERT INTO score_snapshots (snapshot_date, user_id, range_key, badges_json) VALUES ('2026-10-01', ?, '30d', '[]')`).run(uid);
    db.prepare(
      `INSERT INTO ai_recommendations (user_id, range_key, generated_at, model, input_hash, input_json, output_json)
       VALUES (?, 'r', '2026-10-01T00:00:00Z', 'm', 'h', '{}', '{}')`,
    ).run(uid);
  }
  return { victim, bystander, teamId };
}

function build(adminPassword: string | null): { app: FastifyInstance; db: Db } {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  const ctx = { env: { adminPassword, orgTimezone: 'UTC' }, repos: { users: new UserRepo(db) } } as unknown as AppContext;
  const app = Fastify();
  registerUserRoutes(app, ctx);
  return { app, db };
}

/** rows owned by `uid` across every table with a user_id column, plus the users row */
function rowsFor(db: Db, uid: number): number {
  const tables = db
    .prepare(
      `SELECT m.name AS name FROM sqlite_master m WHERE m.type = 'table'
         AND EXISTS (SELECT 1 FROM pragma_table_info(m.name) c WHERE c.name = 'user_id')`,
    )
    .all() as Array<{ name: string }>;
  let n = (db.prepare(`SELECT COUNT(*) AS n FROM users WHERE id = ?`).get(uid) as { n: number }).n;
  for (const { name } of tables) n += (db.prepare(`SELECT COUNT(*) AS n FROM "${name}" WHERE user_id = ?`).get(uid) as { n: number }).n;
  return n;
}

let app: FastifyInstance | null = null;
afterEach(async () => {
  await app?.close();
  app = null;
});

const del = (a: FastifyInstance, id: number | string, headers: Record<string, string> = {}) =>
  a.inject({ method: 'DELETE', url: `/api/users/${id}`, headers });

describe('DELETE /api/users/:id', () => {
  it('needs the admin password: none → 401, wrong → 401, unconfigured → 403; nothing is deleted', async () => {
    const t = build('secret-1');
    app = t.app;
    const { victim } = seed(t.db);
    expect((await del(app, victim)).statusCode).toBe(401);
    expect((await del(app, victim, { 'x-admin-password': 'nope' })).statusCode).toBe(401);
    expect(rowsFor(t.db, victim)).toBeGreaterThan(1);

    const u = build(null);
    await app.close();
    app = u.app;
    const s = seed(u.db);
    const res = await del(app, s.victim, { 'x-admin-password': 'anything' });
    expect(res.statusCode).toBe(403);
    expect(rowsFor(u.db, s.victim)).toBeGreaterThan(1);
  });

  it('erases the user and every row they own, leaves other users intact, and clears them as team lead', async () => {
    const t = build('secret-1');
    app = t.app;
    const { victim, bystander, teamId } = seed(t.db);
    const before = rowsFor(t.db, bystander);

    const res = await del(app, victim, { 'x-admin-password': 'secret-1' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as DeleteUserResponse;
    expect(body.deletedUserId).toBe(victim);
    expect(body.tables.users).toBe(1);
    expect(body.tables.usage_daily).toBe(1);
    expect(body.rowsRemoved).toBeGreaterThanOrEqual(6);

    expect(rowsFor(t.db, victim)).toBe(0);
    expect(rowsFor(t.db, bystander)).toBe(before);
    // usage_daily_models cascades with its parent: only the bystander's row survives
    expect((t.db.prepare(`SELECT COUNT(*) AS n FROM usage_daily_models`).get() as { n: number }).n).toBe(1);
    const team = t.db.prepare(`SELECT lead_user_id FROM teams WHERE id = ?`).get(teamId) as { lead_user_id: number | null };
    expect(team.lead_user_id).toBeNull();
  });

  it('unknown or malformed id → 404', async () => {
    const t = build('secret-1');
    app = t.app;
    expect((await del(app, 999, { 'x-admin-password': 'secret-1' })).statusCode).toBe(404);
    expect((await del(app, 'abc', { 'x-admin-password': 'secret-1' })).statusCode).toBe(404);
  });
});
