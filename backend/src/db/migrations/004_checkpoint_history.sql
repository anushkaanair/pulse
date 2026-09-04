-- `checkpoints` holds only the LATEST promoted snapshot per (user, watchlist)
-- — it's overwritten on every promotion, so "what did I see on Tuesday vs
-- Wednesday" has no data to answer from. This is an append-only log of
-- every promotion, powering the visit timeline feature.
CREATE TABLE IF NOT EXISTS checkpoint_history (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      text NOT NULL,
  watchlist_id uuid NOT NULL REFERENCES watchlists(id) ON DELETE CASCADE,
  snapshot_id  uuid NOT NULL REFERENCES snapshots(id),
  taken_at     timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS checkpoint_history_lookup_idx
  ON checkpoint_history (user_id, watchlist_id, taken_at DESC);
