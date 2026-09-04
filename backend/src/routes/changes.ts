import { createHash } from "node:crypto";
import { Router } from "express";
import type { Pool } from "pg";
import { z } from "zod";
import { config } from "../config.js";
import { buildDigest, computeChanges, DEFAULT_MULTIPLIER, type EngineItem, type SnapshotPayload } from "../changes/engine.js";
import { loadStats } from "../changes/stats.js";
import { AppError } from "../middleware/errorHandler.js";
import { feedStatus } from "./health.js";
import { formatQuote, type QuoteRow } from "./quotes.js";
import type { Ingestor } from "../market/ingestor.js";

const Query = z.object({ limit: z.coerce.number().int().min(1).max(500).default(20) });

interface ItemRow extends QuoteRow {
  name: string;
  sensitivity: "quiet" | "normal" | "loud";
}

export function changesRouter(pool: Pool, ingestor: Ingestor) {
  const r = Router();

  r.get("/api/watchlists/:id/changes", async (req, res, next) => {
    try {
      const { limit } = Query.parse(req.query);
      const wl = await pool.query("SELECT id FROM watchlists WHERE id = $1 AND user_id = $2", [req.params.id, req.userId]);
      if (wl.rowCount === 0) throw new AppError(404, "NOT_FOUND", "Watchlist not found");

      const items = await pool.query<ItemRow>(
        `SELECT wi.symbol, wi.sensitivity, s.name,
                q.price, q.prev_close, q.day_high, q.day_low, q.week_high, q.week_low, q.volume,
                q.as_of, q.received_at, q.corrected, q.source
           FROM watchlist_items wi
           JOIN symbols s ON s.symbol = wi.symbol
      LEFT JOIN quotes q ON q.symbol = wi.symbol
          WHERE wi.watchlist_id = $1`,
        [req.params.id],
      );

      const cp = await pool.query<{ taken_at: Date; payload: SnapshotPayload }>(
        `SELECT c.taken_at, s.payload FROM checkpoints c JOIN snapshots s ON s.id = c.snapshot_id
          WHERE c.user_id = $1 AND c.watchlist_id = $2`,
        [req.userId, req.params.id],
      );
      const baseline = cp.rows[0] ?? null;
      const now = new Date();
      const elapsedMs = baseline ? now.getTime() - new Date(baseline.taken_at).getTime() : null;

      const symbols = items.rows.map((i) => i.symbol);
      const stats = await loadStats(pool, symbols);

      const engineItems: EngineItem[] = items.rows.map((row) => ({
        symbol: row.symbol,
        name: row.name,
        sensitivity: row.sensitivity,
        quote: row.as_of
          ? {
              price: String(row.price), prevClose: row.prev_close, dayHigh: row.day_high, dayLow: row.day_low,
              volume: Number(row.volume), asOf: new Date(row.as_of).toISOString(), corrected: row.corrected,
            }
          : null,
      }));

      const results = computeChanges(baseline?.payload ?? null, elapsedMs, engineItems, stats, {
        tickMs: config.tickMs,
        zThreshold: config.zThreshold,
        historyWindow: config.historyWindow,
        absThresholdPct: config.absThresholdPct,
        volumeSpikeMultiple: config.volumeSpikeMultiple,
        gapPct: config.gapPct,
        sensitivityMultiplier: DEFAULT_MULTIPLIER,
      });

      // The snapshot is exactly what this response shows. Re-use the latest
      // unpromoted snapshot if nothing changed, so idle polling doesn't write.
      const payload: SnapshotPayload = {};
      for (const row of items.rows) {
        if (!row.as_of) continue;
        payload[row.symbol] = {
          price: String(row.price), asOf: new Date(row.as_of).toISOString(),
          volume: Number(row.volume), dayHigh: row.day_high, dayLow: row.day_low,
        };
      }
      const snapshotId = await mintSnapshot(pool, req.userId, req.params.id, payload);

      const quoteBySymbol = new Map(items.rows.filter((i) => i.as_of).map((i) => [i.symbol, formatQuote(i, now)]));
      const asOfMax = items.rows.reduce<Date | null>((m, i) => (i.as_of && (!m || i.as_of > m) ? new Date(i.as_of) : m), null);
      const baselineKind = baseline ? "checkpoint" : "first-visit";

      const etag = `"${snapshotId}:${asOfMax?.toISOString() ?? "none"}"`;
      if (req.header("if-none-match") === etag) return res.status(304).end();

      const summary = {
        meaningful: results.filter((x) => x.change.kind === "move" || x.change.kind === "event").length,
        total: results.length,
        stale: [...quoteBySymbol.values()].filter((q) => q.stale).length,
        newSinceLast: results.filter((x) => x.change.kind === "new").length,
      };

      res.setHeader("ETag", etag);
      res.json({
        snapshotId,
        baseline: { takenAt: baseline ? new Date(baseline.taken_at).toISOString() : null, kind: baselineKind, awaySeconds: elapsedMs === null ? null : Math.round(elapsedMs / 1000) },
        asOf: asOfMax?.toISOString() ?? null,
        feed: (({ status, lagSeconds }) => ({ status, lagSeconds }))(feedStatus(ingestor.provider.lastTickAt(), now)),
        digest: buildDigest(results, baselineKind, elapsedMs),
        summary,
        // A product decision, not a UI afterthought: how many ranked cards
        // deserve first-glance attention before the rest belong in the full
        // list instead. `items` is already sorted by the engine's own
        // attention ranking, so the client just takes the top N of it.
        attentionBudget: config.attentionBudget,
        items: results.slice(0, limit).map((x) => {
          const quote = quoteBySymbol.get(x.symbol) ?? null;
          return { symbol: x.symbol, name: x.name, quote, stale: quote ? quote.stale : true, change: x.change };
        }),
      });
    } catch (err) {
      next(err);
    }
  });

  return r;
}

async function mintSnapshot(pool: Pool, userId: string, watchlistId: string, payload: SnapshotPayload): Promise<string> {
  const json = JSON.stringify(payload);
  const hash = createHash("sha1").update(json).digest("hex");
  // Scaling fix: dedupe on a 40-byte hash, not a full 18KB jsonb equality
  // scan. Under concurrent polling most requests in the same tick window
  // see an identical latest snapshot and skip the write entirely — the
  // 500-symbol/50-user write storm that scale-check.ts found collapses to
  // one write per actual data change instead of one per request.
  const latest = await pool.query<{ id: string; payload_hash: string | null }>(
    `SELECT id, payload_hash FROM snapshots
      WHERE user_id = $1 AND watchlist_id = $2 ORDER BY taken_at DESC LIMIT 1`,
    [userId, watchlistId],
  );
  if (latest.rows[0]?.payload_hash === hash) return latest.rows[0].id;
  const ins = await pool.query<{ id: string }>(
    "INSERT INTO snapshots (user_id, watchlist_id, payload, payload_hash) VALUES ($1, $2, $3::jsonb, $4) RETURNING id",
    [userId, watchlistId, json, hash],
  );
  // Bounded retention (#2 gap): keep the newest 50 unpromoted snapshots per
  // list; anything older and not referenced by a checkpoint is disposable.
  await pool.query(
    `DELETE FROM snapshots s WHERE s.user_id = $1 AND s.watchlist_id = $2
       AND NOT EXISTS (SELECT 1 FROM checkpoints c WHERE c.snapshot_id = s.id)
       AND NOT EXISTS (SELECT 1 FROM checkpoint_history h WHERE h.snapshot_id = s.id)
       AND s.id NOT IN (
         SELECT id FROM snapshots WHERE user_id = $1 AND watchlist_id = $2 ORDER BY taken_at DESC LIMIT 50
       )`,
    [userId, watchlistId],
  ).catch(() => {});
  return ins.rows[0].id;
}

export function payloadHash(payload: SnapshotPayload) {
  return createHash("sha1").update(JSON.stringify(payload)).digest("hex");
}
