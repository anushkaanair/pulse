// Hardening behaviour that is easy to regress silently: a limiter that
// stops limiting, a CORS allowlist that quietly becomes a mirror again, or
// a health probe that starts being throttled. None of these fail loudly on
// their own, so they get assertions.
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// vi.hoisted, not vi.stubEnv: `config` is evaluated once at import time, and
// ES module imports are hoisted above the module body — so a stub written in
// the body lands after config has already frozen the defaults. This runs
// before any import is evaluated, which is the only point where it can
// actually affect the limits under test.
vi.hoisted(() => {
  process.env.RATE_LIMIT_RPM = "60";
  process.env.RATE_LIMIT_BURST = "3";
});
import { Pool } from "pg";
import request from "supertest";
import { createApp } from "../app.js";
import { Ingestor } from "../market/ingestor.js";
import type { MarketDataProvider, Tick } from "../market/provider.js";
import { NO_FAULTS } from "../market/provider.js";
import { resetRateLimit } from "../middleware/rateLimit.js";

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

describe("hardening", () => {
  beforeEach(() => resetRateLimit());

  it("serves security headers and never advertises the framework", async () => {
    const res = await request(app).get("/health");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("DENY");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  it("allows a configured browser origin", async () => {
    const res = await request(app).get("/health").set("Origin", "http://localhost:3000");
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
    // Without Vary, a shared cache can hand one origin's CORS headers to another.
    expect(res.headers.vary).toContain("Origin");
  });

  it("does NOT reflect an unknown origin back as permitted", async () => {
    const res = await request(app).get("/health").set("Origin", "https://evil.example");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("limits a single identity to its burst, then answers 429 with Retry-After", async () => {
    const user = `rl-${randomUUID()}`;
    const codes: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      const res = await request(app).get("/api/watchlists").set("X-User-Id", user);
      codes.push(res.status);
    }
    expect(codes.filter((c) => c === 429).length).toBeGreaterThan(0);
    const limited = await request(app).get("/api/watchlists").set("X-User-Id", user);
    expect(limited.status).toBe(429);
    expect(limited.body.code).toBe("RATE_LIMITED");
    expect(limited.headers["retry-after"]).toBeDefined();
  });

  it("budgets per identity, so one noisy client can't starve another", async () => {
    const loud = `rl-loud-${randomUUID()}`;
    const quiet = `rl-quiet-${randomUUID()}`;
    for (let i = 0; i < 8; i += 1) await request(app).get("/api/watchlists").set("X-User-Id", loud);
    const victim = await request(app).get("/api/watchlists").set("X-User-Id", quiet);
    expect(victim.status).toBe(200);
  });

  it("never throttles the health probe — it reports liveness under exactly the load that triggers limiting", async () => {
    const user = `rl-health-${randomUUID()}`;
    for (let i = 0; i < 8; i += 1) await request(app).get("/api/watchlists").set("X-User-Id", user);
    const health = await request(app).get("/health").set("X-User-Id", user);
    expect(health.status).not.toBe(429);
  });

  afterAll(async () => {
    await pool.end();
  });
});
