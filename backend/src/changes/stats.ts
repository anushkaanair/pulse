import type { Pool } from "pg";
import { config } from "../config.js";

export interface SymbolStats {
  symbol: string;
  sigma: number | null;    // stdev of tick-to-tick returns, or null if thin history
  sampleSize: number;
  meanVolume: number;
}

// Trailing volatility per symbol, computed from quote_history. This is what
// makes "meaningful" relative to the stock rather than a fixed % for
// everything. A thin-history symbol gets sigma=null and the engine falls
// back to an absolute threshold with confidence="low" — never a division
// by a near-zero sigma blowing up the z-score.
export async function loadStats(pool: Pool, symbols: string[]): Promise<Map<string, SymbolStats>> {
  const out = new Map<string, SymbolStats>();
  if (symbols.length === 0) return out;

  const { rows } = await pool.query<{ symbol: string; price: string; volume: string; as_of: Date }>(
    `SELECT symbol, price, volume, as_of FROM (
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
    const points = bySymbol.get(symbol) ?? [];
    if (points.length < config.minHistory) {
      out.set(symbol, { symbol, sigma: null, sampleSize: points.length, meanVolume: mean(points.map((p) => p.volume)) });
      continue;
    }
    const returns: number[] = [];
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1].price;
      if (prev > 0) returns.push((points[i].price - prev) / prev);
    }
    out.set(symbol, {
      symbol,
      sigma: returns.length >= 2 ? stdev(returns) : null,
      sampleSize: points.length,
      meanVolume: mean(points.map((p) => p.volume)),
    });
  }
  return out;
}

function mean(xs: number[]) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function stdev(xs: number[]) {
  const m = mean(xs);
  const variance = mean(xs.map((x) => (x - m) ** 2));
  return Math.sqrt(variance);
}
