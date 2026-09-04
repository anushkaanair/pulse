# Resilience — the guarantees, named

Every claim below is backed by a specific, runnable check — most of them in
[`backend/scripts/torture.ts`](backend/scripts/torture.ts) (`npm run
torture`), which spawns the real server, drives concurrent load against a
hostile feed, kills it with `SIGKILL` mid-run, and checks the result against
an independently-computed oracle, not the engine's own numbers. This exists
so "why should I believe this is correct" has an answer better than "the
tests pass" — you can name the guarantee, then go watch it get checked live.

## The invariants

1. **A late or duplicate tick can never regress a stored quote.**
   `quotes` is written through a monotonic SQL upsert keyed on `as_of`
   ([`ingestor.ts`](backend/src/market/ingestor.ts)) — an older tick simply
   loses the `WHERE` clause, it never overwrites. Checked live: the torture
   test injects 20% out-of-order and 10% duplicate ticks, then asserts
   `ingest.received > ingest.applied` (some were correctly rejected) *and*
   that no symbol's `quotes.as_of` ever trails behind its own
   `quote_history` — i.e., time never moves backward for any symbol, even
   under a hostile feed.

2. **A correction updates the price, not the record of what was shown.**
   `quote_history` is append-only; a correction lands as a new row with
   `corrected=true` rather than rewriting the old one. This is what makes
   "what did the user actually see" an answerable question after the feed
   revises itself — see the second-clock work below, which depends on this.

3. **Checkpoint commit is atomic with the change set it was computed from.**
   A checkpoint doesn't promote "the current price" — it promotes the exact
   `snapshotId` that was shown to the user (`POST /checkpoint` takes a
   `snapshotId`, not a bare "mark seen"). If the feed moves between viewing
   and confirming, the checkpoint still refers to what was actually on
   screen, not whatever landed a moment later. Checked live: after every
   checkpoint promotion, the torture test re-polls `/changes` and asserts
   every item flagged `"meaningful"` has a quote strictly newer than the
   checkpoint's own `takenAt` — i.e. nothing gets flagged as new just
   because of a race between minting and promoting the snapshot.

4. **No visible number is ever computed from data older than the last thing
   the engine itself produced for that request.** `/changes` computes
   `asOf` as the max tick timestamp actually used in that response — the
   feed-status banner and every row's staleness are derived from *that*
   value, not from a separately-cached "last known good" timestamp that
   could silently drift from what's on screen.

5. **A concurrent write conflict always has exactly one winner, and every
   loser agrees on who won.** Bulk edits use optimistic concurrency
   (`version` field); a stale write gets `409` with the *current* winning
   state attached, not a merge guess. Checked live: 5 parallel `PUT`s at
   the same version — exactly one succeeds, the other four all report the
   same winning version in their conflict body.

6. **An outage never blanks the screen, and staleness is never hidden.**
   During a simulated feed outage the torture test asserts `/changes` keeps
   returning `200` with every previously-tracked item still present, and
   every item is honestly flagged `stale`, not silently served as fresh.

7. **Diff correctness holds against an independent oracle, not the engine's
   own math.** The torture test computes each symbol's expected `%` move
   itself, from a baseline it captured before checkpointing and the raw
   `/api/quotes` value after, and diffs that against what `/changes`
   reports — catching the class of bug where an engine is internally
   consistent but wrong.

8. **A mid-run crash loses no committed state.** The server is `SIGKILL`ed
   partway through the load test and respawned; every invariant above is
   re-checked *after* the kill, against the same running system, not a
   fresh one.

All ~20 checks currently pass; see the script's own output for the exact,
current list — this document names the guarantees, the script is the source
of truth for what's actually verified this run.

## The degradation ladder

The feed reports one of three honest states, computed the same way
everywhere it's used (`feedStatus()` in
[`health.ts`](backend/src/routes/health.ts)):

```
live   lag ≤ 90s (STALE_AFTER_SECONDS)         — shown as fresh, no badge
stale  90s < lag ≤ 180s (2× the threshold)      — every affected row badged,
                                                   data still served in full
down   lag > 180s, or no tick has ever arrived  — feed banner goes red,
                                                   last-known data still served
```

There's no separate "cached-fresh" tier above `live`: every `/changes` call
queries current state directly — there is no read-through response cache
sitting in front of it that could itself go stale independently of the
feed. (The 5-second TTL cache that exists — see the scale answer below — is
a *computation* cache for volatility stats, not a data-freshness layer; it
never changes what data is shown, only how expensive it is to decide what
counts as meaningful.) `stale` and `down` collapse into one behavior —
"keep serving what you have, label it honestly" — because splitting them
into a fourth, separately-labeled "last-known-good" tier would mean two
different code paths for "the data is old," which is exactly the kind of
seam a real outage would find. One path, two thresholds, is the version
that's actually been drop-kicked by the torture test.

## The scale answer

The ingestor subscribes to the **union of every watchlist's symbols**, once
per process — not once per user, per watchlist (see
[`ingestor.ts`](backend/src/market/ingestor.ts)). So ingestion cost scales
with *distinct symbols in the system*, not `users × symbols`; adding a
thousand users all watching the same 50 large-cap names costs nothing extra
on the ingest side.

That means the honest bottleneck as the product grows isn't ingestion —
it's **`/changes` computation fan-out**: every user's poll independently
recomputes volatility stats and re-ranks their list. `scale-check.ts`
(`npm run scale-check`) measures this directly at 50 concurrent users ×
500 symbols and found real numbers, not assumed ones: `loadStats()` was
recomputing each symbol's σ from a full `quote_history` window scan on
*every single request*, and that's what showed up as the actual cost —
p50 latency was 2615ms. The fix is a 5-second TTL cache on per-symbol
stats (volatility is slow-moving; it doesn't need to be exact to the
millisecond) plus a payload-hash dedupe on snapshot writes so concurrent
identical polls collapse to one write instead of one per request. Same
scale-check, same 500×50 load, after the fix: p50 279ms. Full before/after
numbers and the reasoning are in
[`DECISIONS.md`](DECISIONS.md#scaling-fix-stats-ttl-cache--snapshot-dedupe).

Naming this honestly matters more than the number: the bottleneck doesn't
disappear as the product grows past 500 symbols, it moves further out along
the same curve — the fix that works today is a cache with a bounded TTL,
not an architecture that scales unboundedly for free. The next real lever,
if usage grew past what a 5s TTL comfortably absorbs, is computing stats
once per symbol per tick window (push) instead of once per request (pull) —
already possible without a schema change, since `stats.ts` reads from the
same `quote_history` the ingestor already writes.
