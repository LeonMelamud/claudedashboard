/**
 * Raw claude.ai Enterprise Analytics API response shapes (only the fields we
 * consume). Base path: /v1/organizations/analytics/*. Data exists from
 * 2026-01-01; engagement endpoints lag 1–3 days behind real time.
 */

/** Generic page envelope. analytics/users has NO has_more — only next_page. */
export interface EntPage<T> {
  data: T[];
  has_more?: boolean | null;
  next_page?: string | null;
  data_refreshed_at?: string | null;
}

// --- GET analytics/users?date=YYYY-MM-DD ------------------------------------

export interface EntToolAction {
  accepted_count?: number | null;
  rejected_count?: number | null;
}

export interface EntUsersRecord {
  user?: {
    /** user_... */
    id?: string | null;
    email_address?: string | null;
  } | null;
  claude_code_metrics?: {
    core_metrics?: {
      commit_count?: number | null;
      distinct_session_count?: number | null;
      lines_of_code?: { added_count?: number | null; removed_count?: number | null } | null;
      pull_request_count?: number | null;
    } | null;
    tool_actions?: {
      edit_tool?: EntToolAction | null;
      multi_edit_tool?: EntToolAction | null;
      notebook_edit_tool?: EntToolAction | null;
      write_tool?: EntToolAction | null;
    } | null;
  } | null;
  /** chat_metrics / cowork_metrics / web_search_count etc. ride along in raw_json */
  [key: string]: unknown;
}

// --- GET analytics/user_usage_report (bucket_width 1d|1h) --------------------

export interface EntUsageActor {
  user_id?: string | null;
  email?: string | null;
  name?: string | null;
  deleted?: boolean | null;
}

export interface EntUsageRow {
  actor?: EntUsageActor | null;
  model?: string | null;
  uncached_input_tokens?: number | null;
  cache_creation?: {
    ephemeral_1h_input_tokens?: number | null;
    ephemeral_5m_input_tokens?: number | null;
  } | null;
  cache_read_input_tokens?: number | null;
  output_tokens?: number | null;
  total_tokens?: number | null;
  requests?: number | null;
  server_tool_use?: { web_search_requests?: number | null } | null;
  starting_at?: string | null;
  ending_at?: string | null;
}

// --- GET analytics/user_cost_report ------------------------------------------

export interface EntCostRow {
  actor?: EntUsageActor | null;
  model?: string | null;
  /** decimal STRING in fractional cents, e.g. "41280.000000" — parse with Number() */
  amount?: string | null;
  list_amount?: string | null;
  currency?: string | null;
  starting_at?: string | null;
  ending_at?: string | null;
}

// --- GET analytics/cost_report (org-level, bucket_width=1d) ------------------

export interface EntOrgCostResult {
  /** decimal STRING in cents */
  amount?: string | null;
  currency?: string | null;
  cost_type?: string | null;
  model?: string | null;
}

export interface EntOrgCostBucket {
  starting_at: string;
  ending_at: string;
  results: EntOrgCostResult[];
}

// --- GET analytics/summaries?starting_date&ending_date -----------------------

export interface EntSummary {
  starting_at: string;
  ending_at?: string | null;
  assigned_seat_count?: number | null;
  pending_invite_count?: number | null;
  daily_active_user_count?: number | null;
  weekly_active_user_count?: number | null;
  monthly_active_user_count?: number | null;
  daily_adoption_rate?: number | null;
  weekly_adoption_rate?: number | null;
  monthly_adoption_rate?: number | null;
  claude_code_daily_active_user_count?: number | null;
  [key: string]: unknown;
}

export interface EntSummariesResponse {
  summaries: EntSummary[];
}
