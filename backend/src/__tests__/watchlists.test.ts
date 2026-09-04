// Integration tests for watchlist mutation routes against REAL Postgres.
// These cover the things that only break when SQL actually runs: whether a
// bulk replace preserves per-symbol state it never claimed to touch, and
// whether the `version` used for optimistic concurrency is bumped in the
// same transaction as the mutation it describes.
//
// Requires the docker-compose Postgres to be up and migrated
// (`docker compose up -d && npm run migrate`).
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

/** No timers, no ticks — these tests are about the HTTP/SQL layer only. */
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
const USER = `test-user-${randomUUID()}`;
const as = (r: request.Test) => r.set("X-User-Id", USER);

const SYMBOLS = ["TSTA", "TSTB", "TSTC"];

async function newList(name: string) {
  const res = await as(request(app).post("/api/watchlists").send({ name }));
  expect(res.status).toBe(201);
  return res.body.id as string;
}

async function sensitivityOf(listId: string, symbol: string) {
  const { rows } = await pool.query<{ sensitivity: string }>(
    "SELECT sensitivity FROM watchlist_items WHERE watchlist_id = $1 AND symbol = $2",
    [listId, symbol],
  );
  return rows[0]?.sensitivity ?? null;
}

async function versionOf(listId: string) {
  const { rows } = await pool.query<{ version: number }>("SELECT version FROM watchlists WHERE id = $1", [listId]);
  return rows[0].version;
}

describe("watchlist mutations (real Postgres)", () => {
  beforeAll(async () => {
    for (const s of SYMBOLS) {
      await pool.query(
        "INSERT INTO symbols (symbol, name, exchange) VALUES ($1, $1, 'TEST') ON CONFLICT (symbol) DO NOTHING",
        [s],
      );
    }
  });

  it("a bulk replace preserves per-symbol sensitivity for symbols that survive the edit", async () => {
    const id = await newList(`sens-${randomUUID().slice(0, 8)}`);
    await as(request(app).post(`/api/watchlists/${id}/items`).send({ symbol: "TSTA" }));
    await as(request(app).patch(`/api/watchlists/${id}/items/TSTA`).send({ sensitivity: "quiet" }));
    expect(await sensitivityOf(id, "TSTA")).toBe("quiet");

    // Add a second symbol via bulk replace. TSTA is still in the list, so
    // the user never asked for anything about TSTA to change — a bulk edit
    // that silently resets it to "normal" is data loss of a setting the
    // product treats as a headline feature.
    const version = await versionOf(id);
    const res = await as(request(app).put(`/api/watchlists/${id}/items`).send({ symbols: ["TSTA", "TSTB"], version }));
    expect(res.status).toBe(200);

    expect(await sensitivityOf(id, "TSTA")).toBe("quiet");
    expect(await sensitivityOf(id, "TSTB")).toBe("normal");
  });

  it("a bulk replace keeps the original added_at of surviving symbols, so the list doesn't reorder itself", async () => {
    const id = await newList(`order-${randomUUID().slice(0, 8)}`);
    await as(request(app).post(`/api/watchlists/${id}/items`).send({ symbol: "TSTC" }));
    const { rows: before } = await pool.query<{ added_at: Date }>(
      "SELECT added_at FROM watchlist_items WHERE watchlist_id = $1 AND symbol = 'TSTC'", [id],
    );

    const version = await versionOf(id);
    await as(request(app).put(`/api/watchlists/${id}/items`).send({ symbols: ["TSTC", "TSTA"], version }));

    const { rows: after } = await pool.query<{ added_at: Date }>(
      "SELECT added_at FROM watchlist_items WHERE watchlist_id = $1 AND symbol = 'TSTC'", [id],
    );
    expect(after[0].added_at.getTime()).toBe(before[0].added_at.getTime());
  });

  it("a bulk replace still removes symbols dropped from the list", async () => {
    const id = await newList(`drop-${randomUUID().slice(0, 8)}`);
    await as(request(app).put(`/api/watchlists/${id}/items`).send({ symbols: ["TSTA", "TSTB"], version: await versionOf(id) }));
    await as(request(app).put(`/api/watchlists/${id}/items`).send({ symbols: ["TSTB"], version: await versionOf(id) }));

    const { rows } = await pool.query<{ symbol: string }>(
      "SELECT symbol FROM watchlist_items WHERE watchlist_id = $1 ORDER BY symbol", [id],
    );
    expect(rows.map((r) => r.symbol)).toEqual(["TSTB"]);
  });

  it("removing an item bumps the version, so a concurrent bulk edit still conflicts", async () => {
    const id = await newList(`ver-del-${randomUUID().slice(0, 8)}`);
    await as(request(app).post(`/api/watchlists/${id}/items`).send({ symbol: "TSTA" }));
    const stale = await versionOf(id);

    await as(request(app).delete(`/api/watchlists/${id}/items/TSTA`));
    expect(await versionOf(id)).toBe(stale + 1);

    // A client holding the pre-delete version must be told, not silently win.
    const res = await as(request(app).put(`/api/watchlists/${id}/items`).send({ symbols: ["TSTB"], version: stale }));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("VERSION_CONFLICT");
  });

  it("changing sensitivity bumps the version too", async () => {
    const id = await newList(`ver-sens-${randomUUID().slice(0, 8)}`);
    await as(request(app).post(`/api/watchlists/${id}/items`).send({ symbol: "TSTA" }));
    const before = await versionOf(id);
    await as(request(app).patch(`/api/watchlists/${id}/items/TSTA`).send({ sensitivity: "loud" }));
    expect(await versionOf(id)).toBe(before + 1);
  });

  afterAll(async () => {
    await pool.query("DELETE FROM watchlists WHERE user_id = $1", [USER]); // cascades to items
    // Scoped to THIS file's symbols, not `exchange = 'TEST'`: vitest runs
    // test files in parallel, and a blanket delete rips fixture symbols out
    // from under whichever sibling suite is mid-run.
    await pool.query("DELETE FROM symbols WHERE symbol = ANY($1)", [SYMBOLS]);
    await pool.end();
  });
});
