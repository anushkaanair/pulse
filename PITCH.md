# 200-word Product Pitch

For the HackerEarth submission form field "200-word Product Pitch."

---

We built a per-user diff engine, not a price table. Return later to a
precise, ranked answer for "what deserves my attention now" — a 3D deck
where depth mirrors how much each move actually matters, not a flood of
everything that moved.

Every "last seen" is an exact checkpoint, immune to a feed that rewrites
the past. "Meaningful" is a residual z-score: a stock's move minus what its
sector did, against a market-index proxy in the same fault-injected
pipeline as any stock — a move fully explained by beta isn't news. A
second, visit-independent clock tracks "quiet for weeks, just woke up"; a
correction to an already-shown move is a visible retraction, never a
silent delete. An attention budget caps the deck, so a volatile day is a
triage, not a flood.

The feed lies on purpose — delay, duplicates, out-of-order, corrections —
because "unreliable dependencies" was explicit in the brief. A monotonic
SQL upsert means a late tick never regresses a price. We prove it:
`npm run torture` spawns the real server, kills it mid-run with SIGKILL,
and checks 20+ invariants against an independent oracle. That testing
keeps finding real bugs, logged with reasoning in `DECISIONS.md`.
