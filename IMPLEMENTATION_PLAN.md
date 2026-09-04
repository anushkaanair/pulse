# Implementation Plan — Smart Market Watchlist

Spec for two agents. Claude builds `/backend` against sections 4–6 and 8.
Codex builds `/frontend` against section 5 and 9. Section 5 is the frozen
contract; changing it is a logged decision in `DECISIONS.md`, not a drive-by.

## 1. Interpretation & the bet we're making

The brief says "track stocks" but grades "what has meaningfully changed since
they last checked." Those are different products. The first is a price table.
The second is a **per-user diff engine over an unreliable data feed**, with a
definition of "meaningful" that a user can trust and an engineer can defend.

Three sentences of interpretation:

1. "Since they last checked" is a **checkpoint**, not a timestamp — the system
   must remember *what the user actually saw*, and diff against that, even if
   the feed later delivered late, duplicate, out-of-order, or corrected data.
2. "Meaningful" is **relative to the stock's own behaviour**, not an absolute
   threshold: a 2% move in a stock that moves 0.4%/day is news; the same 2% in
   a stock that moves 4%/day is noise. We compute significance (z-score
   against trailing volatility) plus discrete events (high/low breached,
   volume anomaly, gap), and rank by it.
3. "Stale, delayed or conflicting data" is the **unreliable dependency** the
   rubric calls out. We never present stale as fresh, never let an old tick
   overwrite a newer one, and surface data age honestly in the UI.

The bet: judges reward a narrow system that is *provably correct* about
"what changed" under a hostile feed, over a broad one with more screens.

## 2. The centerpiece — what makes this defensible

**Invariant:** *The changes shown to a user are exactly the delta between the
snapshot they last acknowledged and the current best-known state — and the
system never presents stale data as fresh, never regresses a quote to an older
tick, and never double-counts a duplicate.*

Mechanically:

- Every quote carries `as_of` (exchange time) and `received_at` (our clock).
  Stored state advances only when `as_of` is newer → **monotonic upsert
  enforced in SQL**, not in application code.
- A checkpoint stores a **snapshot of the quotes as rendered** (`jsonb`), not
  a timestamp. Diffs never depend on history retention and are immune to
  late-arriving data changing the past.
- "Seen" semantics are exact: `GET /changes` returns a `snapshotId`; the
  client promotes *that* snapshot with `POST /checkpoint`. What the user
  acknowledged is what they were shown — no race between render and mark.
- Staleness is a per-symbol computed field (`now - as_of > threshold`), and
  feed health is exposed on `/health`. Degraded is a first-class state.

The torture test (section 10) proves all of this under fault injection.

## 3. Architecture overview

```
                 ┌──────────────────────────────────────────────┐
                 │  MarketDataProvider (interface)              │
                 │   ├─ SimulatedProvider (default, fault knobs)│
                 │   └─ (optional) real adapter, same interface │
                 └───────────────┬──────────────────────────────┘
                                 │ ticks {symbol, price, as_of, seq, ...}
                                 ▼
   union of all watchlist   ┌──────────┐   monotonic upsert     ┌────────────┐
   symbols (dedup across ──▶│ Ingestor │ ─────────────────────▶ │  Postgres  │
   users; poll once/symbol) └──────────┘   + history append     │ quotes     │
                                                                │ history    │
   ┌─────────────┐  GET /changes                                │ watchlists │
   │  Next.js UI │ ───────────────▶ ┌──────────────┐  reads     │ checkpoints│
   │  (Codex)    │ ◀─────────────── │ ChangeEngine │ ◀───────── └────────────┘
   └─────────────┘  ranked diff +   │  σ, z-score, │
          │         snapshotId      │  events,rank │
          │ POST /checkpoint        └──────────────┘
          └────────────────────────▶ promotes snapshotId → checkpoint
```

- **Backend:** Node 20 / TypeScript / Express / Postgres (`pg`), `zod` for
  validation, `pino` logs. Cherry-pick from `../groww-code-hackathon/scaffold/backend`.
- **Ingestion is shared, not per-user.** Symbols are polled once regardless
  of how many users watch them — this is the scaling answer for "more users."
- **Diff is computed on read** against the user's checkpoint snapshot. No
  per-user background jobs. Scales with reads, which are cheap and cacheable.
- **Frontend:** Next.js App Router / TypeScript / Tailwind. Polling with
  `If-None-Match`/ETag on `/changes`. No WebSockets (see scope cuts).
- **Identity:** `X-User-Id` header. No auth (scope cut, documented).

## 4. Database schema

```sql
CREATE TABLE symbols (
  symbol      text PRIMARY KEY,
  name        text NOT NULL,
  exchange    text NOT NULL DEFAULT 'NSE'
);

CREATE TABLE watchlists (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     text NOT NULL,
  name        text NOT NULL,
  version     integer NOT NULL DEFAULT 1,      -- optimistic concurrency
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON watchlists (user_id);

CREATE TABLE watchlist_items (
  watchlist_id uuid NOT NULL REFERENCES watchlists(id) ON DELETE CASCADE,
  symbol       text NOT NULL REFERENCES symbols(symbol),
  added_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (watchlist_id, symbol)           -- idempotent add, no dupes
);

CREATE TABLE quotes (
  symbol       text PRIMARY KEY REFERENCES symbols(symbol),
  price        numeric(14,4) NOT NULL CHECK (price > 0),
  prev_close   numeric(14,4),
  day_high     numeric(14,4),
  day_low      numeric(14,4),
  volume       bigint NOT NULL DEFAULT 0 CHECK (volume >= 0),
  as_of        timestamptz NOT NULL,           -- exchange time
  received_at  timestamptz NOT NULL DEFAULT now(),
  seq          bigint NOT NULL,                -- provider sequence
  corrected    boolean NOT NULL DEFAULT false,
  source       text NOT NULL
);
-- Monotonic upsert (the invariant lives here, not in JS):
--   INSERT ... ON CONFLICT (symbol) DO UPDATE SET ...
--   WHERE quotes.as_of < EXCLUDED.as_of
--      OR (quotes.as_of = EXCLUDED.as_of AND quotes.seq < EXCLUDED.seq)

CREATE TABLE quote_history (
  symbol   text NOT NULL REFERENCES symbols(symbol),
  as_of    timestamptz NOT NULL,
  price    numeric(14,4) NOT NULL,
  volume   bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (symbol, as_of)                  -- duplicate ticks are no-ops
);

CREATE TABLE snapshots (                        -- candidate "what was shown"
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      text NOT NULL,
  watchlist_id uuid NOT NULL REFERENCES watchlists(id) ON DELETE CASCADE,
  taken_at     timestamptz NOT NULL DEFAULT now(),
  payload      jsonb NOT NULL                  -- {symbol: {price, as_of, volume, day_high, day_low}}
);
CREATE INDEX ON snapshots (user_id, watchlist_id, taken_at DESC);

CREATE TABLE checkpoints (                      -- promoted snapshot = "seen"
  user_id      text NOT NULL,
  watchlist_id uuid NOT NULL REFERENCES watchlists(id) ON DELETE CASCADE,
  snapshot_id  uuid NOT NULL REFERENCES snapshots(id),
  taken_at     timestamptz NOT NULL,
  PRIMARY KEY (user_id, watchlist_id)          -- exactly one "last seen"
);
```

Checkpoints are keyed by **user**, not device → state persists across devices
by construction. Old `snapshots` rows can be pruned by a cron; not needed for
the hackathon.

## 5. API contract

All responses JSON. Errors: `{ "error": string, "code": string }`.
Identity: `X-User-Id: <string>` required on every `/api/*` route (400 if
missing). All money as strings of decimals (`"1523.4500"`), never floats.

```
GET  /health
  200 { status:"ok"|"degraded", db:"connected"|"unreachable",
        feed:{ status:"live"|"stale"|"down", lastTickAt:iso|null, lagSeconds:number|null } }

GET  /api/symbols?q=TCS
  200 [ { symbol, name, exchange } ]

POST /api/watchlists
  body { name }
  201 { id, name, version, items:[] }

GET  /api/watchlists
  200 [ { id, name, version, itemCount, updatedAt } ]

GET  /api/watchlists/:id
  200 { id, name, version, items:[ { symbol, name, quote: Quote|null, stale:boolean } ] }
  404 NOT_FOUND

POST /api/watchlists/:id/items          -- idempotent add
  body { symbol }
  200 { id, version, items:[...] }      -- 200 even if already present
  404 NOT_FOUND | 422 UNKNOWN_SYMBOL

DELETE /api/watchlists/:id/items/:symbol
  200 { id, version, items:[...] }      -- 200 even if already absent

PUT  /api/watchlists/:id/items          -- bulk replace with concurrency check
  body { symbols:[...], version }
  200 { id, version, items:[...] }
  409 VERSION_CONFLICT { error, code, current:{ version, items } }

GET  /api/watchlists/:id/changes?limit=20
  200 {
    snapshotId,                          -- promote this to mark as seen
    baseline: { takenAt:iso, kind:"checkpoint"|"first-visit" },
    asOf: iso,                           -- newest as_of across items
    feed: { status, lagSeconds },
    summary: { meaningful:number, total:number, stale:number, newSinceLast:number },
    items: [ {
      symbol, name,
      quote: Quote, stale:boolean,
      change: {
        kind: "move"|"event"|"new"|"none",
        pctSincePrev: string|null,       -- "+2.13"
        zScore: number|null,             -- move / trailing σ
        events: ["DAY_HIGH_BREACHED"|"DAY_LOW_BREACHED"|"VOLUME_SPIKE"|"GAP"|"CORRECTED"],
        confidence: "high"|"low",        -- low if insufficient history for σ
        attention: number,               -- ranking score
        why: string                      -- "Moved −3.1%, unusual for TCS (2.8σ)"
      }
    } ]                                  -- sorted by attention desc; "none" last
  }
  404 NOT_FOUND

POST /api/watchlists/:id/checkpoint
  body { snapshotId }
  201 { takenAt }
  404 SNAPSHOT_NOT_FOUND | 409 SNAPSHOT_MISMATCH (belongs to another user/list)

GET  /api/quotes?symbols=TCS,INFY
  200 [ Quote ]

Quote = { symbol, price, prevClose, dayHigh, dayLow, volume,
          asOf:iso, receivedAt:iso, ageSeconds:number, stale:boolean,
          corrected:boolean, source }

-- Demo/fault injection (only when SIM_ADMIN=true):
POST /api/_sim/faults
  body { outage?:boolean, delayMs?:number, outOfOrderPct?:number,
         duplicatePct?:number, correctionPct?:number }
  200 { active:{...} }
```

**"Meaningful" definition (documented, configurable via env):**
- Move `r = (price − snapshotPrice) / snapshotPrice`.
- Trailing σ = stdev of tick-to-tick returns over last `HISTORY_WINDOW`
  (default 50) history rows; `z = r / σ`.
- `kind="move"` if `|z| ≥ Z_THRESHOLD` (default 2.0). If fewer than 20
  history rows: fall back to `|r| ≥ 1.5%`, `confidence="low"`.
- Events add to attention regardless of z: `DAY_HIGH_BREACHED` / `_LOW_`
  (+1.0), `VOLUME_SPIKE` (volume > 2× trailing mean, +0.8), `GAP` (open vs
  prevClose > 2%, +0.6), `CORRECTED` (+0.5, always surfaced).
- `attention = |z| + Σ eventBonus`. `kind="none"` when nothing fires —
  **"nothing meaningful changed" is a real, honest state we show.**
- `kind="new"` for symbols added after the checkpoint (no fake baseline).

## 6. Edge cases & how each is handled

| # | Edge case | Handling |
|---|-----------|----------|
| 1 | Out-of-order tick (older `as_of` arrives after newer) | Monotonic upsert `WHERE quotes.as_of < EXCLUDED.as_of` → silently ignored. History still records it (correct: it *did* happen at that time). |
| 2 | Duplicate tick (same symbol, same `as_of`, same `seq`) | `quote_history` PK is a no-op; `quotes` upsert condition false → no change. |
| 3 | Late correction (same `as_of`, higher `seq`) | Accept, set `corrected=true`, event `CORRECTED` surfaced in UI. Users deserve to know a number they saw was revised. |
| 4 | Feed outage / delay | Per-symbol `stale = ageSeconds > STALE_AFTER` (default 90s). `/health.feed.status` degrades. `/changes` still works — based on last-known-good, and says so (`asOf`). Never blank the screen, never pretend it's live. |
| 5 | Two devices edit the same watchlist | `PUT /items` carries `version`; loser gets `409` with `current`. Frontend shows a merge prompt, not a silent overwrite. Item-level `POST`/`DELETE` are idempotent and don't need version. |
| 6 | Checkpoint vs. render race | `/changes` mints a `snapshotId` for the exact payload rendered; `/checkpoint` promotes *that id*. Marking-as-seen can never reference state the user didn't see. |
| 7 | Symbol added after last checkpoint | `kind="new"`, not a fabricated change against a nonexistent baseline. |
| 8 | Symbol removed since checkpoint | Excluded from diff; no ghost rows. |
| 9 | First visit (no checkpoint) | `baseline.kind="first-visit"`, all `kind="none"`, snapshotId still minted so the *next* visit has a baseline. |
| 10 | Insufficient history for σ | Absolute-threshold fallback, `confidence="low"` shown in UI. Honest, not silent. |
| 11 | Large watchlist (500 symbols) / many users | Ingestor polls the *union* of symbols once; `/changes` ranks server-side and paginates (`limit`); σ computed from a bounded window with an index on `(symbol, as_of)`. |
| 12 | Clock skew between feed and server | Staleness uses `as_of` vs server `now()`; `received_at` recorded separately so lag is measurable, not guessed. |
| 13 | DB down | `/health.db="unreachable"` → 503; API returns `503 DB_UNAVAILABLE`, UI shows a banner with last successful data time. |
| 14 | Process killed mid-ingest | All writes are single-statement upserts or short transactions; constraints hold on restart. Torture test kills the process and re-asserts. |

## 7. Explicit scope cuts

- **No real auth.** `X-User-Id` header. Auth is orthogonal to the graded
  problem; a JWT layer would be 3 hours that proves nothing.
- **No WebSockets / push.** The brief's core question is *state on return*,
  not live ticking. Polling + ETag is simpler, cacheable, and easier to reason
  about under failure. Logged as a deliberate trade-off.
- **No real broker/exchange API as the default.** A fault-injecting simulator
  is the default provider because it makes "unreliable dependency" *testable
  and demoable*. The provider interface leaves the door open. A real free
  API is fragile in a demo and can't be made to misbehave on command.
- **No ML / news / sentiment.** "Meaningful" is statistical and explainable
  in one sentence. Explainability is the feature.
- **No sharing, collaboration, or multiple users per watchlist.**
- **No mobile app.** Responsive web is enough.
- **No historical charts.** The product is the diff, not a chart.

## 8. CLAUDE — backend task list

Build in this order; each step leaves the server runnable.

1. `backend/package.json`, `tsconfig.json`, `.env.example` — cherry-pick from
   scaffold. Add `node-pg-migrate`.
2. `backend/src/db/migrations/001_init.sql` — section 4 verbatim.
3. `backend/src/db/pool.ts`, `src/logger.ts`, `src/middleware/errorHandler.ts`,
   `src/middleware/userId.ts` (400 if header missing) — from scaffold + new.
4. `backend/src/market/provider.ts` — `MarketDataProvider` interface:
   `subscribe(symbols) → AsyncIterable<Tick>`, `setFaults(config)`.
5. `backend/src/market/simulatedProvider.ts` — seeded PRNG, per-symbol drift +
   volatility (assign realistic σ per symbol), emits ticks every
   `TICK_MS`. Fault knobs: `outage`, `delayMs`, `outOfOrderPct`,
   `duplicatePct`, `correctionPct`. Deterministic with a seed → torture test
   is reproducible.
6. `backend/src/market/ingestor.ts` — reads ticks, monotonic upsert into
   `quotes`, insert-ignore into `quote_history`. Tracks `lastTickAt` for
   `/health`. Symbol set = union of all `watchlist_items` (refresh every 10s).
7. `backend/src/routes/health.ts` — db + feed status.
8. `backend/src/routes/symbols.ts` — seed ~60 NSE names in migration `002_seed.sql`.
9. `backend/src/routes/watchlists.ts` — CRUD, idempotent item add/remove,
   versioned bulk `PUT` with `409`.
10. `backend/src/changes/stats.ts` — trailing σ, mean volume, from history.
11. `backend/src/changes/engine.ts` — pure function:
    `(snapshot, quotes, stats, config) → ChangeItem[]`. No I/O. Unit-test it.
12. `backend/src/routes/changes.ts` — load checkpoint (or first-visit), load
    quotes+stats, run engine, mint `snapshots` row, return. ETag = hash of
    `(snapshotId, asOf)`.
13. `backend/src/routes/checkpoint.ts` — promote snapshot; verify ownership.
14. `backend/src/routes/sim.ts` — fault endpoint, gated by `SIM_ADMIN`.
15. `backend/src/__tests__/engine.test.ts` — z-score, fallback, events, new/none.
16. `backend/src/__tests__/ingest.test.ts` — out-of-order, dup, correction
    against a real Postgres (testcontainers or local DB).
17. `backend/scripts/torture.ts` — section 10.
18. `docker-compose.yml` (Postgres only) + root `README.md` setup section.

Ship step 1–3 + a static `fixtures/changes.json` matching section 5 within
**H2** so Codex has real shapes before the backend is live.

## 9. CODEX — frontend task list

Stack: Next.js (App Router), TypeScript, Tailwind. All calls through one
typed client. Never invent fields — section 5 is the source of truth.

1. `frontend/` scaffold: `create-next-app`, Tailwind, ESLint. `.env.local`
   with `NEXT_PUBLIC_API_URL`. `npm run build` clean.
2. `src/lib/api.ts` — typed client for every endpoint in section 5. Sends
   `X-User-Id` from `localStorage` (generate a UUID on first load; expose a
   "switch user" dev control so cross-device persistence can be demoed).
3. `src/lib/mock.ts` — mock layer returning `fixtures/*.json` shapes until
   the backend is live (`NEXT_PUBLIC_USE_MOCK=true`).
4. `app/page.tsx` — watchlist index: list, create, empty state.
5. `app/w/[id]/page.tsx` — the main screen, two zones:
   - **"Since you last looked"** panel (top): from `/changes`. Shows
     `baseline`, `summary`, ranked cards with `why`, `zScore` badge, event
     chips, `confidence="low"` marker, `CORRECTED` flag. "Nothing meaningful
     changed" is a designed state, not an empty div. Button: **"Mark as
     seen"** → `POST /checkpoint { snapshotId }`.
   - **Full list** below: every item with price, `pctSincePrev`, `stale`
     badge showing `ageSeconds`, remove action.
6. `components/StaleBadge.tsx`, `ChangeCard.tsx`, `FeedStatusBar.tsx`
   (reads `/health` + `changes.feed`; degraded → persistent banner "Data as
   of HH:MM, feed delayed").
7. Add-symbol flow: search `/api/symbols?q=` → `POST /items`. Handle `422`.
8. Conflict flow: bulk edit uses `PUT` with `version`; on `409` show a
   modal with "their version vs yours" and a re-apply button.
9. Polling: `/changes` every 15s with `If-None-Match`; pause when tab hidden.
10. States for every screen: loading, error (`{error, code}` shape), empty,
    first-visit, stale, degraded, conflict.
11. `app/dev/faults/page.tsx` — toggles for `POST /_sim/faults` (only
    rendered when `NEXT_PUBLIC_SIM_ADMIN=true`). This is the demo weapon:
    flip "outage" live and show the UI degrade honestly.
12. Large list: virtualize the full list (`@tanstack/react-virtual`) once
    >100 items; keep the top panel capped by `limit`.
13. `tests/e2e/` (Playwright): happy path; first-visit → change → mark seen →
    no changes; 409 conflict; stale badge during outage.

Adversary passes on the backend at ~H9 and ~H20 (prompt in
`../groww-code-hackathon/docs/CODEX_PROMPT.md`).

## 10. The torture test

`backend/scripts/torture.ts`, runnable with `npm run torture`. Uses the
simulator with a fixed seed so the run is reproducible.

Setup: 3 users, 3 watchlists, 50 symbols each (union = 80 symbols).
User A calls `/changes`, gets `snapshotId`, promotes it. Record the
snapshot payload as the **oracle baseline**.

Drive: 10,000 ticks with faults `{ outOfOrderPct:20, duplicatePct:10,
correctionPct:5 }`, plus one 45-second `outage`. Concurrently:
- 20 parallel `GET /changes` for user A, continuously.
- 5 parallel `PUT /items` from "two devices" with the *same* `version`.
- At tick ~5,000, `kill -9` the server, restart it, keep driving.

Assert, at the end and after restart:
1. **Monotonic:** for every symbol, `quotes.as_of` = max `as_of` emitted,
   and `price` = the highest-`seq` tick at that `as_of`. No regressions.
2. **No duplicates:** `count(quote_history)` = number of *distinct*
   `(symbol, as_of)` emitted.
3. **Corrections surfaced:** every symbol that received a correction has
   `corrected=true` and `CORRECTED` in its `/changes` events.
4. **Concurrency:** exactly one `PUT` per `version` returned `200`; all
   others `409` with a `current.version` equal to the winner's.
5. **Diff correctness (the invariant):** an independent oracle computes
   `(finalPrice − baselinePrice)/baselinePrice` per symbol from the recorded
   baseline and the DB; it must equal `pctSincePrev` from `/changes` for
   every symbol, to 4 decimals. Symbols added mid-run are `kind="new"`.
6. **Staleness honesty:** during the outage window, ≥ 95% of symbols were
   `stale=true` in at least one `/changes` response and `/health.feed.status`
   was `"stale"` or `"down"`; after recovery, `stale=false` within 2 polls.
7. **Checkpoint exactness:** after promoting a fresh `snapshotId`, the very
   next `/changes` has `summary.meaningful = 0` against that baseline.
8. **Crash safety:** assertions 1–2 hold after the `kill -9`/restart.

Exit non-zero on any failure. Print a one-screen report. This script, run
live in the demo, is the answer to "how do you know it's correct?"

---

### Roadmap (≈30h; H0 = now). Score of the previous draft, then the revision.

Previous draft scored against the rubric: Depth 3 (generic backend, no
centerpiece), Interpretation 2 (no angle yet — couldn't have one), Edge cases
4 (torture-test idea is right), Quality 3, Originality 2. This plan targets
5/4/5/4/4 — the interpretation and the diff engine are where the points moved.

| Window | Claude (backend) | Codex (frontend) |
|---|---|---|
| H0–H1 | Commit `INTERPRETATION.md` + this file. Migration 001. | Scaffold Next.js, typed client, mock layer. |
| H1–H2 | Scaffold cherry-pick, `/health`, `fixtures/changes.json`. | Watchlist index + create + empty state. |
| H2–H6 | Provider iface, simulator w/ faults, ingestor w/ monotonic upsert, symbols + watchlists routes. | Main screen skeleton on mocks: list, stale badge, add/remove. |
| H6–H9 | `stats.ts`, `engine.ts` + unit tests, `/changes`, `/checkpoint`, ETag. | "Since you last looked" panel, mark-as-seen, first-visit + none states. |
| H9–H10 | Integrate: swap Codex to real API, fix contract drift. **Adversary pass #1.** | Same. |
| H10–H16 | Sleep. | Sleep. |
| H16–H20 | `torture.ts`; fix everything it finds. Ingest tests. | Conflict modal (409), feed status bar, faults dev page, virtualization. |
| H20–H22 | README, DECISIONS, 100-word pitch. Fresh-clone test. **Adversary pass #2.** | Playwright e2e, build clean. |
| **H22** | **Safety-net submit** (1,000-cap). | — |
| H22–H28 | Scale check (500 symbols / 50 users), polish `why` strings, prune. | Visual polish, empty-state copy, responsive. |
| H28–H30 | Final fresh-clone test, final submit with buffer. | — |
