# Contributing

Thanks for helping improve Claude Code Insights! This page covers the local setup, where things live, and the change pattern the codebase expects.

## Setup

Prereqs: Node >= 20 and pnpm 9 (`corepack enable` or `npm i -g pnpm@9`).

```bash
git clone https://github.com/zivhundert/claudedashboard.git
cd claudedashboard
pnpm install
pnpm seed          # seed the demo database (30 devs, 5 teams, 180 days)
pnpm run dev:demo  # server :8080 + web :5173, no API keys needed
```

Demo mode is the recommended dev loop — deterministic data, no scheduler, no outbound API calls. Useful commands:

| Command | What it does |
| --- | --- |
| `pnpm run dev:demo` | dev servers on seeded demo data |
| `pnpm dev` | dev servers against real `.env` config |
| `pnpm seed` | reset + reseed `data/dashboard.db` (stop dev servers first — a running server holds the SQLite file) |
| `pnpm typecheck` | strict TS across all packages |
| `pnpm test` | unit tests (vitest, currently the scoring engine) |
| `pnpm build` | production build of all packages |

## Where things live (shared contracts first!)

This is a pnpm workspace of three packages, and the dependency arrow only points one way: `web` → `shared` ← `server`.

- **`shared/`** — the API contract (`src/types.ts`), the capability matrix (`src/capabilities.ts`), and the entire scoring engine (`src/scoring/`). **Every cross-package change starts here.** Server and web both import these types, so the compiler enforces the contract end to end.
- **`server/`** — Fastify routes (`src/routes/`), SQLite repos (`src/repos/`, the only SQL surface), migrations (`src/db/migrations/*.sql`, append-only), sync engine (`src/sync/`), OTLP receiver + privacy filter (`src/otel/`).
- **`web/`** — pages (`src/pages/`), shared cards (`src/components/`), typed fetch layer (`src/lib/api.ts`). View state belongs in the URL.

See [docs/architecture.md](docs/architecture.md) for the full tour.

## How to add a metric or telemetry pack

Follow the contract → server → web pattern:

1. **Contract** (`shared/`): add/extend the response type in `shared/src/types.ts`. If the metric is only available in some data-source modes, gate it in `shared/src/capabilities.ts`. If it affects scoring, change `shared/src/scoring/` and add cases to `shared/test/scoring.test.ts`; user-facing metric copy belongs in `scoring/catalog.ts` so the in-app Guide stays truthful.
2. **Server**: add a migration (`server/src/db/migrations/NNN_*.sql` — never edit an applied one), a repo method, and either a sync step (`src/sync/`) or an ingest handler. Telemetry-fed metrics must be wired through the ingest aggregators (`src/routes/otel.ts` for events, `src/otel/metrics.ts` for counters) so they respect the privacy filter and dedup; if a new attribute must survive, extend the policy in `src/otel/privacy.ts` deliberately, per privacy mode. Then expose it from a route in `src/routes/`.
3. **Web**: consume the shared type via `src/lib/api.ts` and render it. Gate on `/api/capabilities` (not on empty data), and honor the global date-range/granularity params.

The seeder (`server/scripts/seed.ts`) should learn to generate the new data too — demo mode is how contributors and screenshots exercise every feature.

## PR expectations

- `pnpm typecheck` and `pnpm test` green (CI runs both plus `pnpm build` on Node 20 and 22).
- No new dependencies without a note in the PR explaining why.
- Contract changes (`shared/`) shipped in the same PR as the server + web sides that use them.
- Keep migrations append-only, and keep secrets out — `.env` is gitignored, `.env.example` documents every variable with no real values.
- A screenshot or short clip for UI changes is appreciated (demo mode makes this easy).

For security issues, see [SECURITY.md](SECURITY.md) — please don't open public issues for those.
