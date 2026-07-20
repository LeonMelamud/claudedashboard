import type { AnthropicClient } from '../anthropic/client';
import type { RawOrgUser } from '../anthropic/types';
import type { Repos } from '../repos';
import { nowIso } from '../util/time';

/**
 * Full roster sync: pull every org member, match by anthropic_user_id then
 * lowercased email, refresh identity fields, mark absentees in_roster=0.
 * Never deletes. Returns the number of roster records processed.
 */
export async function syncRoster(client: AnthropicClient, repos: Repos): Promise<number> {
  const fetched: RawOrgUser[] = [];
  for await (const page of client.paginateCursor<RawOrgUser>('/v1/organizations/users', { limit: 1000 })) {
    fetched.push(...page);
  }

  const currentIds: number[] = [];
  for (const member of fetched) {
    if (!member.id || !member.email) continue;
    const info = {
      anthropicUserId: member.id,
      email: member.email,
      name: member.name || member.email,
      role: member.role ?? 'user',
      addedAt: member.added_at ?? nowIso(),
    };
    const byAnthId = repos.users.getByAnthropicUserId(member.id);
    const byEmail = repos.users.getByEmail(member.email);
    if (byAnthId && byEmail && byAnthId.id !== byEmail.id) {
      // The hourly sync created a stub keyed by anthropic_user_id while the
      // daily sync created a row keyed by email. Merge the stub into the
      // email row before applying roster info, otherwise setting the email
      // on the stub would violate ux_users_email.
      repos.users.mergeInto(byEmail.id, byAnthId.id);
      repos.users.applyRosterInfo(byEmail.id, info);
      currentIds.push(byEmail.id);
      continue;
    }
    if (byAnthId) {
      repos.users.applyRosterInfo(byAnthId.id, info);
      currentIds.push(byAnthId.id);
      continue;
    }
    if (byEmail) {
      repos.users.applyRosterInfo(byEmail.id, info);
      currentIds.push(byEmail.id);
      continue;
    }
    currentIds.push(repos.users.insertRosterUser(info));
  }

  repos.users.markDeparted(currentIds);
  repos.sync.setState('roster_synced_at', nowIso());
  return fetched.length;
}
