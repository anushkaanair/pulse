-- Per-symbol sensitivity: the user's answer to "how loud should this one be?"
-- quiet = raise the bar for what counts as meaningful; loud = lower it.
ALTER TABLE watchlist_items
  ADD COLUMN IF NOT EXISTS sensitivity text NOT NULL DEFAULT 'normal'
  CHECK (sensitivity IN ('quiet', 'normal', 'loud'));
