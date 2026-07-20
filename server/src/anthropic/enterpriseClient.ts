import type { SyncLogSink } from '../sync/logBus';
import type { EntPage } from './enterpriseTypes';

const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_BASE_URL = 'https://api.anthropic.com';
/** Enterprise Analytics rate limit is 60 req/min ORG-WIDE → pace ≥1100ms. */
const DEFAULT_MIN_REQUEST_GAP_MS = 1_100;
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

export class EnterpriseApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: string,
  ) {
    super(message);
    this.name = 'EnterpriseApiError';
  }
}

type AuthScheme = 'x-api-key' | 'bearer';

/**
 * The docs describe `x-api-key` for Analytics keys, but some orgs are issued
 * bearer-style keys — try x-api-key first, on 401 retry once with
 * `Authorization: Bearer` and remember whichever worked for the rest of the
 * process (module-level, the key is org-wide anyway).
 */
let preferredAuthScheme: AuthScheme = 'x-api-key';

/** Array values repeat the key; use bracket names ('group_by[]', 'products[]'). */
export type EnterpriseQueryParams = Record<string, string | number | string[] | undefined>;

export interface EnterpriseClientOptions {
  /** Override for tests (mock server); default https://api.anthropic.com */
  baseUrl?: string;
  /** Override for tests; default 1100ms (60/min org-wide limit) */
  minRequestGapMs?: number;
}

export class EnterpriseClient {
  private readonly baseUrl: string;
  private readonly minGapMs: number;
  /** Shared pacer: reserves execution slots so ALL requests respect the org-wide limit. */
  private nextSlotAt = 0;

  constructor(
    private readonly apiKey: string,
    opts: EnterpriseClientOptions = {},
    private readonly log?: SyncLogSink,
  ) {
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
    this.minGapMs = opts.minRequestGapMs ?? DEFAULT_MIN_REQUEST_GAP_MS;
  }

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
    this.nextSlotAt = slot + this.minGapMs;
    if (slot > now) await sleep(slot - now);
  }

  buildUrl(path: string, params: EnterpriseQueryParams = {}): string {
    const url = new URL(path, this.baseUrl);
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

  private headers(scheme: AuthScheme): Record<string, string> {
    const base = { 'anthropic-version': ANTHROPIC_VERSION };
    return scheme === 'x-api-key'
      ? { ...base, 'x-api-key': this.apiKey }
      : { ...base, Authorization: `Bearer ${this.apiKey}` };
  }

  /**
   * GET with exponential backoff on 429/5xx/network errors (Retry-After
   * honored) and a one-time auth-scheme flip on 401 (see preferredAuthScheme).
   */
  async fetchWithRetry<T>(url: string): Promise<T> {
    let lastError: unknown = null;
    let authFlipped = false;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      await this.pace();
      const startedAt = Date.now();
      let res: Response;
      try {
        res = await fetch(url, { headers: this.headers(preferredAuthScheme) });
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
      if (res.status === 401 && !authFlipped) {
        // Wrong auth style for this key — flip once and remember what worked.
        authFlipped = true;
        preferredAuthScheme = preferredAuthScheme === 'x-api-key' ? 'bearer' : 'x-api-key';
        this.log?.emit('warn', 'api', `401 for ${this.label(url)}, retrying with ${preferredAuthScheme} auth`);
        attempt -= 1; // the flip retry doesn't consume a backoff attempt
        continue;
      }
      if (res.status === 429 || res.status >= 500) {
        lastError = new EnterpriseApiError(`Enterprise API ${res.status} for ${url}`, res.status, body);
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
      throw new EnterpriseApiError(`Enterprise API ${res.status} for ${url}: ${body.slice(0, 500)}`, res.status, body);
    }
    throw lastError instanceof Error
      ? lastError
      : new Error(`Enterprise API request failed after ${MAX_ATTEMPTS} attempts: ${String(lastError)}`);
  }

  /**
   * Paginate with the opaque next_page cursor (?page=). The cursor is bound to
   * the EXACT query params, so `params` is captured once and never mutated
   * mid-loop. Stops on has_more=false OR a missing/null next_page —
   * analytics/users has no has_more field at all.
   */
  async *paginate<T>(path: string, params: EnterpriseQueryParams = {}): AsyncGenerator<T[], void, void> {
    const frozen = { ...params };
    let page: string | undefined;
    for (;;) {
      const url = this.buildUrl(path, page === undefined ? frozen : { ...frozen, page });
      const res = await this.fetchWithRetry<EntPage<T>>(url);
      yield res.data ?? [];
      if (res.has_more === false || !res.next_page) return;
      page = res.next_page;
    }
  }
}
