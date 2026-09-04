import { Router } from "express";
import type { Pool } from "pg";
import { z } from "zod";
import { AppError } from "../middleware/errorHandler.js";
import type { SnapshotPayload } from "../changes/engine.js";

const ListQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(30) });
const DiffQuery = z.object({ against: z.string().uuid().optional() });

// Deliberately simpler than /changes: a plain price-then-vs-now diff
// between two historical snapshots, not the statistical "meaningful"
// engine. Re-using computeChanges here would mean inventing fake
// as-of/elapsed semantics for two arbitrary past points — the honest,
// simple thing is "here's what the price was, here's what it became."
export function timelineRouter(pool: Pool) {
  const r = Router();

  r.get("/api/watchlists/:id/timeline", async (req, res, next) => {
    try {
      const { limit } = ListQuery.parse(req.query);
      const owns = await pool.query("SELECT 1 FROM watchlists WHERE id = $1 AND user_id = $2", [req.params.id, req.userId]);
      if (owns.rowCount === 0) throw new AppError(404, "NOT_FOUND", "Watchlist not found");
      const { rows } = await pool.query<{ snapshot_id: string; taken_at: Date }>(
        `SELECT snapshot_id, taken_at FROM checkpoint_history
          WHERE user_id = $1 AND watchlist_id = $2 ORDER BY taken_at DESC LIMIT $3`,
        [req.userId, req.params.id, limit],
      );
      res.json({
        visits: rows.map((row) => ({ snapshotId: row.snapshot_id, takenAt: new Date(row.taken_at).toISOString() })),
      });
    } catch (err) {
      next(err);
    }
  });

  r.get("/api/watchlists/:id/timeline/:snapshotId/diff", async (req, res, next) => {
    try {
      const { against } = DiffQuery.parse(req.query);
      const owns = await pool.query("SELECT 1 FROM watchlists WHERE id = $1 AND user_id = $2", [req.params.id, req.userId]);
      if (owns.rowCount === 0) throw new AppError(404, "NOT_FOUND", "Watchlist not found");

      const target = await loadSnapshot(pool, req.params.snapshotId, req.userId, req.params.id);
      if (!target) throw new AppError(404, "SNAPSHOT_NOT_FOUND", "Snapshot not found");

      let baseline: { payload: SnapshotPayload; takenAt: Date } | null = null;
      if (against) {
        baseline = await loadSnapshot(pool, against, req.userId, req.params.id);
        if (!baseline) throw new AppError(404, "SNAPSHOT_NOT_FOUND", "Comparison snapshot not found");
      } else {
        // Default: the visit immediately before this one in the timeline.
        const prev = await pool.query<{ snapshot_id: string }>(
          `SELECT snapshot_id FROM checkpoint_history
            WHERE user_id = $1 AND watchlist_id = $2 AND taken_at < $3
            ORDER BY taken_at DESC LIMIT 1`,
          [req.userId, req.params.id, target.takenAt],
        );
        if (prev.rowCount) baseline = await loadSnapshot(pool, prev.rows[0].snapshot_id, req.userId, req.params.id);
      }

      const symbolsRes = await pool.query<{ symbol: string; name: string }>(
        "SELECT symbol, name FROM symbols WHERE symbol = ANY($1)",
        [[...new Set([...Object.keys(target.payload), ...Object.keys(baseline?.payload ?? {})])]],
      );
      const names = new Map(symbolsRes.rows.map((r) => [r.symbol, r.name]));

      const symbols = new Set([...Object.keys(target.payload), ...Object.keys(baseline?.payload ?? {})]);
      const items = [...symbols].map((symbol) => {
        const before = baseline?.payload[symbol];
        const after = target.payload[symbol];
        const priceBefore = before ? Number(before.price) : null;
        const priceAfter = after ? Number(after.price) : null;
        const pct = priceBefore && priceAfter ? (((priceAfter - priceBefore) / priceBefore) * 100).toFixed(2) : null;
        return {
          symbol,
          name: names.get(symbol) ?? symbol,
          priceBefore: before?.price ?? null,
          priceAfter: after?.price ?? null,
          pct,
          status: !before ? "added" : !after ? "removed" : "tracked",
        };
      });
      items.sort((a, b) => Math.abs(Number(b.pct ?? 0)) - Math.abs(Number(a.pct ?? 0)));

      res.json({
        takenAt: target.takenAt.toISOString(),
        comparedTo: baseline ? baseline.takenAt.toISOString() : null,
        items,
      });
    } catch (err) {
      next(err);
    }
  });

  return r;
}

async function loadSnapshot(pool: Pool, snapshotId: string, userId: string, watchlistId: string) {
  const { rows } = await pool.query<{ payload: SnapshotPayload; taken_at: Date }>(
    "SELECT payload, taken_at FROM snapshots WHERE id = $1 AND user_id = $2 AND watchlist_id = $3",
    [snapshotId, userId, watchlistId],
  );
  return rows[0] ? { payload: rows[0].payload, takenAt: new Date(rows[0].taken_at) } : null;
}
