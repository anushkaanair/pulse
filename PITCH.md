# 200-word Product Pitch

For the HackerEarth submission form field "200-word Product Pitch."

---

We built a per-user diff engine, not a price table. Create and manage
watchlists, see live prices, and — the part that's actually graded — return
later to a precise answer for "what deserves my attention now?"

Every "last seen" state is a checkpoint: an exact snapshot of what you were
shown, so returning users get a real delta, immune to a feed that later
rewrites the past. "Meaningful" isn't a fixed threshold — it's a z-score
against each stock's own volatility, scaled by how long you've been away,
with a per-symbol quiet/loud override so alert fatigue doesn't creep in. A
one-line digest — "3 things worth a look, 12 others: nothing meaningful" —
replaces scanning forty rows.

The feed lies a little, on purpose: our default provider injects delay,
duplicates, out-of-order data, and corrections, because "unreliable
dependencies" was explicit in the brief. A monotonic upsert enforced in SQL
means a late tick can never regress a price. We prove it, not just claim it
— `npm run torture` spawns the real server under load, kills it mid-run
with SIGKILL, and checks 21 invariants against an independent oracle.

Three real bugs were found by that testing and fixed before submission —
logged, with reasoning, in `DECISIONS.md`.
