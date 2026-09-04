-- The second clock: "how long since this symbol last did something
-- notable," independent of any user's visits. One row per symbol (global,
-- not per-user — significance is a property of the symbol's own price
-- action, not of who's watching it).
CREATE TABLE IF NOT EXISTS symbol_significance (
  symbol           text PRIMARY KEY REFERENCES symbols(symbol),
  last_event_at    timestamptz,       -- wall-clock time this was recorded
  last_event_as_of timestamptz,       -- the tick that triggered it (for retraction matching)
  last_event_z     numeric,
  retracted_at     timestamptz        -- set once, if that tick was later corrected below threshold
);
