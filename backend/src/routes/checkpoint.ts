import { Router } from "express";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { AppError } from "../middleware/errorHandler.js";

const Body = z.object({ snapshotId: z.string().uuid() });

interface CheckpointResult { status: number; body: { takenAt: string } }

// A retried POST (flaky mobile network, a client timeout while the first
// attempt was still in flight, a double-tap) must not race itself: two
// concurrent identical requests could both pass the "is this a new visit"
// check in checkpoint_history before either commits, producing two rows for
// one real visit. An idempotency key closes that — an in-flight OR already-
// resolved attempt under the same key is awaited/replayed, never re-run.
// Scoped per (user, watchlist, key); only successes are cached — a genuine
// failure is retriable fresh, not stuck replaying an error. TTL-bounded and
// in-memory: proportionate for a single-process app, same "one process"
// assumption the ingestor already makes (see ingestor.ts).
const IDEMPOTENCY_TTL_MS = 5 * 60_000;
const idempotencyCache = new Map<string, Promise<CheckpointResult>>();

// "Mark as seen" promotes a specific snapshot — the one this user was shown —
// never "now". That closes the race between rendering and acknowledging.
export function checkpointRouter(pool: Pool) {
  const r = Router();
  r.post("/api/watchlists/:id/checkpoint", async (req, res, next) => {
    const idempotencyKey = req.header("Idempotency-Key");
    const cacheKey = idempotencyKey ? `${req.userId}:${req.params.id}:${idempotencyKey}` : undefined;

    if (cacheKey) {
      const inFlight = idempotencyCache.get(cacheKey);
      if (inFlight) {
        try {
          const cached = await inFlight;
          res.status(cached.status).json(cached.body);
        } catch (err) {
          next(err);
        }
        return;
      }
    }

    const attempt = execute(pool, req.userId, req.params.id, req.body);
    if (cacheKey) {
      idempotencyCache.set(cacheKey, attempt);
      attempt
        .then(() => setTimeout(() => idempotencyCache.delete(cacheKey), IDEMPOTENCY_TTL_MS))
        .catch(() => idempotencyCache.delete(cacheKey)); // failures aren't cached — retriable immediately
    }

    try {
      const result = await attempt;
      res.status(result.status).json(result.body);
    } catch (err) {
      next(err);
    }
  });
  return r;
}

async function execute(pool: Pool, userId: string, watchlistId: string, body: unknown): Promise<CheckpointResult> {
  // `pool.connect()` itself can reject (pool exhausted / a stalled
  // connection past connectionTimeoutMillis — see db/pool.ts) — it MUST
  // be inside this try, not before it. Express 4 doesn't auto-catch a
  // rejected promise from an async handler; outside the try, that
  // rejection becomes an unhandled rejection and crashes the whole
  // process instead of returning a clean 503. Reproduced live under
  // torture-test load before this fix — a real bug, not hypothetical.
  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
    const { snapshotId } = Body.parse(body);
    const snap = await client.query<{ user_id: string; watchlist_id: string; taken_at: Date }>(
      "SELECT user_id, watchlist_id, taken_at FROM snapshots WHERE id = $1",
      [snapshotId],
    );
    if (snap.rowCount === 0) throw new AppError(404, "SNAPSHOT_NOT_FOUND", "Snapshot not found");
    const s = snap.rows[0];
    if (s.user_id !== userId || s.watchlist_id !== watchlistId) {
      throw new AppError(409, "SNAPSHOT_MISMATCH", "Snapshot belongs to a different user or watchlist");
    }
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO checkpoints (user_id, watchlist_id, snapshot_id, taken_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, watchlist_id) DO UPDATE
         SET snapshot_id = EXCLUDED.snapshot_id, taken_at = EXCLUDED.taken_at
       WHERE checkpoints.taken_at <= EXCLUDED.taken_at`, // never move "seen" backwards
      [userId, watchlistId, snapshotId, s.taken_at],
    );
    // Append to the visit timeline — but skip if this exact snapshot is
    // already the most recent entry, so a double-click doesn't create two
    // near-identical "visits" a few milliseconds apart.
    const last = await client.query<{ snapshot_id: string }>(
      `SELECT snapshot_id FROM checkpoint_history
        WHERE user_id = $1 AND watchlist_id = $2 ORDER BY taken_at DESC LIMIT 1`,
      [userId, watchlistId],
    );
    if (last.rows[0]?.snapshot_id !== snapshotId) {
      await client.query(
        `INSERT INTO checkpoint_history (user_id, watchlist_id, snapshot_id, taken_at) VALUES ($1, $2, $3, $4)`,
        [userId, watchlistId, snapshotId, s.taken_at],
      );
    }
    await client.query("COMMIT");
    return { status: 201, body: { takenAt: new Date(s.taken_at).toISOString() } };
  } catch (err) {
    await client?.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client?.release();
  }
}
