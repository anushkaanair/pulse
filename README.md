# Smart Market Watchlist

A watchlist that doesn't just show prices — it tells you exactly what
**meaningfully changed** since you last looked, ranked by how unusual it is
for that specific stock, over a feed that behaves like a real one: delayed,
occasionally out of order, sometimes duplicated, sometimes corrected.

Full reasoning: [`INTERPRETATION.md`](INTERPRETATION.md) (what and why),
[`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md) (architecture, schema, API
contract, edge cases), [`DECISIONS.md`](DECISIONS.md) (every non-obvious
choice, including three bugs found and fixed by the test suite itself).

## Quick start

Requires Node 20+, Docker, npm.

```bash
# 1. Database
docker compose up -d
cd backend && npm install

# 2. Migrate + run
npm run migrate
npm run dev          # http://localhost:4000

# 3. Frontend, in a second terminal
cd ../frontend && npm install
npm run dev           # http://localhost:3000
```

Check it's alive: `curl localhost:4000/health` should return
`{"status":"ok", ...}` once the simulated feed has ticked at least once
(within ~1s).

### Prove it's correct

```bash
cd backend
npm test              # unit tests for the change-ranking engine
npm run torture       # the real proof — see below
```

`npm run torture` spawns the actual server, drives tens of thousands of
ticks with injected out-of-order/duplicate/corrected data, fires concurrent
conflicting writes, **kills the server with SIGKILL mid-run**, respawns it,
and checks 21 invariants — idempotency, monotonic price ordering, conflict
resolution, diff correctness against an independent oracle, checkpoint
exactness, staleness honesty through a real outage, and crash safety. It's
designed to be run live, not just trusted: the exit code is the proof.

## Architecture, in one paragraph

One shared ingestor polls the union of every watched symbol once (not once
per user) from a fault-injecting market simulator, writing to Postgres with
a monotonic upsert so a late or duplicate tick can never regress a price.
Each user's "what changed" is computed **on read**, diffed against a
`snapshots` row capturing exactly what they were shown last time — not a
timestamp, so it's immune to the feed later rewriting the past. "Meaningful"
is a z-score against the stock's own trailing volatility, scaled by how long
the user's been away, with a per-symbol quiet/normal/loud override. Full
diagram and schema: [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md) §3–5.

## Project structure

```
backend/                 Express + TypeScript + Postgres
  src/market/            fault-injecting simulator + ingestor
  src/changes/           the engine — significance, ranking, digest (pure, unit-tested)
  src/routes/            HTTP layer
  src/db/migrations/     schema, applied on `npm run migrate`
  scripts/torture.ts     the invariant proof — see above
frontend/                Next.js + TypeScript + Tailwind
docs (repo root)          interpretation, full spec, design system, decisions
```

## Environment variables

Backend (`backend/.env.example`): `DATABASE_URL`, `PORT` (default 4000),
`TICK_MS`, `SIM_SEED`, `SIM_ADMIN` (exposes fault-injection endpoint),
`STALE_AFTER_SECONDS`, and the "meaningful" thresholds (`Z_THRESHOLD`,
`HISTORY_WINDOW`, `ABS_THRESHOLD_PCT`, `VOLUME_SPIKE_MULTIPLE`, `GAP_PCT`) —
all documented inline, all product decisions rather than magic numbers.

Frontend (`frontend/.env.local`): `NEXT_PUBLIC_API_URL` must point at the
backend (default `http://localhost:4000`), `NEXT_PUBLIC_USE_MOCK` toggles
the mock data layer, `NEXT_PUBLIC_SIM_ADMIN` shows the fault-injection dev
panel.

## Demo the resilience live

With both servers running:

```bash
curl -X POST localhost:4000/api/_sim/faults \
  -H "Content-Type: application/json" \
  -d '{"outage":true}'
```

Watch the UI degrade honestly (stale badges, feed status banner) instead of
breaking or lying about freshness. Clear it with `{"outage":false}`.

## Known limitations (deliberate — see `IMPLEMENTATION_PLAN.md` §7)

No real authentication (`X-User-Id` header only), no WebSockets (polling +
ETag by design — the problem is state-on-return, not live ticking), no real
broker/exchange feed by default (the fault-injecting simulator is the point
— it makes "unreliable dependency" demoable on command), no historical
charts, no multi-user sharing.
