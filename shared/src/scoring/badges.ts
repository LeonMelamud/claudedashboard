import type { BadgeStatus } from '../types.js';
import { clamp01 } from './normalize.js';
import {
  type Baselines,
  type ScoringInput,
  acceptanceRate,
  cacheRatio,
  linesPerSession,
  significantModelCount,
  toolEvents,
} from './scores.js';
import type { AxisScores } from '../types.js';

const CACHE_MASTER_RATIO = 0.7;
const CACHE_MASTER_MIN_TOKENS = 1_000_000;
const TIME_BADGE_SHARE = 0.3;
const TIME_BADGE_MIN_ACTIVE_DAYS = 10;
const STREAK_TIERS = { streak_bronze: 5, streak_silver: 10, streak_gold: 20, streak_kryptonite: 40 } as const;
const POLYGLOT_MODELS = 3;
const SKILL_SMITH_DISTINCT = 5;
const SKILL_SMITH_INVOCATIONS = 20;
const PLAN_FIRST_ENTRIES = 10;
const DREAM_BUILDER_PLANS = 5;
const DREAM_BUILDER_COMMITS = 15;
const WELL_CONNECTED_CALLS = 150;
const WELL_CONNECTED_SERVERS = 3;
const WELL_CONNECTED_SUCCESS = 0.9;
const ORCHESTRATOR_RUNS = 25;
const ORCHESTRATOR_TYPES = 2;
const ORCHESTRATOR_SUCCESS = 0.9;
const DEEP_DIVER_COMPACTIONS = 25;

const fmt = (n: number) => (Number.isInteger(n) ? n.toLocaleString('en-US') : n.toFixed(1));
const pct = (n: number) => `${Math.round(n * 100)}%`;

/**
 * All 21 badge statuses (earned or not, with 0..1 progress) for one user.
 * Percentile thresholds come from the frozen org-wide baselines; every
 * percentile badge also has an absolute floor so a quiet week can't mint
 * champions.
 */
export function computeBadges(i: ScoringInput, b: Baselines, axes: AxisScores): BadgeStatus[] {
  const badges: BadgeStatus[] = [];
  const add = (id: BadgeStatus['id'], earned: boolean, progress: number, detail: string) =>
    badges.push({ id, earned, progress: earned ? 1 : clamp01(progress), detail });

  // PR Machine: PRs >= p80 AND >= 5. Claude Code's PR flow is GitHub-only —
  // when the whole org has zero PRs the badge is unattainable tooling-wise,
  // so mark it explicitly not-applicable rather than perpetually ghosted.
  {
    if (b.maxPullRequests === 0) {
      add('pr_machine', false, 0, 'Not applicable — no GitHub PR flow in this org');
    } else {
      const threshold = Math.max(b.p80PullRequests, 5);
      add(
        'pr_machine',
        i.pullRequests >= threshold && i.pullRequests >= 5,
        threshold > 0 ? i.pullRequests / threshold : 0,
        `${fmt(i.pullRequests)} / ${fmt(threshold)} PRs`,
      );
    }
  }

  // Ship It: commits >= p80 AND >= 15
  {
    const threshold = Math.max(b.p80Commits, 15);
    add(
      'ship_it',
      i.commits >= threshold,
      threshold > 0 ? i.commits / threshold : 0,
      `${fmt(i.commits)} / ${fmt(threshold)} commits`,
    );
  }

  // Cache Master: cacheRatio >= 0.70 AND (input + cache_read) >= 1M tokens
  {
    const ratio = cacheRatio(i) ?? 0;
    const volume = i.inputTokens + i.cacheReadTokens;
    const earned = ratio >= CACHE_MASTER_RATIO && volume >= CACHE_MASTER_MIN_TOKENS;
    add(
      'cache_master',
      earned,
      Math.min(ratio / CACHE_MASTER_RATIO, volume / CACHE_MASTER_MIN_TOKENS),
      `${pct(ratio)} cache ratio (need ${pct(CACHE_MASTER_RATIO)})`,
    );
  }

  // Night Owl / Early Bird: >=30% of hourly activity in the window, >=10 active
  // days; mutually exclusive — the higher share wins.
  {
    const night = i.nightShare ?? 0;
    const early = i.earlyShare ?? 0;
    const eligible = i.activeDays >= TIME_BADGE_MIN_ACTIVE_DAYS;
    const nightWins = night >= early;
    add(
      'night_owl',
      eligible && night >= TIME_BADGE_SHARE && nightWins,
      eligible ? night / TIME_BADGE_SHARE : 0,
      `${pct(night)} of activity 22:00–05:00`,
    );
    add(
      'early_bird',
      eligible && early >= TIME_BADGE_SHARE && !nightWins,
      eligible ? early / TIME_BADGE_SHARE : 0,
      `${pct(early)} of activity 05:00–09:00`,
    );
  }

  // Streaks — earned on the BEST run in the trailing 90d, so a badge you hit
  // survives the day you take off; progress still tracks the current run.
  for (const [id, need] of Object.entries(STREAK_TIERS) as Array<
    [keyof typeof STREAK_TIERS, number]
  >) {
    const best = Math.max(i.bestStreak, i.currentStreak);
    add(
      id,
      best >= need,
      i.currentStreak / need,
      best > i.currentStreak
        ? `${i.currentStreak} now / best ${best} of ${need} days`
        : `${i.currentStreak} / ${need} days`,
    );
  }

  // Polyglot: >=3 models each with >=5% of personal tokens
  {
    const count = significantModelCount(i.modelTokens);
    add('polyglot', count >= POLYGLOT_MODELS, count / POLYGLOT_MODELS, `${count} / ${POLYGLOT_MODELS} models`);
  }

  // Marathon: sessions >= p90 AND >= 60
  {
    const threshold = Math.max(b.p90Sessions, 60);
    add('marathon', i.sessions >= threshold, threshold > 0 ? i.sessions / threshold : 0, `${fmt(i.sessions)} / ${fmt(threshold)} sessions`);
  }

  // High Output: linesAdded >= p80 (percentile-only, self-calibrating)
  {
    const threshold = b.p80LinesAdded;
    add(
      'high_output',
      threshold > 0 && i.linesAdded >= threshold,
      threshold > 0 ? i.linesAdded / threshold : 0,
      `${fmt(i.linesAdded)} / ${fmt(threshold)} lines`,
    );
  }

  // Efficient: lines/session >= p80 AND sessions >= 10
  {
    const lps = linesPerSession(i);
    const threshold = b.p80LinesPerSession;
    const earned = threshold > 0 && lps >= threshold && i.sessions >= 10;
    add(
      'efficient',
      earned,
      threshold > 0 ? Math.min(lps / threshold, i.sessions / 10) : 0,
      `${fmt(lps)} / ${fmt(threshold)} lines per session`,
    );
  }

  // High Acceptance: rate >= 40% AND >= 20 events (reference rule, verbatim)
  {
    const rate = acceptanceRate(i) ?? 0;
    const events = toolEvents(i);
    add(
      'high_acceptance',
      rate >= 0.4 && events >= 20,
      Math.min(rate / 0.4, events / 20),
      `${pct(rate)} acceptance over ${fmt(events)} decisions`,
    );
  }

  // Experimenting: Adoption >= 60 AND Impact < 40 (positive framing)
  {
    const earned = axes.adoption >= 60 && axes.impact < 40;
    add(
      'experimenting',
      earned,
      earned ? 1 : Math.min(axes.adoption / 60, 1) * (axes.impact < 40 ? 1 : 0),
      `adoption ${axes.adoption}, impact ${axes.impact}`,
    );
  }

  // ---- Value-delivery badges (OTEL telemetry). Absolute thresholds,
  // calibrated on live org data 2026-08. Each gates to "Not applicable" when
  // the org has no signal at all; the distinct-count ones also gate when
  // minimal privacy mode collapses names (skills → 'custom_skill', MCP
  // servers → 'redacted', agents → 'custom'), i.e. org-wide distinct <= 1.

  // Skill Smith: >=5 distinct skills AND >=20 invocations — breadth over volume
  {
    if (b.maxSkillInvocations === 0) {
      add('skill_smith', false, 0, 'Not applicable — no skill telemetry in this org');
    } else if (b.maxDistinctSkills <= 1) {
      add('skill_smith', false, 0, 'Not applicable — skill names hidden by privacy mode');
    } else {
      add(
        'skill_smith',
        i.distinctSkills >= SKILL_SMITH_DISTINCT && i.skillInvocations >= SKILL_SMITH_INVOCATIONS,
        Math.min(i.distinctSkills / SKILL_SMITH_DISTINCT, i.skillInvocations / SKILL_SMITH_INVOCATIONS),
        `${fmt(i.distinctSkills)} / ${SKILL_SMITH_DISTINCT} skills · ${fmt(i.skillInvocations)} / ${SKILL_SMITH_INVOCATIONS} runs`,
      );
    }
  }

  // Plan-First: entered plan mode >= 10 times
  {
    if (b.maxPlanModeEntries === 0) {
      add('plan_first', false, 0, 'Not applicable — no plan-mode telemetry in this org');
    } else {
      add(
        'plan_first',
        i.planModeEntries >= PLAN_FIRST_ENTRIES,
        i.planModeEntries / PLAN_FIRST_ENTRIES,
        `${fmt(i.planModeEntries)} / ${PLAN_FIRST_ENTRIES} plan-mode entries`,
      );
    }
  }

  // Dream Builder: >=5 approved plans AND >=15 commits — plans that ship
  {
    if (b.maxPlansAccepted === 0) {
      add('dream_builder', false, 0, 'Not applicable — no plan-approval telemetry in this org');
    } else {
      add(
        'dream_builder',
        i.plansAccepted >= DREAM_BUILDER_PLANS && i.commits >= DREAM_BUILDER_COMMITS,
        Math.min(i.plansAccepted / DREAM_BUILDER_PLANS, i.commits / DREAM_BUILDER_COMMITS),
        `${fmt(i.plansAccepted)} / ${DREAM_BUILDER_PLANS} plans · ${fmt(i.commits)} / ${DREAM_BUILDER_COMMITS} commits`,
      );
    }
  }

  // Well Connected: >=150 MCP calls, >=3 active servers, >=90% success
  {
    if (b.maxMcpCalls === 0) {
      add('well_connected', false, 0, 'Not applicable — no MCP telemetry in this org');
    } else if (b.maxActiveMcpServers <= 1) {
      add('well_connected', false, 0, 'Not applicable — MCP server names hidden by privacy mode');
    } else {
      const successRate = i.mcpCalls > 0 ? 1 - i.mcpFailures / i.mcpCalls : 0;
      add(
        'well_connected',
        i.mcpCalls >= WELL_CONNECTED_CALLS &&
          i.activeMcpServers >= WELL_CONNECTED_SERVERS &&
          successRate >= WELL_CONNECTED_SUCCESS,
        Math.min(
          i.mcpCalls / WELL_CONNECTED_CALLS,
          i.activeMcpServers / WELL_CONNECTED_SERVERS,
          i.mcpCalls > 0 ? successRate / WELL_CONNECTED_SUCCESS : 0,
        ),
        `${fmt(i.mcpCalls)} calls · ${fmt(i.activeMcpServers)} servers · ${pct(successRate)} success`,
      );
    }
  }

  // Orchestrator: >=25 subagent runs, >=2 agent types, >=90% success
  {
    if (b.maxSubagentRuns === 0) {
      add('orchestrator', false, 0, 'Not applicable — no subagent telemetry in this org');
    } else if (b.maxDistinctAgentTypes <= 1) {
      add('orchestrator', false, 0, 'Not applicable — subagent types hidden by privacy mode');
    } else {
      const successRate = i.subagentRuns > 0 ? i.subagentSuccesses / i.subagentRuns : 0;
      add(
        'orchestrator',
        i.subagentRuns >= ORCHESTRATOR_RUNS &&
          i.distinctAgentTypes >= ORCHESTRATOR_TYPES &&
          successRate >= ORCHESTRATOR_SUCCESS,
        Math.min(
          i.subagentRuns / ORCHESTRATOR_RUNS,
          i.distinctAgentTypes / ORCHESTRATOR_TYPES,
          i.subagentRuns > 0 ? successRate / ORCHESTRATOR_SUCCESS : 0,
        ),
        `${fmt(i.subagentRuns)} runs · ${fmt(i.distinctAgentTypes)} agent types · ${pct(successRate)} success`,
      );
    }
  }

  // Deep Diver: all-time compactions >= 25. Measured over history, not the
  // selected range — compaction is rare (a session outgrowing the context
  // window), so a 7D view would never mint one, and an achievement shouldn't
  // vanish when someone changes the range picker.
  {
    if (b.maxCompactions === 0) {
      add('deep_diver', false, 0, 'Not applicable — no compaction telemetry in this org');
    } else {
      add(
        'deep_diver',
        i.compactions >= DEEP_DIVER_COMPACTIONS,
        i.compactions / DEEP_DIVER_COMPACTIONS,
        `${fmt(i.compactions)} / ${fmt(DEEP_DIVER_COMPACTIONS)} compactions (all-time)`,
      );
    }
  }

  return badges;
}
