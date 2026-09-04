import { Router } from "express";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { AppError } from "../middleware/errorHandler.js";

const Body = z.object({ snapshotId: z.string().uuid() });

// "Mark as seen" promotes a specific snapshot — the one this user was shown —
// never "now". That closes the race between rendering and acknowledging.
export function checkpointRouter(pool: Pool) {
  const r = Router();
  r.post("/api/watchlists/:id/checkpoint", async (req, res, next) => {
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
      const { snapshotId } = Body.parse(req.body);
      const snap = await client.query<{ user_id: string; watchlist_id: string; taken_at: Date }>(
        "SELECT user_id, watchlist_id, taken_at FROM snapshots WHERE id = $1",
        [snapshotId],
      );
      if (snap.rowCount === 0) throw new AppError(404, "SNAPSHOT_NOT_FOUND", "Snapshot not found");
      const s = snap.rows[0];
      if (s.user_id !== req.userId || s.watchlist_id !== req.params.id) {
        throw new AppError(409, "SNAPSHOT_MISMATCH", "Snapshot belongs to a different user or watchlist");
      }
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO checkpoints (user_id, watchlist_id, snapshot_id, taken_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, watchlist_id) DO UPDATE
           SET snapshot_id = EXCLUDED.snapshot_id, taken_at = EXCLUDED.taken_at
         WHERE checkpoints.taken_at <= EXCLUDED.taken_at`, // never move "seen" backwards
        [req.userId, req.params.id, snapshotId, s.taken_at],
      );
      // Append to the visit timeline — but skip if this exact snapshot is
      // already the most recent entry, so a double-click doesn't create two
      // near-identical "visits" a few milliseconds apart.
      const last = await client.query<{ snapshot_id: string }>(
        `SELECT snapshot_id FROM checkpoint_history
          WHERE user_id = $1 AND watchlist_id = $2 ORDER BY taken_at DESC LIMIT 1`,
        [req.userId, req.params.id],
      );
      if (last.rows[0]?.snapshot_id !== snapshotId) {
        await client.query(
          `INSERT INTO checkpoint_history (user_id, watchlist_id, snapshot_id, taken_at) VALUES ($1, $2, $3, $4)`,
          [req.userId, req.params.id, snapshotId, s.taken_at],
        );
      }
      await client.query("COMMIT");
      res.status(201).json({ takenAt: new Date(s.taken_at).toISOString() });
    } catch (err) {
      await client?.query("ROLLBACK").catch(() => {});
      next(err);
    } finally {
      client?.release();
    }
  });
  return r;
}
