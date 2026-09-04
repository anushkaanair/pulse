# Decision Log

Non-obvious choices, logged as made. Three lines each: what, alternatives,
why this one.

## Checkpoint stores a snapshot, not a timestamp
**What:** "Last seen" is a `jsonb` snapshot of the quotes as rendered, promoted by `snapshotId`.
**Alternatives:** Store `last_seen_at` and diff against history at that time.
**Why:** A timestamp depends on history retention and is wrong the moment a late tick rewrites the past. A snapshot is exactly what the user saw, forever. The `snapshotId` handshake also closes the render-vs-mark race.

## "Meaningful" = z-score against trailing volatility, not a fixed threshold
**What:** `z = move / trailing σ`; meaningful at `|z| ≥ 2`; absolute fallback with `confidence="low"` when history is thin.
**Alternatives:** Fixed % threshold; ML/news scoring.
**Why:** A fixed threshold is wrong for every stock but one. ML isn't explainable in one sentence. z-score is defensible, cheap, and the `why` string writes itself.

## Monotonic upsert enforced in SQL
**What:** `ON CONFLICT ... WHERE quotes.as_of < EXCLUDED.as_of OR (equal as_of AND lower seq)`.
**Alternatives:** Check-then-write in the ingestor.
**Why:** Check-then-write races under concurrency. The database is the only place that can make "never regress a quote" true.

## Simulated provider with fault injection is the default feed
**What:** Deterministic simulator behind a `MarketDataProvider` interface, with knobs for outage/delay/out-of-order/duplicate/correction.
**Alternatives:** Real free market API as the default.
**Why:** The rubric names "unreliable dependencies." A real API can't be made to fail on command in a demo; a simulator can, reproducibly. The interface keeps a real adapter possible.

## Polling + ETag, not WebSockets
**What:** Client polls `/changes` every 15s with `If-None-Match`.
**Alternatives:** WebSocket push.
**Why:** The problem is state-on-return, not live ticking. Polling is simpler, cacheable, and its failure modes are obvious. Push would be hours spent on something the brief doesn't ask about.

## Shared ingestion; diff computed on read
**What:** Poll the union of all watched symbols once; compute each user's diff at request time.
**Alternatives:** Per-user background diff jobs; per-user polling.
**Why:** Cost scales with distinct symbols, not users × symbols. Reads are cheap and cacheable; background jobs are state to keep correct.

## No real auth
**What:** `X-User-Id` header.
**Alternatives:** JWT/session auth.
**Why:** Orthogonal to what's graded. Three hours that prove nothing about the diff engine.

## Significance scales with time away
**What:** `z = r / (σ_tick · √n)`, n = ticks since checkpoint, capped.
**Alternatives:** Per-tick σ regardless of elapsed time (the first draft).
**Why:** A 2% move over five days is unremarkable for a stock where 2% in five minutes is not. Without this the engine over-flags long absences — exactly the case the brief cares about.

## Catch-me-up digest and per-symbol sensitivity — the only features added
**What:** One generated summary sentence; a quiet/normal/loud setting per symbol that scales the z threshold.
**Alternatives:** Alerts with absolute thresholds, notifications, visit timeline, sharing.
**Why:** Both change what the core surfaces rather than adding screens; both answer a real reason people stop using watchlists (too much noise). The rest is either infra we can't finish or padding.

## Elapsed-tick cap must not reuse HISTORY_WINDOW
**What:** The away-aware `n` (ticks since checkpoint) is capped at ~30 days of ticks, not `HISTORY_WINDOW`.
**Alternatives:** Cap `n` at `HISTORY_WINDOW` (the original code, and the original spec in IMPLEMENTATION_PLAN.md).
**Why:** Caught by the engine's own unit tests: `HISTORY_WINDOW` defaults to 50 ticks (~50s at the default tick rate), which is how much price history estimates σ from — not how long a user can be away. Reusing it as the elapsed-time cap silently disabled away-aware scaling for anyone gone more than a minute, defeating the feature for the multi-day-absence case it exists to handle. This is why the torture test and unit tests run before the demo, not just for show.

## Day-high/low breach must clear a significance bar, not just be non-zero
**What:** DAY_HIGH_BREACHED/DAY_LOW_BREACHED only fire when the breach magnitude clears the same z-score (or absolute-%) bar used for price moves — not on any strictly-greater comparison.
**Alternatives:** Fire on any new high/low, however small (the original code).
**Why:** Found live: seconds after promoting a checkpoint, a normally-drifting stock (+0.13%, 1.3σ) still showed as "meaningful" because it trivially set a new intraday high. Any upward-drifting stock sets a "new high" on nearly every tick — this broke the core promise that "nothing meaningful changed" actually means that, and violated the torture test's own checkpoint-exactness invariant (§10, assertion 7). Caught by running the real flow against the live server, not just unit tests against synthetic data — worth noting for the pitch.

## Checkpoint exactness invariant, refined under real load
**What:** The provable invariant is "no false-positive re-flag of already-seen data" (every item marked meaningful after a fresh checkpoint reflects a tick strictly newer than the checkpoint), not "zero changes no matter how much time passes."
**Alternatives:** Assert `summary.meaningful === 0` unconditionally right after checkpointing (the original torture-test spec, §10 assertion 7).
**Why:** Found running the torture test at a realistic continuous tick rate: real ticks land during the network round-trips between minting a checkpoint, promoting it, and re-polling, so a symbol can legitimately have new data by the time you ask again — showing it is correct, not a bug. The stricter, actually-defensible claim is that nothing shown was already seen. Verified directly: every "meaningful" item's quote timestamp is checked against the checkpoint's own timestamp.
