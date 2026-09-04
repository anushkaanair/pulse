-- Scaling: dedupe snapshot writes by hash instead of comparing full 18KB
-- jsonb, and enable cheap pruning of unpromoted snapshots.
ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS payload_hash text;
CREATE INDEX IF NOT EXISTS snapshots_hash_idx ON snapshots (user_id, watchlist_id, taken_at DESC) INCLUDE (payload_hash);
