-- Personalization: the ranking learns what a user actually opens, and lets
-- them explicitly mute a symbol for a while. Two tables, deliberately
-- separate from the significance-clock tables (symbol_significance*) —
-- those are global (per-symbol, not per-user); these are per-user, the
-- other half of "meaningful" that the z-score math alone can't capture.

-- Every time a user opens a ranked card (not just sees it in the deck),
-- logged as one row. Read as a recency/frequency signal in
-- changes/personalization.ts — no aggregation performed at write time, so
-- the read side stays free to change its window (currently 30 days)
-- without a migration.
CREATE TABLE IF NOT EXISTS attention_opens (
  id bigserial PRIMARY KEY,
  user_id text NOT NULL,
  symbol text NOT NULL REFERENCES symbols(symbol),
  opened_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_attention_opens_user_symbol_time
  ON attention_opens (user_id, symbol, opened_at DESC);

-- "Mute this one for a while" — explicit, not inferred. One row per
-- (user, symbol): a repeat snooze just extends snoozed_until, it never
-- accumulates rows. Suppression logic (forcing kind to "none" while
-- snoozed_until is in the future) lives in changes/personalization.ts,
-- not here.
CREATE TABLE IF NOT EXISTS attention_snoozes (
  user_id text NOT NULL,
  symbol text NOT NULL REFERENCES symbols(symbol),
  snoozed_until timestamptz NOT NULL,
  PRIMARY KEY (user_id, symbol)
);
