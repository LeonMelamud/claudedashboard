import type { SyncLogSink } from '../sync/logBus';
import type { CursorPage, TokenPage } from './types';

const BASE_URL = 'https://api.anthropic.com';
const ANTHROPIC_VERSION = '2023-06-01';
const MIN_REQUEST_GAP_MS = 750;
const MAX_ATTEMPTS = 6;
const BACKOFF_BASE_MS = 2_000;
const BACKOFF_CAP_MS = 60_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Exponential backoff: 2s base, x2 per attempt, capped at 60s; Retry-After wins when present. */
function backoffMs(attempt: number, retryAfterHeader: string | null): number {
  const computed = Math.min(BACKOFF_BASE_MS * 2 ** (attempt - 1), BACKOFF_CAP_MS);
  if (retryAfterHeader) {
    const seconds = Number(retryAfterHeader);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000, BACKOFF_CAP_MS);
    }
    const dateMs = Date.parse(retryAfterHeader);
    if (Number.isFinite(dateMs)) {
      return Math.min(Math.max(0, dateMs - Date.now()), BACKOFF_CAP_MS);
    }
  }
  return computed;
}

/** Compact single-line response preview for the log window. */
const PREVIEW_CHARS = 400;
function preview(body: string): string {
  const compact = body.replace(/\s+/g, ' ').trim();
  return compact.length > PREVIEW_CHARS ? `${compact.slice(0, PREVIEW_CHARS)}… (${body.length} chars)` : compact;
}

export class AnthropicApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: string,
  ) {
    super(message);
    this.name = 'AnthropicApiError';
  }
}

/** Array values repeat the key (e.g. group_by[]=a&group_by[]=b). */
export type QueryParams = Record<string, string | number | string[] | undefined>;

export class AnthropicClient {
  /** Shared pacer: reserves execution slots so ALL requests are >=750ms apart. */
  private nextSlotAt = 0;

  constructor(
    private readonly apiKey: string,
    private readonly log?: SyncLogSink,
  ) {}

  /** Path + query only for the log line — never headers (the api-key lives there). */
  private label(url: string): string {
    try {
      const u = new URL(url);
      return u.pathname + u.search;
    } catch {
      return url;
    }
  }

  private async pace(): Promise<void> {
    const now = Date.now();
    const slot = Math.max(now, this.nextSlotAt);
    this.nextSlotAt = slot + MIN_REQUEST_GAP_MS;
    if (slot > now) await sleep(slot - now);
  }

  buildUrl(path: string, params: QueryParams = {}): string {
    const url = new URL(path, BASE_URL);
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined) continue;
      if (Array.isArray(value)) {
        for (const v of value) url.searchParams.append(key, v);
      } else {
        url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  /** GET with exponential backoff on 429/5xx/network errors, honoring Retry-After. */
  async fetchWithRetry<T>(url: string): Promise<T> {
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      await this.pace();
      const startedAt = Date.now();
      let res: Response;
      try {
        res = await fetch(url, {
          headers: {
            'x-api-key': this.apiKey,
            'anthropic-version': ANTHROPIC_VERSION,
          },
        });
      } catch (err) {
        lastError = err;
        const msg = err instanceof Error ? err.message : String(err);
        if (attempt === MAX_ATTEMPTS) {
          this.log?.emit('error', 'api', `network error for ${this.label(url)} — gave up after ${MAX_ATTEMPTS} attempts: ${msg}`);
          break;
        }
        this.log?.emit('warn', 'api', `network error for ${this.label(url)}, retrying (attempt ${attempt}/${MAX_ATTEMPTS}): ${msg}`);
        await sleep(backoffMs(attempt, null));
        continue;
      }

      if (res.ok) {
        const text = await res.text();
        this.log?.emit('debug', 'api', `GET ${this.label(url)} → ${res.status} (${Date.now() - startedAt}ms) ${preview(text)}`);
        return JSON.parse(text) as T;
      }

      const body = await res.text().catch(() => '');
      if (res.status === 429 || res.status >= 500) {
        lastError = new AnthropicApiError(`Anthropic API ${res.status} for ${url}`, res.status, body);
        if (attempt === MAX_ATTEMPTS) {
          this.log?.emit('error', 'api', `${res.status} for ${this.label(url)} — gave up after ${MAX_ATTEMPTS} attempts: ${body}`);
          break;
        }
        const wait = backoffMs(attempt, res.headers.get('retry-after'));
        this.log?.emit('warn', 'api', `${res.status} for ${this.label(url)}, retrying in ${wait}ms (attempt ${attempt}/${MAX_ATTEMPTS})`);
        await sleep(wait);
        continue;
      }
      this.log?.emit('error', 'api', `${res.status} for ${this.label(url)}: ${body}`);
      throw new AnthropicApiError(`Anthropic API ${res.status} for ${url}: ${body.slice(0, 500)}`, res.status, body);
    }
    throw lastError instanceof Error
      ? lastError
      : new Error(`Anthropic API request failed after ${MAX_ATTEMPTS} attempts: ${String(lastError)}`);
  }

  /** Paginate token-style endpoints (usage reports): has_more + next_page → ?page= */
  async *paginate<T>(path: string, params: QueryParams = {}): AsyncGenerator<T[], void, void> {
    let page: string | undefined;
    for (;;) {
      const url = this.buildUrl(path, page === undefined ? params : { ...params, page });
      const res = await this.fetchWithRetry<TokenPage<T>>(url);
      yield res.data ?? [];
      if (!res.has_more || !res.next_page) return;
      page = res.next_page;
    }
  }

  /** Paginate cursor-style endpoints (org users): has_more + last_id → ?after_id= */
  async *paginateCursor<T>(path: string, params: QueryParams = {}): AsyncGenerator<T[], void, void> {
    let afterId: string | undefined;
    for (;;) {
      const url = this.buildUrl(path, afterId === undefined ? params : { ...params, after_id: afterId });
      const res = await this.fetchWithRetry<CursorPage<T>>(url);
      yield res.data ?? [];
      if (!res.has_more || !res.last_id) return;
      afterId = res.last_id;
    }
  }
}
