import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { resolveFromRepoRoot } from '../env';

export type Db = Database.Database;

export function openDb(dbPath: string): Db {
  // relative paths (e.g. the seed script's './data/dashboard.db' default)
  // anchor at the repo root, not cwd — cwd is server/ under pnpm --filter
  const resolved = resolveFromRepoRoot(dbPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const db = new Database(resolved);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');
  return db;
}
