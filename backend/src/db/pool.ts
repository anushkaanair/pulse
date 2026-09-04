import { Pool } from "pg";

// Single shared pool. Everything reads/writes through this — no ad-hoc
// clients — so connection limits and query logging stay centralized.
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.on("error", (err) => {
  // Idle client errors (e.g. DB restarts) must not crash the process.
  // Log and let the pool recover — a crashed API is worse than a slow one.
  // eslint-disable-next-line no-console
  console.error("Unexpected Postgres pool error", err);
});
