import { FaultConfig, MarketDataProvider, NO_FAULTS, Tick } from "./provider.js";
import { MARKET_INDEX_SYMBOL } from "./indexSymbol.js";

// Deterministic market simulator. Same seed → same ticks, so the torture
// test is reproducible and a demo can be replayed. Each symbol gets its own
// base price and daily volatility, so "meaningful" has something real to be
// relative to: a 2% move in a σ=0.4% name should score very differently
// from a 2% move in a σ=4% name.
//
// Every symbol's return is also built from a shared market factor (the
// simulated index) plus its own idiosyncratic noise: r = beta·indexReturn +
// idio. This isn't decorative — it's what makes beta-adjustment in
// changes/stats.ts and engine.ts a real, checkable thing rather than a
// feature with nothing underneath it: a stock down 3% on a day the index
// is down 3% (beta≈1) should score close to zero idiosyncratically, and
// this simulator is the only source of "the index was down 3%" truth to
// check that against.

// mulberry32: tiny seeded PRNG, good enough for this purpose.
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Standard-normal draw via Box–Muller, given a [0,1) uniform source. */
function gaussian(rand: () => number): number {
  const u1 = Math.max(rand(), 1e-12);
  const u2 = rand();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

interface SymbolState {
  price: number;
  prevClose: number;
  dayHigh: number;
  dayLow: number;
  weekHigh: number;
  weekLow: number;
  volume: number;
  sigmaPerTick: number;      // TOTAL return stdev per tick (beta + idio combined)
  idioSigmaPerTick: number;  // the idiosyncratic slice of sigmaPerTick, after removing beta's share
  beta: number;              // sensitivity to the shared index factor
  meanVolumePerTick: number;
  rand: () => number;
  lastAsOf: number;       // ms; strictly increasing per symbol
}

interface IndexState {
  price: number;
  prevClose: number;
  dayHigh: number;
  dayLow: number;
  weekHigh: number;
  weekLow: number;
  volume: number;
  sigmaPerTick: number;
  meanVolumePerTick: number;
  rand: () => number;
  lastAsOf: number;
}

export interface SimulatedProviderOptions {
  seed?: number;
  tickMs?: number;
  /** Override per-symbol volatility (daily, as a fraction, e.g. 0.02 = 2%). */
  sigmaDaily?: Record<string, number>;
}

export class SimulatedProvider implements MarketDataProvider {
  readonly name = "simulated";
  private symbols = new Set<string>();
  private state = new Map<string, SymbolState>();
  private handler: ((t: Tick) => void) | null = null;
  private timer: NodeJS.Timeout | null = null;
  private faults: FaultConfig = { ...NO_FAULTS };
  private seq = 0;
  private last: Date | null = null;
  private held: Tick | null = null; // for out-of-order injection
  private readonly seed: number;
  private readonly tickMs: number;
  private readonly sigmaOverride: Record<string, number>;
  private readonly faultRand: () => number;
  private readonly indexState: IndexState;

  constructor(opts: SimulatedProviderOptions = {}) {
    this.seed = opts.seed ?? 42;
    this.tickMs = opts.tickMs ?? 1000;
    this.sigmaOverride = opts.sigmaDaily ?? {};
    this.faultRand = mulberry32(this.seed ^ 0x9e3779b9);
    this.indexState = this.initIndex();
  }

  setSymbols(symbols: string[]) {
    this.symbols = new Set(symbols.filter((s) => s !== MARKET_INDEX_SYMBOL));
    for (const s of this.symbols) if (!this.state.has(s)) this.state.set(s, this.initSymbol(s));
  }

  onTick(handler: (t: Tick) => void) {
    this.handler = handler;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.step(), this.tickMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  setFaults(f: Partial<FaultConfig>) {
    this.faults = { ...this.faults, ...f };
    return this.getFaults();
  }

  getFaults() {
    return { ...this.faults };
  }

  lastTickAt() {
    return this.last;
  }

  /** Advance one interval synchronously. Exposed so tests don't need timers. */
  step(now = Date.now()) {
    if (this.faults.outage) return;
    // The index always ticks, regardless of what any watchlist tracks —
    // it's the shared factor every symbol's beta is measured against, not
    // something demand-driven. Computed once per step and reused by every
    // symbol below, so a symbol's move and "what the market did at the
    // same moment" are always in lockstep, not fuzzily time-joined later.
    const indexReturn = this.nextIndexReturn();
    this.deliverWithFaults(this.buildIndexTick(now));
    for (const symbol of this.symbols) {
      const tick = this.nextTick(symbol, now, indexReturn);
      this.deliverWithFaults(tick);
    }
  }

  private initIndex(): IndexState {
    const rand = mulberry32(this.seed ^ hashString(MARKET_INDEX_SYMBOL));
    const basePrice = 22000 + Math.floor(rand() * 3000); // NIFTY-scale base
    const sigmaDaily = 0.009; // an index is calmer than any single stock in it
    const ticksPerDay = (6.25 * 3600 * 1000) / this.tickMs;
    return {
      price: basePrice, prevClose: basePrice, dayHigh: basePrice, dayLow: basePrice,
      weekHigh: round4(basePrice * 1.15), weekLow: round4(basePrice * 0.85),
      volume: 0, sigmaPerTick: sigmaDaily / Math.sqrt(ticksPerDay),
      meanVolumePerTick: 50_000, rand, lastAsOf: 0,
    };
  }

  /** Advances the index one tick and returns its fractional return for this step. */
  private nextIndexReturn(): number {
    const s = this.indexState;
    const r = gaussian(s.rand) * s.sigmaPerTick;
    s.price = Math.max(1, s.price * (1 + r));
    s.dayHigh = Math.max(s.dayHigh, s.price);
    s.dayLow = Math.min(s.dayLow, s.price);
    s.weekHigh = Math.max(s.weekHigh, s.price);
    s.weekLow = Math.min(s.weekLow, s.price);
    s.volume += Math.floor(s.meanVolumePerTick * (0.5 + s.rand()));
    return r;
  }

  private buildIndexTick(now: number): Tick {
    const s = this.indexState;
    s.lastAsOf = Math.max(now, s.lastAsOf + 1);
    return {
      symbol: MARKET_INDEX_SYMBOL,
      price: round4(s.price), prevClose: round4(s.prevClose), dayHigh: round4(s.dayHigh), dayLow: round4(s.dayLow),
      weekHigh: round4(s.weekHigh), weekLow: round4(s.weekLow), volume: s.volume,
      asOf: new Date(s.lastAsOf), seq: ++this.seq, corrected: false, source: this.name,
    };
  }

  private initSymbol(symbol: string): SymbolState {
    const rand = mulberry32(this.seed ^ hashString(symbol));
    // Base price spread across a realistic range; volatility spread so the
    // universe has both sleepy large-caps and jumpy small-caps.
    const basePrice = 50 + Math.floor(rand() * 4000);
    const sigmaDaily = this.sigmaOverride[symbol] ?? 0.004 + rand() * 0.036; // 0.4%–4%/day
    const ticksPerDay = (6.25 * 3600 * 1000) / this.tickMs;
    const sigmaPerTick = sigmaDaily / Math.sqrt(ticksPerDay);
    // Beta: how much of this symbol's move is "the market", 0.4–1.8, spread
    // around 1.0. The idiosyncratic slice is whatever variance beta doesn't
    // already explain — floored so a very high-beta, low-vol name (nearly
    // pure market exposure) never goes imaginary under the sqrt.
    const beta = 0.4 + rand() * 1.4;
    const indexSigmaPerTick = this.indexState.sigmaPerTick;
    const idioSigmaPerTick = Math.sqrt(Math.max(1e-8, sigmaPerTick ** 2 - (beta * indexSigmaPerTick) ** 2));
    return {
      price: basePrice,
      prevClose: basePrice,
      dayHigh: basePrice,
      dayLow: basePrice,
      // Stable 52w band around the base; expands if price later breaks it.
      weekHigh: round4(basePrice * (1.05 + rand() * 0.35)),
      weekLow: round4(basePrice * (0.6 + rand() * 0.3)),
      volume: 0,
      sigmaPerTick,
      idioSigmaPerTick,
      beta,
      meanVolumePerTick: 500 + Math.floor(rand() * 5000),
      rand,
      lastAsOf: 0,
    };
  }

  private nextTick(symbol: string, now: number, indexReturn: number): Tick {
    const s = this.state.get(symbol)!;
    // Combined return: the market's share (beta·indexReturn) plus this
    // stock's own idiosyncratic noise — this is the actual source of truth
    // that changes/stats.ts's beta/residual estimate is trying to recover
    // from tick history, and what makes "subtract what the sector did"
    // in engine.ts a real, checkable adjustment rather than cosmetic.
    let r = s.beta * indexReturn + gaussian(s.rand) * s.idioSigmaPerTick;
    // Occasional fat-tail jump — a stock-specific event, not a market one,
    // so it's idiosyncratic: added after the beta split, not before it.
    if (s.rand() < 0.002) r += (s.rand() < 0.5 ? -1 : 1) * s.sigmaPerTick * 25;
    s.price = Math.max(1, s.price * (1 + r));
    s.dayHigh = Math.max(s.dayHigh, s.price);
    s.dayLow = Math.min(s.dayLow, s.price);
    s.weekHigh = Math.max(s.weekHigh, s.price);
    s.weekLow = Math.min(s.weekLow, s.price);
    const volSpike = s.rand() < 0.01 ? 4 : 1;
    const v = Math.floor(s.meanVolumePerTick * (0.5 + s.rand()) * volSpike);
    s.volume += v;
    // asOf strictly increases per symbol regardless of wall-clock jitter.
    s.lastAsOf = Math.max(now, s.lastAsOf + 1);
    return {
      symbol,
      price: round4(s.price),
      prevClose: round4(s.prevClose),
      dayHigh: round4(s.dayHigh),
      dayLow: round4(s.dayLow),
      weekHigh: round4(s.weekHigh),
      weekLow: round4(s.weekLow),
      volume: s.volume,
      asOf: new Date(s.lastAsOf),
      seq: ++this.seq,
      corrected: false,
      source: this.name,
    };
  }

  private deliverWithFaults(tick: Tick) {
    const f = this.faults;
    const pct = () => this.faultRand() * 100;

    // Out-of-order: hold this tick; emit it after the next one for the
    // same provider. Downstream must not let the held (older) tick win.
    if (pct() < f.outOfOrderPct) {
      const prev = this.held;
      this.held = tick;
      if (prev) this.emit(prev);
      return;
    }
    this.emit(tick);
    if (this.held) {
      const h = this.held;
      this.held = null;
      this.emit(h);
    }

    if (pct() < f.duplicatePct) this.emit({ ...tick });

    if (pct() < f.correctionPct) {
      // Same asOf, higher seq, slightly different price: an exchange
      // revising a print. Downstream must accept it and flag it.
      this.emit({
        ...tick,
        price: round4(tick.price * (1 + (this.faultRand() - 0.5) * 0.004)),
        seq: ++this.seq,
        corrected: true,
      });
    }
  }

  private emit(tick: Tick) {
    if (!this.handler) return;
    const deliver = () => {
      this.last = new Date();
      this.handler!(tick);
    };
    if (this.faults.delayMs > 0) setTimeout(deliver, this.faults.delayMs);
    else deliver();
  }
}

function round4(n: number) {
  return Math.round(n * 10000) / 10000;
}
