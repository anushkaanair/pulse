// Integration tests for the ingestor's upsert logic against REAL Postgres —
// not mocked, because the invariant lives in a SQL WHERE clause, and the
// only way to trust a SQL invariant is to run it against real SQL. Requires
// the docker-compose Postgres to be up (`docker compose up -d`).
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { Ingestor } from "../market/ingestor.js";
import type { MarketDataProvider, Tick } from "../market/provider.js";
import { NO_FAULTS } from "../market/provider.js";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/watchlist";
const pool = new Pool({ connectionString: DATABASE_URL });

// A provider with no timers — the test pushes ticks by hand and awaits the
// ingestor's write, so ordering is exact and assertions aren't racing a
// setInterval. Fault behavior (out-of-order, duplicate, correction) is
// injected by the TEST itself constructing the sequence, not by the
// provider's own randomness — this isolates "does the upsert enforce the
// invariant" from "does the simulator generate realistic faults" (the
// simulator's own fault injection is proven separately by the torture test).
class ManualProvider implements MarketDataProvider {
  readonly name = "manual";
  private handler: ((t: Tick) => void) | null = null;
  setSymbols() {}
  onTick(handler: (t: Tick) => void) {
    this.handler = handler;
  }
  start() {}
  stop() {}
  setFaults() {
    return { ...NO_FAULTS };
  }
  getFaults() {
    return { ...NO_FAULTS };
  }
  lastTickAt() {
    return null;
  }
  push(t: Tick) {
    this.handler?.(t);
  }
}

function tick(symbol: string, overrides: Partial<Tick> = {}): Tick {
  return {
    symbol,
    price: 100,
    prevClose: 99,
    dayHigh: 101,
    dayLow: 99,
    volume: 1000,
    asOf: new Date("2026-09-04T10:00:00.000Z"),
    seq: 1,
    corrected: false,
    source: "manual",
    ...overrides,
  };
}

describe("Ingestor upsert (real Postgres)", () => {
  let symbol: string;

  beforeAll(async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS symbols (symbol text PRIMARY KEY, name text NOT NULL, exchange text NOT NULL DEFAULT 'NSE');
      CREATE TABLE IF NOT EXISTS quotes (
        symbol text PRIMARY KEY REFERENCES symbols(symbol), price numeric(14,4) NOT NULL,
        prev_close numeric(14,4), day_high numeric(14,4), day_low numeric(14,4),
        volume bigint NOT NULL DEFAULT 0, as_of timestamptz NOT NULL, received_at timestamptz NOT NULL DEFAULT now(),
        seq bigint NOT NULL, corrected boolean NOT NULL DEFAULT false, source text NOT NULL
      );
      CREATE TABLE IF NOT EXISTS quote_history (
        symbol text NOT NULL REFERENCES symbols(symbol), as_of timestamptz NOT NULL,
        price numeric(14,4) NOT NULL, volume bigint NOT NULL DEFAULT 0, PRIMARY KEY (symbol, as_of)
      );
    `);
  });

  beforeEach(async () => {
    symbol = `TEST_${randomUUID().slice(0, 8).toUpperCase()}`;
    await pool.query("INSERT INTO symbols (symbol, name) VALUES ($1, $1)", [symbol]);
  });

  async function quoteRow() {
    const { rows } = await pool.query("SELECT * FROM quotes WHERE symbol = $1", [symbol]);
    return rows[0];
  }
  async function historyCount() {
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM quote_history WHERE symbol = $1", [symbol]);
    return rows[0].n;
  }

  it("applies an in-order tick", async () => {
    const provider = new ManualProvider();
    const ingestor = new Ingestor(pool, provider);
    provider.push(tick(symbol, { price: 100, asOf: new Date("2026-09-04T10:00:00.000Z"), seq: 1 }));
    await ingestor.drain();
    const row = await quoteRow();
    expect(Number(row.price)).toBe(100);
    expect(ingestor.stats.applied).toBe(1);
  });

  it("ignores an out-of-order tick (older as_of arriving after a newer one)", async () => {
    const provider = new ManualProvider();
    const ingestor = new Ingestor(pool, provider);
    provider.push(tick(symbol, { price: 105, asOf: new Date("2026-09-04T10:00:05.000Z"), seq: 2 }));
    await ingestor.drain();
    provider.push(tick(symbol, { price: 100, asOf: new Date("2026-09-04T10:00:00.000Z"), seq: 1 })); // arrives late, older
    await ingestor.drain();
    const row = await quoteRow();
    expect(Number(row.price)).toBe(105); // NOT regressed to the late-arriving older tick
    expect(row.as_of.toISOString()).toBe("2026-09-04T10:00:05.000Z");
    expect(ingestor.stats.ignored).toBe(1);
  });

  it("a duplicate tick (identical as_of and seq) is a no-op, and history doesn't double-count it", async () => {
    const provider = new ManualProvider();
    const ingestor = new Ingestor(pool, provider);
    const t = tick(symbol, { price: 100, asOf: new Date("2026-09-04T10:00:00.000Z"), seq: 1 });
    provider.push(t);
    await ingestor.drain();
    provider.push({ ...t }); // exact duplicate
    await ingestor.drain();
    expect(await historyCount()).toBe(1);
    expect(ingestor.stats.received).toBe(2);
    expect(ingestor.stats.applied).toBe(1); // the upsert condition is false the second time
  });

  it("a correction (same as_of, higher seq, different price) is accepted and flagged, but does not rewrite history", async () => {
    const provider = new ManualProvider();
    const ingestor = new Ingestor(pool, provider);
    const at = new Date("2026-09-04T10:00:00.000Z");
    provider.push(tick(symbol, { price: 100, asOf: at, seq: 1, corrected: false }));
    await ingestor.drain();
    provider.push(tick(symbol, { price: 100.5, asOf: at, seq: 2, corrected: true })); // correction: same instant, higher seq
    await ingestor.drain();

    const row = await quoteRow();
    expect(Number(row.price)).toBe(100.5); // the LIVE quote reflects the correction
    expect(row.corrected).toBe(true);

    const { rows: hist } = await pool.query("SELECT price FROM quote_history WHERE symbol = $1 AND as_of = $2", [symbol, at]);
    expect(hist).toHaveLength(1);
    expect(Number(hist[0].price)).toBe(100); // history keeps the ORIGINAL print, by design — see DECISIONS.md
  });

  it("a tick with the same as_of but LOWER seq than what's stored is ignored (a stray retransmit of an already-superseded correction)", async () => {
    const provider = new ManualProvider();
    const ingestor = new Ingestor(pool, provider);
    const at = new Date("2026-09-04T10:00:00.000Z");
    provider.push(tick(symbol, { price: 100.5, asOf: at, seq: 2, corrected: true }));
    await ingestor.drain();
    provider.push(tick(symbol, { price: 100, asOf: at, seq: 1, corrected: false })); // stale retransmit
    await ingestor.drain();
    const row = await quoteRow();
    expect(Number(row.price)).toBe(100.5); // not regressed
  });

  it("concurrent ticks for different symbols never interfere with each other", async () => {
    const provider = new ManualProvider();
    const ingestor = new Ingestor(pool, provider);
    const other = `TEST_${randomUUID().slice(0, 8).toUpperCase()}`;
    await pool.query("INSERT INTO symbols (symbol, name) VALUES ($1, $1)", [other]);
    provider.push(tick(symbol, { price: 111 }));
    provider.push(tick(other, { price: 222 }));
    await ingestor.drain();
    expect(Number((await quoteRow()).price)).toBe(111);
    const { rows } = await pool.query("SELECT price FROM quotes WHERE symbol = $1", [other]);
    expect(Number(rows[0].price)).toBe(222);
  });

  afterAll(async () => {
    await pool.query("DELETE FROM quote_history WHERE symbol LIKE 'TEST_%'");
    await pool.query("DELETE FROM quotes WHERE symbol LIKE 'TEST_%'");
    await pool.query("DELETE FROM symbols WHERE symbol LIKE 'TEST_%'");
    await pool.end();
  });
});
