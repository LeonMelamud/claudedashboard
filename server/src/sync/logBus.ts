import type { FastifyBaseLogger } from 'fastify';
import type { SyncLogLevel, SyncLogLine, SyncLogsResponse } from '@dash/shared';

/** Per-run ring-buffer cap and how many finished runs we keep around. */
const MAX_LINES = 3000;
const MAX_RUNS = 2;

export type SyncLogSource = 'sync' | 'api' | 'step';

/** Emit-only view handed to the API clients so they can't touch buffer internals. */
export interface SyncLogSink {
  emit(level: SyncLogLevel, source: SyncLogSource, message: string): void;
}

/** Bound helper so callers don't repeat level/source on every line. */
export interface SyncLogger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

/**
 * In-memory tee for sync logs. Every emit is stored in a per-run ring buffer
 * (for the live log window — level-independent, so the UI sees debug lines even
 * when LOG_LEVEL=info) AND forwarded to pino (stdout, level-filtered, so the
 * same lines show up in the terminal / `docker logs`).
 *
 * Sync is strictly serial (one active run ever), so a single `activeRunId` is
 * enough — emitters never thread a runId through their calls.
 */
export class SyncLogBus implements SyncLogSink {
  private seq = 0;
  private activeRunId: number | null = null;
  private readonly runs = new Map<number, SyncLogLine[]>();
  private readonly order: number[] = []; // run ids, oldest first
  private pino: FastifyBaseLogger | null = null;

  /** Attached after the Fastify app is built (Fastify owns the logger). */
  setLogger(logger: FastifyBaseLogger): void {
    this.pino = logger;
  }

  startRun(runId: number): void {
    this.activeRunId = runId;
    if (!this.runs.has(runId)) {
      this.runs.set(runId, []);
      this.order.push(runId);
      while (this.order.length > MAX_RUNS) {
        const evicted = this.order.shift();
        if (evicted !== undefined) this.runs.delete(evicted);
      }
    }
  }

  finishRun(runId: number): void {
    if (this.activeRunId === runId) this.activeRunId = null;
  }

  emit(level: SyncLogLevel, source: SyncLogSource, message: string): void {
    const runId = this.activeRunId;
    if (runId === null) return; // nothing runs outside a sync job
    const buf = this.runs.get(runId);
    if (!buf) return;
    const line: SyncLogLine = {
      seq: ++this.seq,
      runId,
      ts: new Date().toISOString(),
      level,
      source,
      message,
    };
    buf.push(line);
    // Bound memory: drop oldest overflow. The seq gap signals the truncation.
    if (buf.length > MAX_LINES) buf.splice(0, buf.length - MAX_LINES);
    this.pino?.[level]({ scope: 'sync', source, runId }, message);
  }

  /** A logger bound to a fixed source (used for lifecycle/step lines). */
  logger(source: SyncLogSource): SyncLogger {
    return {
      debug: (m) => this.emit('debug', source, m),
      info: (m) => this.emit('info', source, m),
      warn: (m) => this.emit('warn', source, m),
      error: (m) => this.emit('error', source, m),
    };
  }

  /** Lines with seq > `after` across retained runs, oldest first. */
  since(after: number, runId?: number): SyncLogsResponse {
    const ids = runId !== undefined ? [runId] : this.order;
    const lines: SyncLogLine[] = [];
    for (const id of ids) {
      const buf = this.runs.get(id);
      if (!buf) continue;
      for (const l of buf) if (l.seq > after) lines.push(l);
    }
    lines.sort((a, b) => a.seq - b.seq);
    const nextSeq = lines.length > 0 ? lines[lines.length - 1]!.seq : after;
    const currentRunId = this.activeRunId ?? this.order[this.order.length - 1] ?? null;
    return { lines, nextSeq, runId: currentRunId };
  }
}
