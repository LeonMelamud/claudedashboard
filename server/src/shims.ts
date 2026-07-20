/**
 * Global CJS shims for the esbuild ESM bundle.
 *
 * The bundle inlines CommonJS deps (node-cron) that reference __dirname at
 * module scope; ESM output has no __dirname, so we provide global fallbacks
 * BEFORE any other import executes (this module is imported first in index.ts).
 * Harmless under tsx/dev, where real CJS interop already provides them.
 */
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const g = globalThis as Record<string, unknown>;
if (typeof g['__filename'] === 'undefined') {
  g['__filename'] = fileURLToPath(import.meta.url);
}
if (typeof g['__dirname'] === 'undefined') {
  g['__dirname'] = dirname(fileURLToPath(import.meta.url));
}
