-- A market-wide index proxy (NIFTY), used to separate a stock's own move
-- from what the whole market did (beta-adjusted / residual significance —
-- see DECISIONS.md). It flows through the same symbols/quotes/quote_history
-- tables as any tracked stock — same ingestion path, same resilience
-- guarantees — but is flagged so it's never surfaced as something a user
-- can add to their own watchlist.
ALTER TABLE symbols ADD COLUMN IF NOT EXISTS is_index boolean NOT NULL DEFAULT false;

INSERT INTO symbols (symbol, name, exchange, is_index) VALUES
  ('NIFTY', 'Nifty 50 (market index proxy)', 'NSE', true)
ON CONFLICT (symbol) DO UPDATE SET is_index = true;

-- The ranked-attention "top mover" at the moment a snapshot was taken —
-- minted alongside the snapshot itself (GET /changes already computes the
-- ranking; this just remembers the answer) so a later checkpoint can say
-- "this became your #1 mover, displacing X" without re-deriving history.
ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS top_symbol text;

-- The index's own price "as seen" at this snapshot — kept in dedicated
-- columns, deliberately NOT as another key inside `payload`: timeline.ts
-- treats every key of `payload` as a tracked watchlist symbol (it diffs
-- Object.keys(payload) directly), so mixing the index in there would leak
-- a fake "NIFTY" row into the visit-history diff. This is what lets a
-- later /changes call compute "what the market did since the checkpoint"
-- the same way it computes any stock's move: (now − seen) / seen.
ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS index_price numeric(14,4);
