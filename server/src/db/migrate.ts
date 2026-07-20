import type { Db } from './connection';
import { MIGRATIONS } from './migrations';

/** Apply numbered migrations in order, recording applied names in _migrations. */
export function migrate(db: Db): void {
  db.exec(
    `CREATE TABLE IF NOT EXISTS _migrations (
      name       TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
  );
  const appliedRows = db.prepare('SELECT name FROM _migrations').all() as Array<{ name: string }>;
  const applied = new Set(appliedRows.map((r) => r.name));
  const record = db.prepare('INSERT INTO _migrations (name) VALUES (?)');

  const ordered = [...MIGRATIONS].sort((a, b) => a.name.localeCompare(b.name));
  for (const migration of ordered) {
    if (applied.has(migration.name)) continue;
    db.transaction(() => {
      db.exec(migration.sql);
      record.run(migration.name);
    })();
  }
}
