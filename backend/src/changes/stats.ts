import type { Pool } from "pg";
import { config } from "../config.js";
import { MARKET_INDEX_SYMBOL } from "../market/indexSymbol.js";

export interface SymbolStats {
  symbol: string;
  sigma: number | null;        // stdev of tick-to-tick returns; null if history is thin
  sampleSize: number;
  meanVolumePerTick: number;   // mean *increment* in cumulative volume per tick
  // Beta-adjusted / residual volatility (see engine.ts and DECISIONS.md).
  // beta is this symbol's sensitivity to the market index; idioSigma is the
  // stdev of what's LEFT after subtracting beta·indexReturn from each tick's
  // return — i.e. volatility that's actually this stock's own, not the
  // market's. Both null when there isn't enough paired history yet (same
  // thin-history fallback shape as `sigma`), so the engine degrades to raw
  // z exactly the way it already degrades to an absolute-% threshold.
  beta: number | null;
  idioSigma: number | null;
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
// The index's own return series is shared by every symbol's beta estimate
// in a given call, so it's fetched and cached once per call, not once per
// symbol — same "shared, not per-user" cost shape as the ingestor itself.
let indexReturnsCache: { at: number; returns: number[] } | null = null;

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

  const [{ rows }, indexReturns] = await Promise.all([
    pool.query<{ symbol: string; price: string; volume: string }>(
      `SELECT symbol, price, volume FROM (
         SELECT symbol, price, volume, as_of,
                row_number() OVER (PARTITION BY symbol ORDER BY as_of DESC) AS rn
           FROM quote_history
          WHERE symbol = ANY($1)
       ) t WHERE rn <= $2
       ORDER BY symbol, as_of ASC`,
      [symbols, config.historyWindow],
    ),
    loadIndexReturns(pool, nowMs),
  ]);

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

    // Pair this symbol's most recent returns with the index's most recent
    // returns, aligned by recency (both series tick in lockstep in the
    // simulator — see simulatedProvider.ts's step() — so the i-th-from-
    // latest return of each corresponds to the same tick cycle in the
    // overwhelming common case). A real broker feed would need a proper
    // as_of join instead of this position alignment; noted as a documented
    // simplification in DECISIONS.md, not a silent approximation.
    const n = Math.min(returns.length, indexReturns.length);
    let beta: number | null = null;
    let idioSigma: number | null = null;
    if (n >= config.minHistory) {
      const symTail = returns.slice(-n);
      const idxTail = indexReturns.slice(-n);
      const idxVar = variance(idxTail);
      if (idxVar > 0) {
        beta = covariance(symTail, idxTail) / idxVar;
        const residuals = symTail.map((r, i) => r - beta! * idxTail[i]);
        idioSigma = stdev(residuals);
      }
    }

    const stats: SymbolStats = {
      symbol,
      sigma: pts.length >= config.minHistory && returns.length >= 2 ? stdev(returns) : null,
      sampleSize: pts.length,
      meanVolumePerTick: mean(volDeltas),
      beta,
      idioSigma,
    };
    out.set(symbol, stats);
    statsCache.set(symbol, { at: nowMs, stats });
  }
  return out;
}

async function loadIndexReturns(pool: Pool, nowMs: number): Promise<number[]> {
  if (indexReturnsCache && nowMs - indexReturnsCache.at < STATS_TTL_MS) return indexReturnsCache.returns;
  const { rows } = await pool.query<{ price: string }>(
    `SELECT price FROM quote_history WHERE symbol = $1 ORDER BY as_of DESC LIMIT $2`,
    [MARKET_INDEX_SYMBOL, config.historyWindow],
  );
  const prices = rows.map((r) => Number(r.price)).reverse(); // chronological
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i - 1] > 0) returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
  }
  indexReturnsCache = { at: nowMs, returns };
  return returns;
}

function mean(xs: number[]) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function variance(xs: number[]) {
  const m = mean(xs);
  return mean(xs.map((x) => (x - m) ** 2));
}

function covariance(xs: number[], ys: number[]) {
  const mx = mean(xs);
  const my = mean(ys);
  return mean(xs.map((x, i) => (x - mx) * (ys[i] - my)));
}

function stdev(xs: number[]) {
  return Math.sqrt(variance(xs));
}
