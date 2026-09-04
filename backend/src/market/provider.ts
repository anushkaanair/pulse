// The unreliable dependency, behind an interface. The ingestor only ever
// sees Ticks; whether they come from a simulator or a real exchange feed is
// a deployment choice, not an architectural one.

export interface Tick {
  symbol: string;
  price: number;
  prevClose: number;
  dayHigh: number;
  dayLow: number;
  volume: number;
  asOf: Date;        // exchange time — the ONLY time used for ordering
  seq: number;       // provider sequence; higher seq at the same asOf wins
  corrected: boolean;
  source: string;
}

export interface FaultConfig {
  outage: boolean;        // emit nothing
  delayMs: number;        // hold every tick this long before delivering
  outOfOrderPct: number;  // 0–100: chance a tick is delivered after its successor
  duplicatePct: number;   // 0–100: chance a tick is delivered twice
  correctionPct: number;  // 0–100: chance a tick is followed by a correction (same asOf, higher seq)
}

export const NO_FAULTS: FaultConfig = {
  outage: false,
  delayMs: 0,
  outOfOrderPct: 0,
  duplicatePct: 0,
  correctionPct: 0,
};

export interface MarketDataProvider {
  readonly name: string;
  /** Replace the watched symbol set. Provider polls/emits only these. */
  setSymbols(symbols: string[]): void;
  /** Register the single downstream consumer. */
  onTick(handler: (tick: Tick) => void): void;
  start(): void;
  stop(): void;
  /** Fault injection — a no-op for providers that can't misbehave on command. */
  setFaults(faults: Partial<FaultConfig>): FaultConfig;
  getFaults(): FaultConfig;
  /** Wall-clock time of the last tick delivered downstream, for /health. */
  lastTickAt(): Date | null;
}
