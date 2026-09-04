-- Archive is a reversible hide, distinct from delete (which is destructive
-- and already handled by ON DELETE CASCADE from 001_init.sql). NULL =
-- active/visible; a timestamp = archived at that moment (also gives "when
-- was this archived" for free, not just a boolean).
ALTER TABLE watchlists ADD COLUMN archived_at timestamptz;

-- One-time cleanup for data that predates the uniqueness rule below (found
-- live: three watchlists all named "long term", all empty — the exact bug
-- this migration exists to fix). Keeps the oldest of each duplicate-name
-- group untouched; every later one gets a " (2)", " (3)"... suffix so the
-- new unique index below can actually be created, and so the
-- duplicates are still visibly distinguishable afterward rather than
-- silently merged or dropped.
WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY user_id, lower(name) ORDER BY created_at, id) AS rn
    FROM watchlists WHERE archived_at IS NULL
)
UPDATE watchlists w SET name = w.name || ' (' || ranked.rn || ')'
  FROM ranked WHERE ranked.id = w.id AND ranked.rn > 1;

-- Case-insensitive per-user name uniqueness among ACTIVE (non-archived)
-- lists only — an archived "Long term" shouldn't block creating a new
-- active one with the same name. Partial + expression index so the
-- constraint costs nothing on the common (unarchived) path and doesn't
-- apply to rows it shouldn't.
CREATE UNIQUE INDEX watchlists_user_name_unique_active
  ON watchlists (user_id, lower(name))
  WHERE archived_at IS NULL;
