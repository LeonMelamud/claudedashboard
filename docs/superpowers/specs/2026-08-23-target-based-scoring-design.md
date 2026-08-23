# Target-based scoring — design

**Date:** 2026-08-23 · **Branch:** `feat/target-scoring` (stacked on `feat/value-badges`) · **Status:** approved 2026-08-23 (Leon) · implemented on this branch

## Problem

Axis scores normalize every volume metric against the **org max** (`normalize(value, orgMax)` in
`shared/src/scoring/normalize.ts`). One person is therefore the yardstick for everyone:

- One user holding 1,113 sessions (org p90 = 173) sets `N(sessions)=100 `for themselves by
  definition and compresses everyone else's Adoption term.
- Any user inflating a metric (e.g. opening 110 trivial PRs) would lower every other user's
  Impact score without any of them changing behavior — verified on live data: org max PR
  47→110 costs the current #1 1.87 composite points and ~0.3 for everyone with ≥1 PR.
- Scores are not comparable across weeks: the same personal output scores differently when
  the population changes.

Requirement (Leon, 2026-08-23): **counts must be true, and one person's volume must not
affect anyone else's score.**

Two secondary findings folded in, both from live data (n=31 active users, 30d window):

- **PR term is a measurement gap, not a behavior signal, in this org.** PRs are counted only
  via the GitHub `gh` flow; this org's repos are on Bitbucket. 5/31 users have any PRs
  (p90 = 1); 26 users take a structural 0 on 10.5% of the composite.
- **Cache-ratio term is dead.** Org cacheRatio: min 0.989, median 1.000 — a constant +30 for
  everyone inside Efficiency, so lines/$ (the actual cost-efficiency signal) carries only
  4.5% of the composite.

## Decisions (made with Leon in chat, 2026-08-23)

| # | Decision | Choice |
|---|---|---|
| 1 | Reference for axis scores | **Fixed absolute targets**, admin-overridable (not p90-relative, not calibrate-and-freeze) |
| 2 | Curve | **sqrt** (log is inconsistent across target magnitudes: half-target scores 86.4 on commits but 93.3 on lines; sqrt is a flat 70.7 everywhere; rank order identical under both) |
| 3 | PR term | **Coverage-gated redistribution** (extends the existing max=0 rule) |
| 4 | Segments | Champion raised to **≥80/≥80** (adoption/impact); producer/starter unchanged |
| 5 | Efficiency weights | **0.35 lps + 0.45 lines/$ + 0.20 cache** (variant B); composite axis weights unchanged (0.35/0.35/0.15/0.15) |
| 6 | Compactions "Deep Diver" badge | **Separate follow-up PR** (data already in `otel_reliability_daily.compactions`) |

## The model

### score() replaces normalize()

```ts
// shared/src/scoring/normalize.ts
export function score(value: number, target: number): number {
  if (target <= 0 || value <= 0) return 0;
  return Math.min(100, Math.sqrt(value / target) * 100);
}
```

Pure function of the user's own value. Saturates at the target — volume past the bar is worth
nothing (this is the anti-inflation property, and it cuts both ways by design).

### Targets

Volume targets are **per workday** and multiply by `max(1, workdaysBetween(from, to))`
(the `max(1,…)` guards weekend-only ranges, where workdays=0 would zero every score).
Ratio targets are flat. Defaults derived from this org's p90 rates, rounded; any org can
override via settings.

```ts
// shared/src/scoring/targets.ts (new)
export const DEFAULT_SCORE_TARGETS = {
  perWorkday: { sessions: 8, toolEvents: 50, linesAdded: 1400, commits: 7.5, pullRequests: 0.5 },
  flat:       { linesPerSession: 430, linesPerDollar: 48 },
} as const;
```

Stored override: `settings` table key `scoreTargets` (JSON, partial, zod-validated positive
numbers, deep-merged over defaults so a partial/bad value falls back instead of zeroing
anyone). Exposed through the existing `GET/PUT /api/settings` (`AppSettings.scoreTargets`, required with `DEFAULT_SCORE_TARGETS` as its default, so reads never need a null-check).
Admin UI editor is optional and NOT in scope; the API is enough for v1.

### Axes

Consistency (activeDays/workdays, capped), cacheRatio, and Trust are already absolute — unchanged.

```
Adoption   = 0.40·S(sessions, T) + 0.40·consistency + 0.20·S(toolEvents, T)
Impact     = w_lines·S(linesAdded, T) + w_commits·S(commits, T) + w_prs·S(pullRequests, T)
Efficiency = 0.35·S(lines/session, T) + 0.45·S(lines/$, T) + 0.20·(cacheRatio·100)
Trust      = clamp(acceptanceRate / 0.60, 0, 1) · 100          (unchanged)
Composite  = 0.35·Adoption + 0.35·Impact + 0.15·Efficiency + 0.15·Trust   (unchanged)
```

Low-confidence guards (sessions<10 halves Efficiency, toolEvents<20 halves Trust,
activeDays<3 withholds composite) — unchanged.

### Impact weight redistribution: coverage over a trailing-90d window

Today's rule fires only when org max PRs = 0. New rule, applied to both git-derived terms:

```
coverage(metric) = users with metric > 0 in [to-89, to] / users with sessions > 0 in [to-89, to]
coverage < 0.25 → that term's weight redistributes proportionally over the remaining terms
```

**The window is trailing-90d ending at the range's `to` — deliberately NOT the selected
range.** Review finding: range-based coverage would flip Impact weights as the user moves the
date picker (a 7-day view in a GitHub org has near-zero PR coverage). Trailing-90d makes the
weights a stable org fact. `linesAdded` never redistributes (always-present fallback).
This org today: PR coverage 16% → redistributed (Impact = 4/7 lines + 3/7 commits); commit
coverage 61% → kept. A GitHub org keeps all three terms.

Server side: one new usage-repo query returning `{activeUsers, usersWithPRs, usersWithCommits}`
for the 90d window; passed into the pure shared function as
`computeAxes(input, targets, coverage)`.

This is a bounded, documented population effect (an org-level structural switch), not
per-person rescaling; with 16% vs the 25% threshold, flapping is not a live risk, and the
90d window smooths it further.

### Baselines slim down

`Baselines` keeps only what badges use: p80/p90 percentile fields, the OTEL max* N/A-gate
fields, **and `maxPullRequests`** (the pr_machine badge's N/A gate reads it —
`badges.ts:50`). The six max* fields consumed solely by `computeAxes` (maxSessions,
maxToolEvents, maxLinesAdded, maxCommits, maxLinesPerSession, maxLinesPerDollar) are
dropped. Badges stay population-percentile **on purpose**: p80/p90 with absolute floors
(`max(p80, 5)` etc.) are robust — a single whale moves them negligibly, unlike max — and
self-calibration to org size is their documented contract.

### Segments

```ts
if (adoption >= 80 && impact >= 80) return 'champion';   // was 70/70
if (adoption >= 50 && impact >= 40) return 'producer';    // unchanged
if (adoption < 20) return 'starter';                      // unchanged
return 'explorer';
```

On live data: champions 2→5, producers 10→5, explorers 15, starters 2.

## Effects on live data (verified by simulation against the production API)

- Top of board: the top two swap (the session-count term ceases to dominate — raw session
  count was 14% of the composite with the org-max holder at 100 by definition), and three
  mid-board users gain ~15 points each — the correction for having been measured against a
  session count they never competed on.
- Org median composite: 63.7 → ~57 (sqrt is stricter than log at the middle of the range).
- Isolation holds: every axis score is a pure function of the user's own row + fixed targets
  (+ the 90d coverage switch, which no individual meaningfully controls).
- One-time deploy-day discontinuity: ~3 "new champion/producer" celebration cards fire once
  (`score_snapshots` diff); Top Movers is sessions-based and unaffected.

## Consumers & copy that MUST change with the code

The repo's documented promise is that displayed explanations can't drift from computed
numbers. Every place that says "log-normalized against org max":

- `shared/src/scoring/catalog.ts` — axis explainer (~line 209: "N() is a log-normalized score
  against the org max…") + any formula strings mentioning org max; the in-app Guide renders
  these.
- `README.md` "How scoring works" (~line 170).
- `docs/architecture.md` (~line 76).
- Segment copy if it states 70/70 anywhere in catalog/Guide.

Call-site inventory (verified by grep): `computeAxes`/`computeBaselines`/`segmentFor` are
called only from `server/src/services/scoring.ts`; `buildLeaderboardData` serves the
leaderboard, teams, users/profile, insights routes and nightly snapshots — all downstream of
the one call site. `normalize()` has no importer outside `scores.ts`.

## Testing

- Rewrite `shared/test/scoring.test.ts`: `score()` curve (0, half-target=70.7, target=100,
  2×target caps at 100), workday scaling + `max(1, workdays)` guard, coverage thresholds
  (0%, 24.9%, 25%, 100%) and weight redistribution, segment boundaries at 80/80,
  settings merge (partial + malformed JSON falls back to defaults).
- Fixture test: one realistic ScoringInput matrix asserting exact axis values (regression
  pin for the formulas).
- Server: usage-repo coverage query against a seeded DB; settings route round-trip for
  `scoreTargets`.

## Rollout

1. PR against upstream `zivhundert/claudedashboard` (stacked on `feat/value-badges` /
   PR #7, same as previous work). The PR notes that the change was calibrated and simulated
   on the author's own org and reorders the top of that board, the author's own rank
   included, so the reviewer judges the model on its merits. Upstream review is the merge
   gate. No individual data leaves the org — simulations stay internal.
2. Deploy to the VM per the established pattern (backup image + DB tar → deploy branch →
   verify live → rollback tag).
3. Deploy note to the org: scores are now vs fixed targets; medians drop ~7 points; nobody's
   raw counts changed.

## Follow-ups (explicitly out of scope here)

- **Deep Diver badge** (compactions): data already ingested per user/day in
  `otel_reliability_daily.compactions` (migration 006) and charted org-wide on Health.
  Follow-up PR: aggregate into `OtelRepo.perUserBadgeStats()`, add catalog entry + badge with
  absolute threshold calibrated on live data, N/A gate when the org has no telemetry.
  Framing: endurance flavor (like night_owl), not a value judgment.
- Bitbucket PR ingestion (would make PR counts true in this org, but mixes human PRs into a
  Claude-output axis — needs its own design).
- Trend arrow (▼43%) is last-14-vs-prior-14 *sessions* and inherits the granularity bias —
  candidate to re-base on toolEvents or lines.
