import type { Repos } from '../repos';

/**
 * Maps API actors to internal user ids, creating rows on first sight.
 * Caches per sync run — construct one resolver per job.
 */
export class ActorResolver {
  private readonly emailCache = new Map<string, number>();
  private readonly apiKeyCache = new Map<string, number>();
  private readonly accountCache = new Map<string, number>();

  constructor(private readonly repos: Repos) {}

  /** user_actor → upsert by lowercased email. */
  resolveUserActor(emailAddress: string): number {
    const email = emailAddress.toLowerCase();
    const cached = this.emailCache.get(email);
    if (cached !== undefined) return cached;
    const existing = this.repos.users.getByEmail(email);
    const id = existing ? existing.id : this.repos.users.insertUserActor(email, email);
    this.emailCache.set(email, id);
    return id;
  }

  /** api_actor → upsert by api_key_name. */
  resolveApiActor(apiKeyName: string): number {
    const cached = this.apiKeyCache.get(apiKeyName);
    if (cached !== undefined) return cached;
    const existing = this.repos.users.getByApiKeyName(apiKeyName);
    const id = existing ? existing.id : this.repos.users.insertApiActor(apiKeyName);
    this.apiKeyCache.set(apiKeyName, id);
    return id;
  }

  /** account_id → by anthropic_user_id, else create a stub user row. */
  resolveAccountId(accountId: string): number {
    const cached = this.accountCache.get(accountId);
    if (cached !== undefined) return cached;
    const existing = this.repos.users.getByAnthropicUserId(accountId);
    const id = existing ? existing.id : this.repos.users.insertStubForAccountId(accountId);
    this.accountCache.set(accountId, id);
    return id;
  }

  /** Dispatch on the raw claude_code usage record actor. Returns null when unusable. */
  resolveDailyActor(actor: { type?: string | null; email_address?: string | null; api_key_name?: string | null } | undefined): number | null {
    if (!actor) return null;
    if (actor.type === 'user_actor' && actor.email_address) {
      return this.resolveUserActor(actor.email_address);
    }
    if (actor.type === 'api_actor' && actor.api_key_name) {
      return this.resolveApiActor(actor.api_key_name);
    }
    return null;
  }
}
