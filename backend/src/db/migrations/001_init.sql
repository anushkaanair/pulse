-- Schema for the Smart Market Watchlist. Invariants live here on purpose:
-- the database is the only layer that can make "never regress a quote" and
-- "never double-count a tick" true under concurrency.

CREATE TABLE IF NOT EXISTS symbols (
  symbol      text PRIMARY KEY,
  name        text NOT NULL,
  exchange    text NOT NULL DEFAULT 'NSE'
);

CREATE TABLE IF NOT EXISTS watchlists (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     text NOT NULL,
  name        text NOT NULL,
  version     integer NOT NULL DEFAULT 1,      -- optimistic concurrency for bulk edits
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS watchlists_user_idx ON watchlists (user_id);

CREATE TABLE IF NOT EXISTS watchlist_items (
  watchlist_id uuid NOT NULL REFERENCES watchlists(id) ON DELETE CASCADE,
  symbol       text NOT NULL REFERENCES symbols(symbol),
  added_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (watchlist_id, symbol)           -- idempotent add, no duplicates
);

CREATE TABLE IF NOT EXISTS quotes (
  symbol       text PRIMARY KEY REFERENCES symbols(symbol),
  price        numeric(14,4) NOT NULL CHECK (price > 0),
  prev_close   numeric(14,4),
  day_high     numeric(14,4),
  day_low      numeric(14,4),
  volume       bigint NOT NULL DEFAULT 0 CHECK (volume >= 0),
  as_of        timestamptz NOT NULL,           -- exchange time
  received_at  timestamptz NOT NULL DEFAULT now(),
  seq          bigint NOT NULL,                -- provider sequence number
  corrected    boolean NOT NULL DEFAULT false,
  source       text NOT NULL
);
-- Writers MUST use the monotonic upsert in src/market/ingestor.ts:
--   ON CONFLICT (symbol) DO UPDATE ... WHERE quotes.as_of < EXCLUDED.as_of
--      OR (quotes.as_of = EXCLUDED.as_of AND quotes.seq < EXCLUDED.seq)

CREATE TABLE IF NOT EXISTS quote_history (
  symbol   text NOT NULL REFERENCES symbols(symbol),
  as_of    timestamptz NOT NULL,
  price    numeric(14,4) NOT NULL,
  volume   bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (symbol, as_of)                  -- duplicate ticks are no-ops
);

-- Candidate "what was shown": minted by GET /changes.
CREATE TABLE IF NOT EXISTS snapshots (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      text NOT NULL,
  watchlist_id uuid NOT NULL REFERENCES watchlists(id) ON DELETE CASCADE,
  taken_at     timestamptz NOT NULL DEFAULT now(),
  payload      jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS snapshots_lookup_idx
  ON snapshots (user_id, watchlist_id, taken_at DESC);

-- Promoted snapshot = "last seen". Keyed by user, not device, so state
-- persists across devices by construction.
CREATE TABLE IF NOT EXISTS checkpoints (
  user_id      text NOT NULL,
  watchlist_id uuid NOT NULL REFERENCES watchlists(id) ON DELETE CASCADE,
  snapshot_id  uuid NOT NULL REFERENCES snapshots(id),
  taken_at     timestamptz NOT NULL,
  PRIMARY KEY (user_id, watchlist_id)
);
