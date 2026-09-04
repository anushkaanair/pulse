# Interpretation

The brief says "track stocks," but what it grades is "understand what has
meaningfully changed since they last checked." Those are different products.

I'm building the second one: a **per-user diff engine over an unreliable
market-data feed**, with a definition of "meaningful" that a user can trust
and I can defend.

Three commitments that follow from that reading:

1. **"Since they last checked" is a checkpoint, not a timestamp.** The system
   remembers what the user actually saw and diffs against it — even if the
   feed later delivers late, duplicate, out-of-order, or corrected data.
2. **"Meaningful" is relative to the stock's own behaviour.** A 2% move in a
   stock that normally moves 0.4% a day is news; the same 2% in one that
   moves 4% a day is noise. Significance is a z-score against trailing
   volatility, plus discrete events (high/low breached, volume anomaly, gap).
3. **Stale is never shown as fresh.** Data age is surfaced per symbol, feed
   health is a first-class state, and an older tick can never overwrite a
   newer one — enforced in the database, not in application code.

The trap I'm deliberately avoiding: a price table with green/red arrows and a
percentage since yesterday's close. That's the obvious watchlist. It answers
"what's the price?" — not "what deserves my attention now?"

Full spec: `IMPLEMENTATION_PLAN.md`. Trade-offs as they happen: `DECISIONS.md`.
