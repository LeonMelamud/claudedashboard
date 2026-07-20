/** Raw Anthropic Admin API response shapes (only the fields we consume). */

// --- GET /v1/organizations/users -------------------------------------------

export interface RawOrgUser {
  id: string;
  type: 'user';
  email: string;
  name: string;
  role: string;
  added_at: string;
}

export interface CursorPage<T> {
  data: T[];
  first_id: string | null;
  last_id: string | null;
  has_more: boolean;
}

// --- GET /v1/organizations/usage_report/claude_code -------------------------

export interface RawUserActor {
  type: 'user_actor';
  email_address: string;
}

export interface RawApiActor {
  type: 'api_actor';
  api_key_name: string;
}

export type RawActor = RawUserActor | RawApiActor;

export interface RawTokenCounts {
  input?: number | null;
  output?: number | null;
  cache_read?: number | null;
  cache_creation?: number | null;
}

export interface RawModelBreakdown {
  model?: string | null;
  tokens?: RawTokenCounts | null;
  /** amount is CENTS as a number */
  estimated_cost?: { amount?: number | null; currency?: string | null } | null;
}

export interface RawToolAction {
  accepted?: number | null;
  rejected?: number | null;
}

export interface RawClaudeCodeRecord {
  date?: string | null;
  actor?: Partial<RawUserActor & RawApiActor> & { type?: string | null };
  organization_id?: string | null;
  customer_type?: 'api' | 'subscription' | string | null;
  /** plan for subscription users (pro/max/team/enterprise); null for api */
  subscription_type?: string | null;
  terminal_type?: string | null;
  core_metrics?: {
    num_sessions?: number | null;
    lines_of_code?: { added?: number | null; removed?: number | null } | null;
    commits_by_claude_code?: number | null;
    pull_requests_by_claude_code?: number | null;
  } | null;
  tool_actions?: {
    edit_tool?: RawToolAction | null;
    multi_edit_tool?: RawToolAction | null;
    write_tool?: RawToolAction | null;
    notebook_edit_tool?: RawToolAction | null;
  } | null;
  model_breakdown?: RawModelBreakdown[] | null;
}

export interface TokenPage<T> {
  data: T[];
  has_more: boolean;
  next_page: string | null;
}

// --- GET /v1/organizations/usage_report/messages ----------------------------

export interface RawMessagesResult {
  uncached_input_tokens?: number | null;
  cache_creation?: {
    ephemeral_1h_input_tokens?: number | null;
    ephemeral_5m_input_tokens?: number | null;
  } | null;
  cache_read_input_tokens?: number | null;
  output_tokens?: number | null;
  account_id?: string | null;
  /** present when grouped by api_key_id; null = OAuth traffic */
  api_key_id?: string | null;
  /** present when grouped by service_tier / context_window */
  service_tier?: string | null;
  context_window?: string | null;
  server_tool_use?: { web_search_requests?: number | null } | null;
}

export interface RawMessagesBucket {
  starting_at: string;
  ending_at: string;
  results: RawMessagesResult[];
}

// --- GET /v1/organizations/cost_report ---------------------------------------

export interface RawCostResult {
  /** decimal STRING in cents, e.g. "123.4567" — parse with Number() */
  amount?: string | null;
  currency?: string | null;
  /** null = default workspace */
  workspace_id?: string | null;
  description?: string | null;
  cost_type?: string | null;
  token_type?: string | null;
  model?: string | null;
  service_tier?: string | null;
  context_window?: string | null;
}

export interface RawCostBucket {
  starting_at: string;
  ending_at: string;
  results: RawCostResult[];
}

// --- GET /v1/organizations/workspaces ----------------------------------------

export interface RawWorkspace {
  id: string;
  type?: string | null;
  name?: string | null;
  display_color?: string | null;
  archived_at?: string | null;
  created_at?: string | null;
}

// --- GET /v1/organizations/api_keys ------------------------------------------

export interface RawApiKeyRecord {
  id: string;
  type?: string | null;
  name?: string | null;
  status?: string | null;
  partial_key_hint?: string | null;
  created_at?: string | null;
  created_by?: { id?: string | null; type?: string | null } | null;
  workspace_id?: string | null;
}
