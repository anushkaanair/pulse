-- Retractions and "quiet for N days" were previously readable exactly once.
--
-- `symbol_significance` holds ONE row per symbol and the decision function
-- guards on it (`!prior.retractedAt`, and "is this a new crossing"). That
-- state is global and correct as state — but it was also being CONSUMED as
-- if it were per-user. Whichever user polled first got the retraction and
-- flipped `retracted_at`; every other user who had actually been shown the
-- original change got `action: "none"` and watched the card vanish with no
-- explanation. That is precisely the silent delete the project promises
-- never to do, and the same first-poller-wins race hid the "quiet for 3
-- weeks before this" annotation from everyone else.
--
-- The fix is to separate the two concerns: `symbol_significance` stays the
-- global latch that decides WHEN something happened (unchanged), and this
-- append-only log records WHAT happened and WHEN, so each user's /changes
-- can project it against their own checkpoint instead of racing for it.
CREATE TABLE IF NOT EXISTS symbol_significance_events (
  id            bigserial PRIMARY KEY,
  symbol        text NOT NULL REFERENCES symbols(symbol),
  event_as_of   timestamptz NOT NULL,   -- the tick that triggered it
  event_at      timestamptz NOT NULL,   -- wall-clock time it was recorded
  z             numeric,
  quiet_for_ms  bigint,                 -- gap since this symbol's previous event; NULL = first ever
  retracted_at  timestamptz,            -- set if that tick was later corrected below threshold
  -- One row per (symbol, triggering tick). This is also the write-race
  -- guard the single-row table only half had: two concurrent pollers
  -- deciding "new event" for the same tick can't produce two log entries.
  UNIQUE (symbol, event_as_of)
);

-- "Which retractions happened since this user last looked" — the per-user
-- projection that replaces the consumed-once flag.
CREATE INDEX IF NOT EXISTS sig_events_retracted_idx
  ON symbol_significance_events (retracted_at)
  WHERE retracted_at IS NOT NULL;

-- "What was this symbol's most recent event" — for the quiet-for annotation.
CREATE INDEX IF NOT EXISTS sig_events_symbol_recent_idx
  ON symbol_significance_events (symbol, event_at DESC);

-- Carry over whatever the single-row table already knows, so history isn't
-- silently reset to empty by this migration.
INSERT INTO symbol_significance_events (symbol, event_as_of, event_at, z, retracted_at)
SELECT symbol, last_event_as_of, COALESCE(last_event_at, last_event_as_of), last_event_z, retracted_at
  FROM symbol_significance
 WHERE last_event_as_of IS NOT NULL
ON CONFLICT (symbol, event_as_of) DO NOTHING;
