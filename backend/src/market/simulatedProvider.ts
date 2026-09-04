import { FaultConfig, MarketDataProvider, NO_FAULTS, Tick } from "./provider.js";

// Deterministic market simulator. Same seed → same ticks, so the torture
// test is reproducible and a demo can be replayed. Each symbol gets its own
// base price and daily volatility, so "meaningful" has something real to be
// relative to: a 2% move in a σ=0.4% name should score very differently
// from a 2% move in a σ=4% name.

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

interface SymbolState {
  price: number;
  prevClose: number;
  dayHigh: number;
  dayLow: number;
  weekHigh: number;
  weekLow: number;
  volume: number;
  sigmaPerTick: number;   // return stdev per tick
  meanVolumePerTick: number;
  rand: () => number;
  lastAsOf: number;       // ms; strictly increasing per symbol
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

  constructor(opts: SimulatedProviderOptions = {}) {
    this.seed = opts.seed ?? 42;
    this.tickMs = opts.tickMs ?? 1000;
    this.sigmaOverride = opts.sigmaDaily ?? {};
    this.faultRand = mulberry32(this.seed ^ 0x9e3779b9);
  }

  setSymbols(symbols: string[]) {
    this.symbols = new Set(symbols);
    for (const s of symbols) if (!this.state.has(s)) this.state.set(s, this.initSymbol(s));
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
    for (const symbol of this.symbols) {
      const tick = this.nextTick(symbol, now);
      this.deliverWithFaults(tick);
    }
  }

  private initSymbol(symbol: string): SymbolState {
    const rand = mulberry32(this.seed ^ hashString(symbol));
    // Base price spread across a realistic range; volatility spread so the
    // universe has both sleepy large-caps and jumpy small-caps.
    const basePrice = 50 + Math.floor(rand() * 4000);
    const sigmaDaily = this.sigmaOverride[symbol] ?? 0.004 + rand() * 0.036; // 0.4%–4%/day
    const ticksPerDay = (6.25 * 3600 * 1000) / this.tickMs;
    return {
      price: basePrice,
      prevClose: basePrice,
      dayHigh: basePrice,
      dayLow: basePrice,
      // Stable 52w band around the base; expands if price later breaks it.
      weekHigh: round4(basePrice * (1.05 + rand() * 0.35)),
      weekLow: round4(basePrice * (0.6 + rand() * 0.3)),
      volume: 0,
      sigmaPerTick: sigmaDaily / Math.sqrt(ticksPerDay),
      meanVolumePerTick: 500 + Math.floor(rand() * 5000),
      rand,
      lastAsOf: 0,
    };
  }

  private nextTick(symbol: string, now: number): Tick {
    const s = this.state.get(symbol)!;
    // Box–Muller for a normal return; occasional fat-tail jump so events fire.
    const u1 = Math.max(s.rand(), 1e-12);
    const u2 = s.rand();
    let r = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2) * s.sigmaPerTick;
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
