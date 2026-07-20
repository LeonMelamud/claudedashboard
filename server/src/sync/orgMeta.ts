import type { AnthropicClient } from '../anthropic/client';
import type { RawApiKeyRecord, RawWorkspace } from '../anthropic/types';
import type { Repos } from '../repos';
import type { ApiKeyUpsertRow, WorkspaceUpsertRow } from '../repos/apiKeyRepo';

/**
 * Org metadata sync: workspaces (including archived) + API key inventory,
 * both cursor-paginated and fully replaced per run — the upstream lists are
 * small and authoritative. Returns rows written.
 */
export async function syncOrgMeta(client: AnthropicClient, repos: Repos): Promise<number> {
  const workspaces: WorkspaceUpsertRow[] = [];
  for await (const page of client.paginateCursor<RawWorkspace>('/v1/organizations/workspaces', {
    limit: 100,
    include_archived: 'true',
  })) {
    for (const ws of page) {
      if (!ws.id) continue;
      workspaces.push({
        id: ws.id,
        name: ws.name ?? ws.id,
        displayColor: ws.display_color ?? null,
        archivedAt: ws.archived_at ?? null,
      });
    }
  }

  const keys: ApiKeyUpsertRow[] = [];
  for await (const page of client.paginateCursor<RawApiKeyRecord>('/v1/organizations/api_keys', {
    limit: 100,
  })) {
    for (const key of page) {
      if (!key.id) continue;
      keys.push({
        id: key.id,
        name: key.name ?? key.id,
        status: key.status ?? 'active',
        partialKeyHint: key.partial_key_hint ?? null,
        createdAt: key.created_at ?? null,
        createdByUserId: key.created_by?.id ?? null,
        workspaceId: key.workspace_id ?? null,
      });
    }
  }

  let written = repos.apiKeys.replaceWorkspaces(workspaces);
  written += repos.apiKeys.replaceApiKeys(keys);
  return written;
}
