// The market-wide index proxy (think NIFTY 50) used to separate a stock's
// idiosyncratic move from beta — what the whole market did. It's ingested
// through the exact same pipeline as any other symbol (same monotonic
// upsert, same fault injection, same staleness rules — see DECISIONS.md),
// so it inherits every resilience guarantee for free instead of needing a
// second, parallel "reliable" data path. It is never addable to a user's
// own watchlist (see is_index in the symbols table).
export const MARKET_INDEX_SYMBOL = "NIFTY";
