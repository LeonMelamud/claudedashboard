import { DEFAULT_SETTINGS, type AppSettings } from '@dash/shared';
import type { Db } from '../db/connection';

const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS) as Array<keyof AppSettings>;

export class SettingsRepo {
  constructor(private readonly db: Db) {}

  private readStored(): Partial<AppSettings> {
    const rows = this.db.prepare(`SELECT key, value FROM settings`).all() as Array<{
      key: string;
      value: string;
    }>;
    const out: Partial<AppSettings> = {};
    for (const row of rows) {
      if (!(SETTING_KEYS as string[]).includes(row.key)) continue;
      try {
        (out as Record<string, unknown>)[row.key] = JSON.parse(row.value);
      } catch {
        // ignore malformed value; default will apply
      }
    }
    return out;
  }

  getMerged(): AppSettings {
    return { ...DEFAULT_SETTINGS, ...this.readStored() };
  }

  setMany(patch: Partial<AppSettings>): AppSettings {
    const upsert = this.db.prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    );
    const txn = this.db.transaction((p: Partial<AppSettings>) => {
      for (const key of SETTING_KEYS) {
        const value = p[key];
        if (value !== undefined) upsert.run(key, JSON.stringify(value));
      }
    });
    txn(patch);
    return this.getMerged();
  }

  /** Persist defaults for keys not yet stored (boot-time). */
  ensureDefaults(): void {
    const insert = this.db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`);
    const txn = this.db.transaction(() => {
      for (const key of SETTING_KEYS) {
        insert.run(key, JSON.stringify(DEFAULT_SETTINGS[key]));
      }
    });
    txn();
  }
}
