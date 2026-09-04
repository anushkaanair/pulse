import type { Pool } from "pg";
import { config } from "../config.js";

export interface SymbolStats {
  symbol: string;
  sigma: number | null;        // stdev of tick-to-tick returns; null if history is thin
  sampleSize: number;
  meanVolumePerTick: number;   // mean *increment* in cumulative volume per tick
}

// Trailing volatility per symbol from quote_history. This is what makes
// "meaningful" relative to the stock rather than a fixed % for everything.
// Thin history → sigma=null → the engine falls back to an absolute threshold
// with confidence="low", instead of dividing by a noisy near-zero sigma.
// σ is slow-moving; recomputing it (a heavy window-function scan) on every
// /changes request is the real cost under concurrency, found via
// scale-check.ts. A short per-symbol TTL cache collapses N concurrent
// identical computations to one — a 5s-stale volatility estimate is
// indistinguishable from a fresh one for ranking.
const STATS_TTL_MS = 5_000;
const statsCache = new Map<string, { at: number; stats: SymbolStats }>();

export async function loadStats(pool: Pool, symbols: string[]): Promise<Map<string, SymbolStats>> {
  const out = new Map<string, SymbolStats>();
  if (symbols.length === 0) return out;

  const nowMs = Date.now();
  const stale: string[] = [];
  for (const s of symbols) {
    const c = statsCache.get(s);
    if (c && nowMs - c.at < STATS_TTL_MS) out.set(s, c.stats);
    else stale.push(s);
  }
  if (stale.length === 0) return out;
  symbols = stale;

  const { rows } = await pool.query<{ symbol: string; price: string; volume: string }>(
    `SELECT symbol, price, volume FROM (
       SELECT symbol, price, volume, as_of,
              row_number() OVER (PARTITION BY symbol ORDER BY as_of DESC) AS rn
         FROM quote_history
        WHERE symbol = ANY($1)
     ) t WHERE rn <= $2
     ORDER BY symbol, as_of ASC`,
    [symbols, config.historyWindow],
  );

  const bySymbol = new Map<string, { price: number; volume: number }[]>();
  for (const row of rows) {
    const list = bySymbol.get(row.symbol) ?? [];
    list.push({ price: Number(row.price), volume: Number(row.volume) });
    bySymbol.set(row.symbol, list);
  }

  for (const symbol of symbols) {
    const pts = bySymbol.get(symbol) ?? [];
    const returns: number[] = [];
    const volDeltas: number[] = [];
    for (let i = 1; i < pts.length; i++) {
      if (pts[i - 1].price > 0) returns.push((pts[i].price - pts[i - 1].price) / pts[i - 1].price);
      volDeltas.push(Math.max(0, pts[i].volume - pts[i - 1].volume));
    }
    const stats: SymbolStats = {
      symbol,
      sigma: pts.length >= config.minHistory && returns.length >= 2 ? stdev(returns) : null,
      sampleSize: pts.length,
      meanVolumePerTick: mean(volDeltas),
    };
    out.set(symbol, stats);
    statsCache.set(symbol, { at: nowMs, stats });
  }
  return out;
}

function mean(xs: number[]) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function stdev(xs: number[]) {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}
