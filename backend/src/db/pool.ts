import { Pool } from "pg";

// Single shared pool. Everything reads/writes through this — no ad-hoc
// clients — so connection limits and query logging stay centralized.
//
// max defaults to pg's own default of 10, which is too low for this
// workload: /changes alone does ~4-5 sequential queries per request, so
// under concurrent users those queries queue for a connection even though
// each individual query is fast. Found via scripts/scale-check.ts: 50
// concurrent /changes calls at 500 symbols took ~600ms/request queued vs
// ~40ms for a single request — pure connection contention, not compute.
// 20 is a deliberate, moderate bump, not "as many as possible" — see
// DECISIONS.md.
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.POOL_MAX ?? 20),
});

pool.on("error", (err) => {
  // Idle client errors (e.g. DB restarts) must not crash the process.
  // Log and let the pool recover — a crashed API is worse than a slow one.
  // eslint-disable-next-line no-console
  console.error("Unexpected Postgres pool error", err);
});
