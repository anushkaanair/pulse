# Pulse — market on your fingertips

A watchlist that doesn't just show prices — it tells you exactly what
**meaningfully changed** since you last looked, ranked by how unusual it is
for that specific stock, over a feed that behaves like a real one: delayed,
occasionally out of order, sometimes duplicated, sometimes corrected.

Built for **Code, by Groww**.

**Live demo (mock data, no backend needed):** _add your Vercel URL here_

## Why it's not just a price table

- **Exact checkpoints, not timestamps.** Every visit saves a precise
  snapshot of the prices you were actually shown. A feed that later
  rewrites the past can't rewrite what you saw.
- **Meaningful, not just big.** A move is a z-score against that stock's
  own trailing volatility, sector-adjusted against a simulated market-index
  proxy — a move fully explained by "the whole sector did this" isn't news.
- **Honest about a lying feed, on purpose.** The market simulator
  deliberately injects delay, duplicates, out-of-order ticks, and
  corrections. A monotonic SQL upsert means a late/duplicate tick can
  never regress a price. A correction to something already shown surfaces
  as a visible retraction, never a silent delete — and every user who saw
  the original change is told, not just whoever polls first.
- **Proven, not just tested.** `npm run torture` (in `backend/`) spawns the
  real server, drives load with injected faults, fires concurrent
  conflicting writes, **kills the server with SIGKILL mid-run**, respawns
  it, and checks 20+ invariants against an independent oracle. The exit
  code is the proof, not a claim.

Full reasoning for every non-obvious decision — including real bugs found
and fixed by the test suite itself — is in [`DECISIONS.md`](DECISIONS.md).
The resilience model is in [`RESILIENCE.md`](RESILIENCE.md). Frontend
design tokens and conventions are in [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md).

## Project structure

```
backend/                 Express + TypeScript + Postgres
  src/market/             fault-injecting simulator + shared ingestor
  src/changes/             the engine — significance, ranking, digest (pure, unit-tested)
  src/routes/              HTTP layer
  src/middleware/          identity, error shape, rate limiting
  src/db/migrations/       schema, applied via `npm run migrate`
  scripts/torture.ts       the invariant proof — see above
  scripts/scale-check.ts   load/scale measurements that motivated several fixes

frontend/                Next.js (App Router) + TypeScript + Tailwind CSS 4
  src/app/                 "/" homepage, "/app" (redirects to your watchlist),
                            "/w/[id]" (the actual dashboard), "/dev/faults" (dev panel)
  src/components/          AttentionDeck, MarketRail, InvestmentsCard, WatchlistRow, ...
  src/lib/api.ts            typed API client + a self-contained mock data layer
  tests/e2e/                Playwright specs (run against the mock layer)

DECISIONS.md, RESILIENCE.md, DESIGN_SYSTEM.md, PITCH.md   project docs
docker-compose.yml                                         local Postgres for the backend
```

## Quick start

Requires Node 20+. Docker only if you want the real backend.

### Frontend only (mock data, zero setup — matches the live demo)

```bash
cd frontend
npm install
echo "NEXT_PUBLIC_USE_MOCK=true" > .env.local
npm run dev          # http://localhost:3000
```

### Full stack (real simulated market, real Postgres)

```bash
# 1. Database
docker compose up -d
cd backend && npm install
npm run migrate
npm run dev                          # http://localhost:4000

# 2. Frontend, in a second terminal
cd ../frontend && npm install
cp .env.local.example .env.local     # NEXT_PUBLIC_API_URL=http://localhost:4000
npm run dev                          # http://localhost:3000
```

Check the backend's alive: `curl localhost:4000/health` should return
`{"status":"ok", ...}` within ~1s.

### Prove it's correct

```bash
cd backend
npm test              # unit + integration tests for the engine, routes, hardening
npm run torture        # the real proof — spawns the server, injects faults, SIGKILLs it mid-run
```

```bash
cd frontend
npx tsc --noEmit
npm run build
npm run test:e2e       # Playwright, against the mock data layer
```

## Demo the resilience live (full-stack mode)

```bash
curl -X POST localhost:4000/api/_sim/faults \
  -H "Content-Type: application/json" \
  -d '{"outage":true}'
```

Watch the UI degrade honestly (stale badges, feed status banner) instead of
breaking or lying about freshness. Clear it with `{"outage":false}`.

## What's actually built

- **Homepage → dashboard.** `/` is the marketing landing page (live NIFTY +
  derived-index ticker, single "Get started" CTA, no auth). `/app` redirects
  straight to your watchlist (creating one on first visit).
- **The attention deck** — the ranked "what deserves your attention" list as
  a real 3D card stack, compact at rest, expanding on click. Plain-language
  move labels lead ("Unusual move"), with σ kept as a secondary detail.
- **Live market rail** — the real simulated NIFTY index plus a scrolling
  ticker of whatever a watchlist actually tracks. SENSEX/BANKNIFTY/
  MIDCPNIFTY/FINNIFTY are shown too, derived from NIFTY's real tick
  (correlated, not fabricated), since only NIFTY is independently simulated.
- **Notional investments card** — no real brokerage concept exists, so
  rather than draw a fake portfolio this treats the watchlist as a notional
  ₹1,000-per-stock basket priced off real live quotes, clearly marked with
  a persistent "Paper" badge, benchmarked against real live NIFTY.
- **Honest about a lying feed** in the UI too — stale quotes are labelled,
  never hidden; a degraded feed shows a visible banner, never a blank
  screen.

## Environment variables

Backend (`backend/.env.example`): `DATABASE_URL`, `PORT`, `TICK_MS`,
`SIM_SEED`, `SIM_ADMIN` (fault-injection endpoint — off unless explicitly
enabled), `STALE_AFTER_SECONDS`, `HISTORY_RETENTION_DAYS`/`HISTORY_PRUNE_MS`
(quote-history pruning), `RATE_LIMIT_RPM`/`RATE_LIMIT_BURST`, `CORS_ORIGINS`,
`MAX_HORIZON_HOURS`, and the "meaningful" thresholds (`Z_THRESHOLD`,
`HISTORY_WINDOW`, `ABS_THRESHOLD_PCT`, `VOLUME_SPIKE_MULTIPLE`, `GAP_PCT`) —
all documented inline, all product decisions rather than magic numbers.

Frontend (`frontend/.env.local.example`): `NEXT_PUBLIC_API_URL` (default
`http://localhost:4000`), `NEXT_PUBLIC_USE_MOCK` (`true` runs entirely
against the mock layer, no backend needed — this is what the live demo
uses), `NEXT_PUBLIC_SIM_ADMIN` (shows the `/dev/faults` panel).

## Known limitations (deliberate)

No real authentication (an `X-User-Id`-style header/local id only), no
WebSockets (polling + ETag by design — the problem this project targets is
state-on-return, not live ticking), no real broker/exchange feed by default
(the fault-injecting simulator is the point — it makes "unreliable
dependency" demoable on command), no historical charts beyond the visit
timeline, no multi-user sharing. Rate limiting and the checkpoint-
idempotency/stats caches are single-process by design — see
`RESILIENCE.md` for the tradeoff.
