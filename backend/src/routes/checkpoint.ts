import { Router } from "express";
import type { Pool } from "pg";
import { z } from "zod";
import { AppError } from "../middleware/errorHandler.js";

const Body = z.object({ snapshotId: z.string().uuid() });

// "Mark as seen" promotes a specific snapshot — the one this user was shown —
// never "now". That closes the race between rendering and acknowledging.
export function checkpointRouter(pool: Pool) {
  const r = Router();
  r.post("/api/watchlists/:id/checkpoint", async (req, res, next) => {
    try {
      const { snapshotId } = Body.parse(req.body);
      const snap = await pool.query<{ user_id: string; watchlist_id: string; taken_at: Date }>(
        "SELECT user_id, watchlist_id, taken_at FROM snapshots WHERE id = $1",
        [snapshotId],
      );
      if (snap.rowCount === 0) throw new AppError(404, "SNAPSHOT_NOT_FOUND", "Snapshot not found");
      const s = snap.rows[0];
      if (s.user_id !== req.userId || s.watchlist_id !== req.params.id) {
        throw new AppError(409, "SNAPSHOT_MISMATCH", "Snapshot belongs to a different user or watchlist");
      }
      await pool.query(
        `INSERT INTO checkpoints (user_id, watchlist_id, snapshot_id, taken_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, watchlist_id) DO UPDATE
           SET snapshot_id = EXCLUDED.snapshot_id, taken_at = EXCLUDED.taken_at
         WHERE checkpoints.taken_at <= EXCLUDED.taken_at`, // never move "seen" backwards
        [req.userId, req.params.id, snapshotId, s.taken_at],
      );
      res.status(201).json({ takenAt: new Date(s.taken_at).toISOString() });
    } catch (err) {
      next(err);
    }
  });
  return r;
}
