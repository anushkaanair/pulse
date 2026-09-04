// The retraction invariant, tested across TWO users against real Postgres.
//
// `symbol_significance` is global and can only latch once per real event.
// Before the event log, /changes reported retractions straight from that
// latch, so whoever polled first consumed it and every other user — who had
// been shown the very same change — watched the card vanish silently. That
// is the exact "silent delete" the project promises never to do, so it gets
// a test that two users are actually served, not one.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import request from "supertest";
import { createApp } from "../app.js";
import { Ingestor } from "../market/ingestor.js";
import type { MarketDataProvider, Tick } from "../market/provider.js";
import { NO_FAULTS } from "../market/provider.js";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/watchlist";
const pool = new Pool({ connectionString: DATABASE_URL });

class SilentProvider implements MarketDataProvider {
  readonly name = "silent";
  setSymbols() {}
  onTick(_handler: (t: Tick) => void) {}
  start() {}
  stop() {}
  setFaults() { return { ...NO_FAULTS }; }
  getFaults() { return { ...NO_FAULTS }; }
  lastTickAt() { return null; }
}

const app = createApp(pool, new Ingestor(pool, new SilentProvider()));
const SYMBOL = "TSTRETRACT";
const USER_A = `vis-a-${randomUUID()}`;
const USER_B = `vis-b-${randomUUID()}`;
const as = (user: string, r: request.Test) => r.set("X-User-Id", user);

const T0 = new Date("2026-09-04T10:00:00.000Z");
const T1 = new Date("2026-09-04T10:00:30.000Z");

/** Write the live quote directly — this test is about read-side projection. */
async function setQuote(price: number, asOf: Date, opts: { corrected?: boolean; seq?: number } = {}) {
  await pool.query(
    `INSERT INTO quotes (symbol, price, prev_close, day_high, day_low, volume, as_of, seq, corrected, source)
     VALUES ($1,$2,100,200,50,1000,$3,$4,$5,'test')
     ON CONFLICT (symbol) DO UPDATE SET price=EXCLUDED.price, as_of=EXCLUDED.as_of,
       seq=EXCLUDED.seq, corrected=EXCLUDED.corrected, received_at=now()`,
    [SYMBOL, price, asOf, opts.seq ?? 1, opts.corrected ?? false],
  );
}

async function setupUser(user: string) {
  const created = await as(user, request(app).post("/api/watchlists").send({ name: `retract-${randomUUID().slice(0, 8)}` }));
  const id = created.body.id as string;
  await as(user, request(app).post(`/api/watchlists/${id}/items`).send({ symbol: SYMBOL }));
  // First /changes mints a snapshot; checkpoint it so this user has a
  // baseline and is therefore eligible to be told about later retractions.
  const first = await as(user, request(app).get(`/api/watchlists/${id}/changes`));
  await as(user, request(app).post(`/api/watchlists/${id}/checkpoint`).send({ snapshotId: first.body.snapshotId }));
  return id;
}

describe("retraction visibility across users (real Postgres)", () => {
  beforeAll(async () => {
    await pool.query(
      "INSERT INTO symbols (symbol, name, exchange) VALUES ($1, $1, 'TEST') ON CONFLICT (symbol) DO NOTHING",
      [SYMBOL],
    );
    await pool.query("DELETE FROM symbol_significance_events WHERE symbol = $1", [SYMBOL]);
    await pool.query("DELETE FROM symbol_significance WHERE symbol = $1", [SYMBOL]);
    await pool.query("DELETE FROM quote_history WHERE symbol = $1", [SYMBOL]);

    // Enough flat history that sigma is real and tiny, so a large jump is
    // unambiguously a "move" and the correction back is unambiguously not.
    for (let i = 0; i < 40; i += 1) {
      await pool.query(
        "INSERT INTO quote_history (symbol, as_of, price, volume) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING",
        [SYMBOL, new Date(T0.getTime() - (40 - i) * 1000), 100 + (i % 2) * 0.01, 1000 + i],
      );
    }
    await setQuote(100, T0);
  });

  it("both users are told about a retraction, not just whoever polled first", async () => {
    const listA = await setupUser(USER_A);
    const listB = await setupUser(USER_B);

    // A big move on tick T1 — both users would be shown this.
    await setQuote(130, T1, { seq: 1 });
    const moveA = await as(USER_A, request(app).get(`/api/watchlists/${listA}/changes`));
    const moveB = await as(USER_B, request(app).get(`/api/watchlists/${listB}/changes`));
    if (!moveA.body.items) throw new Error(`A ${moveA.status}: ${JSON.stringify(moveA.body)}`);
    expect(moveA.body.items[0].change.kind).toBe("move");
    expect(moveB.body.items[0].change.kind).toBe("move");

    // The exchange revises that same tick back to nothing. The first poll
    // after the correction is the ONLY one that can latch the retraction.
    await setQuote(100, T1, { seq: 2, corrected: true });

    const afterA = await as(USER_A, request(app).get(`/api/watchlists/${listA}/changes`));
    const afterB = await as(USER_B, request(app).get(`/api/watchlists/${listB}/changes`));

    expect(afterA.body.retractions.map((r: { symbol: string }) => r.symbol)).toContain(SYMBOL);
    // The real assertion: B polled second and must still be told.
    expect(afterB.body.retractions.map((r: { symbol: string }) => r.symbol)).toContain(SYMBOL);
  });

  afterAll(async () => {
    await pool.query("DELETE FROM watchlists WHERE user_id = ANY($1)", [[USER_A, USER_B]]);
    await pool.query("DELETE FROM symbol_significance_events WHERE symbol = $1", [SYMBOL]);
    await pool.query("DELETE FROM symbol_significance WHERE symbol = $1", [SYMBOL]);
    await pool.query("DELETE FROM quote_history WHERE symbol = $1", [SYMBOL]);
    await pool.query("DELETE FROM quotes WHERE symbol = $1", [SYMBOL]);
    await pool.query("DELETE FROM symbols WHERE symbol = $1", [SYMBOL]);
    await pool.end();
  });
});
