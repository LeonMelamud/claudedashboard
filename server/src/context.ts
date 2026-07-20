import type { Db } from './db/connection';
import type { Env } from './env';
import type { Repos } from './repos';
import type { SyncLogBus } from './sync/logBus';
import type { SyncManager } from './sync/manager';

export interface AppContext {
  env: Env;
  db: Db;
  repos: Repos;
  syncManager: SyncManager;
  syncLog: SyncLogBus;
}
