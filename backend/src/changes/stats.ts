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
// Symbols come and go from watchlists; without a bound this map is a slow
// leak of every symbol the process has ever seen. Entries are tiny, so the
// cap is generous — it exists to make growth bounded, not tight.
const STATS_CACHE_MAX = 5_000;
// In-flight batch computations, keyed per symbol. A TTL cache alone still
// stampedes at expiry: N concurrent /changes calls all miss simultaneously
// and all run the same heavy history query. Sharing the PROMISE (the same
// trick routes/checkpoint.ts uses for idempotency) collapses them to one.
const inflight = new Map<string, Promise<SymbolStats>>();
// The index's own return series is shared by every symbol's beta estimate
// in a given call, so it's fetched and cached once per call, not once per
// symbol — same "shared, not per-user" cost shape as the ingestor itself.
// Promise-cached for the same stampede reason as the per-symbol stats.
let indexReturnsCache: { at: number; returns: Promise<number[]> } | null = null;

export async function loadStats(pool: Pool, symbols: string[]): Promise<Map<string, SymbolStats>> {
  const out = new Map<string, SymbolStats>();
  if (symbols.length === 0) return out;

  const nowMs = Date.now();
  const cold: string[] = [];
  const awaited: { symbol: string; promise: Promise<SymbolStats> }[] = [];
  for (const s of new Set(symbols)) {
    const c = statsCache.get(s);
    if (c && nowMs - c.at < STATS_TTL_MS) { out.set(s, c.stats); continue; }
    const pending = inflight.get(s);
    if (pending) awaited.push({ symbol: s, promise: pending });
    else cold.push(s);
  }

  // One batch for everything genuinely cold, registered per symbol so a
  // concurrent caller asking for any subset joins this same computation.
  if (cold.length > 0) {
    const batch = computeBatch(pool, cold, nowMs);
    for (const s of cold) {
      const p = batch.then((m) => m.get(s)!);
      inflight.set(s, p);
      // Never leave a rejected promise cached: a transient DB error must not
      // pin every later request to the same failure.
      void p.catch(() => {}).finally(() => { if (inflight.get(s) === p) inflight.delete(s); });
      awaited.push({ symbol: s, promise: p });
    }
  }

  for (const { symbol, promise } of awaited) out.set(symbol, await promise);
  return out;
}

async function computeBatch(pool: Pool, symbols: string[], nowMs: number): Promise<Map<string, SymbolStats>> {
  const out = new Map<string, SymbolStats>();

  const [{ rows }, indexReturns] = await Promise.all([
    pool.query<{ symbol: string; price: string; volume: string }>(
      // LATERAL, not a window function. `row_number() OVER (PARTITION BY
      // symbol ...) WHERE rn <= N` forces Postgres to read and sort EVERY
      // history row for each symbol before discarding all but N — cost grows
      // with total history retained, so it is fast on a fresh database and
      // quietly degrades forever as quote_history accumulates (~86k rows per
      // symbol per day at tickMs=1000). LATERAL + LIMIT is a backward
      // index scan on the (symbol, as_of) primary key that stops after N
      // rows: cost is a function of the window, not of history size.
      `SELECT s.symbol, h.price, h.volume
         FROM unnest($1::text[]) AS s(symbol)
         CROSS JOIN LATERAL (
           SELECT price, volume, as_of
             FROM quote_history
            WHERE symbol = s.symbol
            ORDER BY as_of DESC
            LIMIT $2
         ) h
        ORDER BY s.symbol, h.as_of ASC`,
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
  evictStale(nowMs);
  return out;
}

// Map preserves insertion order, so the oldest surviving entries are the
// ones iterated first — dropping expired entries, then the oldest, keeps
// the map bounded without needing an LRU structure for what is a cache of
// small plain objects.
function evictStale(nowMs: number) {
  if (statsCache.size <= STATS_CACHE_MAX) return;
  for (const [symbol, entry] of statsCache) {
    if (nowMs - entry.at >= STATS_TTL_MS) statsCache.delete(symbol);
  }
  for (const symbol of statsCache.keys()) {
    if (statsCache.size <= STATS_CACHE_MAX) break;
    statsCache.delete(symbol);
  }
}

async function loadIndexReturns(pool: Pool, nowMs: number): Promise<number[]> {
  if (indexReturnsCache && nowMs - indexReturnsCache.at < STATS_TTL_MS) return indexReturnsCache.returns;
  const promise = fetchIndexReturns(pool);
  indexReturnsCache = { at: nowMs, returns: promise };
  // A failed fetch must not be cached for the whole TTL — clear it so the
  // next caller retries instead of inheriting the rejection.
  void promise.catch(() => { if (indexReturnsCache?.returns === promise) indexReturnsCache = null; });
  return promise;
}

async function fetchIndexReturns(pool: Pool): Promise<number[]> {
  const { rows } = await pool.query<{ price: string }>(
    `SELECT price FROM quote_history WHERE symbol = $1 ORDER BY as_of DESC LIMIT $2`,
    [MARKET_INDEX_SYMBOL, config.historyWindow],
  );
  const prices = rows.map((r) => Number(r.price)).reverse(); // chronological
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i - 1] > 0) returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
  }
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

// Sample standard deviation (Bessel's correction, ÷ n−1). These returns are
// a SAMPLE of the symbol's return distribution used to estimate its true
// volatility, not the whole population — dividing by n biases sigma low,
// which makes every z-score slightly too large and the "meaningful" bar
// slightly too hot. At the minHistory=20 floor that bias is ~2.6%.
// `variance()` above stays population: it is only used as the denominator
// of beta (cov/var), where the correction cancels out of the ratio.
function stdev(xs: number[]) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}
