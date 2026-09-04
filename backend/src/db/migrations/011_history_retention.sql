-- quote_history is append-only and, until now, never pruned: at TICK_MS=1000
-- that is ~86k rows per watched symbol per day, forever. Two consequences,
-- one obvious and one not: unbounded disk, and — because trailing volatility
-- reads this table on every /changes — a query whose cost grows with total
-- retained history rather than with the window it actually needs.
--
-- The primary key is (symbol, as_of), which serves the per-symbol window
-- read but cannot serve a global "everything older than X" sweep: that has
-- to scan. This index makes retention a bounded range scan instead.
--
-- BRIN, deliberately, not btree. A btree on as_of also advertises itself as
-- a source of ORDER BY as_of DESC, and the planner took the bait: for the
-- hot per-symbol window read it chose the btree and then filtered by symbol,
-- discarding ~2.3k rows to return 50 (measured with EXPLAIN ANALYZE) — cost
-- scaling with the number of symbols rather than with the window. BRIN
-- cannot provide ordering, so it is invisible to that query and the planner
-- keeps using the primary key, while retention still gets cheap range
-- pruning. It is also a fraction of the size: as_of is append-ordered, so
-- it correlates almost perfectly with physical layout, which is exactly the
-- case BRIN is built for.
CREATE INDEX IF NOT EXISTS quote_history_as_of_brin
  ON quote_history USING brin (as_of) WITH (pages_per_range = 32);

-- Drop the btree if an earlier run of this migration created it.
DROP INDEX IF EXISTS quote_history_as_of_idx;
