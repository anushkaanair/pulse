import type { Pool } from "pg";
import { config } from "../config.js";
import { logger } from "../logger.js";
import type { MarketDataProvider, Tick } from "./provider.js";

// One ingestor for the whole process. It watches the UNION of every
// watchlist's symbols — so cost scales with distinct symbols, not
// users × symbols — and writes each tick with a monotonic upsert so a
// late or duplicate tick can never regress the stored quote.

export interface IngestStats {
  received: number;
  applied: number;     // quotes row actually advanced
  ignored: number;     // older/duplicate tick, upsert condition false
  historyInserted: number;
  errors: number;
}

const UPSERT_QUOTE = `
  INSERT INTO quotes
    (symbol, price, prev_close, day_high, day_low, week_high, week_low, volume, as_of, received_at, seq, corrected, source)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now(), $10, $11, $12)
  ON CONFLICT (symbol) DO UPDATE SET
    price = EXCLUDED.price,
    prev_close = EXCLUDED.prev_close,
    day_high = EXCLUDED.day_high,
    day_low = EXCLUDED.day_low,
    week_high = EXCLUDED.week_high,
    week_low = EXCLUDED.week_low,
    volume = EXCLUDED.volume,
    as_of = EXCLUDED.as_of,
    received_at = now(),
    seq = EXCLUDED.seq,
    corrected = EXCLUDED.corrected,
    source = EXCLUDED.source
  WHERE quotes.as_of < EXCLUDED.as_of
     OR (quotes.as_of = EXCLUDED.as_of AND quotes.seq < EXCLUDED.seq)
`;

// History keeps the first print at each (symbol, as_of). A correction
// updates the live quote (above) but does not rewrite history: the
// original print happened, and trailing volatility should reflect that.
const INSERT_HISTORY = `
  INSERT INTO quote_history (symbol, as_of, price, volume)
  VALUES ($1, $2, $3, $4)
  ON CONFLICT (symbol, as_of) DO NOTHING
`;

export class Ingestor {
  readonly stats: IngestStats = { received: 0, applied: 0, ignored: 0, historyInserted: 0, errors: 0 };
  private refreshTimer: NodeJS.Timeout | null = null;
  private inflight = new Set<Promise<void>>();

  constructor(
    private readonly pool: Pool,
    readonly provider: MarketDataProvider,
  ) {
    provider.onTick((t) => this.track(this.handle(t)));
  }

  async start() {
    await this.refreshSymbols();
    this.refreshTimer = setInterval(() => void this.refreshSymbols(), config.symbolRefreshMs);
    this.provider.start();
    logger.info({ provider: this.provider.name }, "ingestor started");
  }

  async stop() {
    this.provider.stop();
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    await Promise.allSettled([...this.inflight]);
  }

  /** Union of all watched symbols. Symbols nobody watches aren't polled. */
  async refreshSymbols() {
    try {
      const { rows } = await this.pool.query<{ symbol: string }>(
        "SELECT DISTINCT symbol FROM watchlist_items",
      );
      this.provider.setSymbols(rows.map((r) => r.symbol));
    } catch (err) {
      this.stats.errors++;
      logger.warn({ err }, "symbol refresh failed; keeping previous set");
    }
  }

  /** Wait for every in-flight write. Used by tests and the torture script. */
  async drain() {
    await Promise.allSettled([...this.inflight]);
  }

  private track(p: Promise<void>) {
    this.inflight.add(p);
    void p.finally(() => this.inflight.delete(p));
  }

  private async handle(t: Tick) {
    this.stats.received++;
    try {
      const res = await this.pool.query(UPSERT_QUOTE, [
        t.symbol, t.price, t.prevClose, t.dayHigh, t.dayLow, t.weekHigh, t.weekLow, t.volume,
        t.asOf, t.seq, t.corrected, t.source,
      ]);
      if (res.rowCount === 1) this.stats.applied++;
      else this.stats.ignored++;

      const h = await this.pool.query(INSERT_HISTORY, [t.symbol, t.asOf, t.price, t.volume]);
      if (h.rowCount === 1) this.stats.historyInserted++;
    } catch (err) {
      this.stats.errors++;
      logger.error({ err, symbol: t.symbol }, "tick write failed");
    }
  }
}
