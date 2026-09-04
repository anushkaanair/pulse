import { Router } from "express";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { config } from "../config.js";
import { AppError } from "../middleware/errorHandler.js";
import { requireUserId } from "../middleware/userId.js";
import { formatQuote, type QuoteRow } from "./quotes.js";

const Name = z.object({ name: z.string().trim().min(1).max(64) });
const Symbol = z.object({ symbol: z.string().trim().toUpperCase().min(1).max(20) });
const Bulk = z.object({
  symbols: z.array(z.string().trim().toUpperCase().min(1).max(20)).max(500),
  version: z.number().int().positive(),
});

async function loadWatchlist(db: Pool | PoolClient, userId: string, id: string) {
  const wl = await db.query(
    "SELECT id, name, version FROM watchlists WHERE id = $1 AND user_id = $2",
    [id, userId],
  );
  if (wl.rowCount === 0) throw new AppError(404, "NOT_FOUND", "Watchlist not found");
  const items = await db.query<QuoteRow & { name: string; sensitivity: string }>(
    `SELECT wi.symbol, wi.sensitivity, s.name,
            q.price, q.prev_close, q.day_high, q.day_low, q.week_high, q.week_low, q.volume,
            q.as_of, q.received_at, q.corrected, q.source
       FROM watchlist_items wi
       JOIN symbols s ON s.symbol = wi.symbol
  LEFT JOIN quotes q ON q.symbol = wi.symbol
      WHERE wi.watchlist_id = $1
   ORDER BY wi.added_at, wi.symbol`,
    [id],
  );
  const now = new Date();
  return {
    ...wl.rows[0],
    items: items.rows.map((row) => {
      const quote = row.as_of ? formatQuote(row, now) : null;
      return { symbol: row.symbol, name: row.name, sensitivity: row.sensitivity, quote, stale: quote ? quote.stale : true };
    }),
  };
}

function isUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

export function watchlistsRouter(pool: Pool) {
  const r = Router();
  r.use("/api/watchlists", requireUserId);

  r.post("/api/watchlists", async (req, res, next) => {
    try {
      const { name } = Name.parse(req.body);
      const { rows } = await pool.query(
        "INSERT INTO watchlists (user_id, name) VALUES ($1, $2) RETURNING id, name, version",
        [req.userId, name],
      );
      res.status(201).json({ ...rows[0], items: [] });
    } catch (err) {
      next(err);
    }
  });

  r.get("/api/watchlists", async (req, res, next) => {
    try {
      const { rows } = await pool.query(
        `SELECT w.id, w.name, w.version, w.updated_at AS "updatedAt",
                (SELECT count(*)::int FROM watchlist_items wi WHERE wi.watchlist_id = w.id) AS "itemCount"
           FROM watchlists w WHERE w.user_id = $1 ORDER BY w.created_at`,
        [req.userId],
      );
      res.json(rows);
    } catch (err) {
      next(err);
    }
  });

  r.get("/api/watchlists/:id", async (req, res, next) => {
    try {
      if (!isUuid(req.params.id)) throw new AppError(404, "NOT_FOUND", "Watchlist not found");
      res.json(await loadWatchlist(pool, req.userId, req.params.id));
    } catch (err) {
      next(err);
    }
  });

  // Idempotent: adding a symbol that's already there is a 200, not an error.
  // A double-tap or a retried request must not surface as a failure.
  r.post("/api/watchlists/:id/items", async (req, res, next) => {
    // pool.connect() must be inside the try — see checkpoint.ts for why a
    // rejected connect() outside it crashes the whole process instead of
    // returning a clean error.
    let client: PoolClient | undefined;
    try {
      client = await pool.connect();
      if (!isUuid(req.params.id)) throw new AppError(404, "NOT_FOUND", "Watchlist not found");
      const { symbol } = Symbol.parse(req.body);
      await client.query("BEGIN");
      const known = await client.query("SELECT 1 FROM symbols WHERE symbol = $1 AND NOT is_index", [symbol]);
      if (known.rowCount === 0) throw new AppError(422, "UNKNOWN_SYMBOL", `Unknown symbol ${symbol}`);
      const owned = await client.query(
        "SELECT 1 FROM watchlists WHERE id = $1 AND user_id = $2 FOR UPDATE",
        [req.params.id, req.userId],
      );
      if (owned.rowCount === 0) throw new AppError(404, "NOT_FOUND", "Watchlist not found");
      const ins = await client.query(
        "INSERT INTO watchlist_items (watchlist_id, symbol) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        [req.params.id, symbol],
      );
      if (ins.rowCount === 1) {
        await client.query(
          "UPDATE watchlists SET version = version + 1, updated_at = now() WHERE id = $1",
          [req.params.id],
        );
      }
      await client.query("COMMIT");
      res.json(await loadWatchlist(pool, req.userId, req.params.id));
    } catch (err) {
      await client?.query("ROLLBACK").catch(() => {});
      next(err);
    } finally {
      client?.release();
    }
  });

  r.delete("/api/watchlists/:id/items/:symbol", async (req, res, next) => {
    try {
      if (!isUuid(req.params.id)) throw new AppError(404, "NOT_FOUND", "Watchlist not found");
      const symbol = req.params.symbol.toUpperCase();
      const del = await pool.query(
        `DELETE FROM watchlist_items wi USING watchlists w
          WHERE wi.watchlist_id = w.id AND w.id = $1 AND w.user_id = $2 AND wi.symbol = $3`,
        [req.params.id, req.userId, symbol],
      );
      if (del.rowCount === 1) {
        await pool.query(
          "UPDATE watchlists SET version = version + 1, updated_at = now() WHERE id = $1",
          [req.params.id],
        );
      }
      res.json(await loadWatchlist(pool, req.userId, req.params.id));
    } catch (err) {
      next(err);
    }
  });

  // Per-symbol sensitivity: quiet raises the bar for "meaningful", loud lowers it.
  r.patch("/api/watchlists/:id/items/:symbol", async (req, res, next) => {
    try {
      if (!isUuid(req.params.id)) throw new AppError(404, "NOT_FOUND", "Watchlist not found");
      const { sensitivity } = z.object({ sensitivity: z.enum(["quiet", "normal", "loud"]) }).parse(req.body);
      const symbol = req.params.symbol.toUpperCase();
      const upd = await pool.query(
        `UPDATE watchlist_items wi SET sensitivity = $4 FROM watchlists w
          WHERE wi.watchlist_id = w.id AND w.id = $1 AND w.user_id = $2 AND wi.symbol = $3`,
        [req.params.id, req.userId, symbol, sensitivity],
      );
      if (upd.rowCount === 0) throw new AppError(404, "NOT_FOUND", "Symbol not on this watchlist");
      await pool.query("UPDATE watchlists SET version = version + 1, updated_at = now() WHERE id = $1", [req.params.id]);
      res.json(await loadWatchlist(pool, req.userId, req.params.id));
    } catch (err) {
      next(err);
    }
  });

  // Bulk replace with optimistic concurrency. Two devices editing the same
  // list: the second writer gets a 409 carrying the current state, and the
  // client merges. No silent last-writer-wins.
  r.put("/api/watchlists/:id/items", async (req, res, next) => {
    // pool.connect() must be inside the try — see checkpoint.ts for why.
    let client: PoolClient | undefined;
    try {
      client = await pool.connect();
      if (!isUuid(req.params.id)) throw new AppError(404, "NOT_FOUND", "Watchlist not found");
      const { symbols, version } = Bulk.parse(req.body);
      await client.query("BEGIN");
      const cur = await client.query<{ version: number }>(
        "SELECT version FROM watchlists WHERE id = $1 AND user_id = $2 FOR UPDATE",
        [req.params.id, req.userId],
      );
      if (cur.rowCount === 0) throw new AppError(404, "NOT_FOUND", "Watchlist not found");
      if (cur.rows[0].version !== version) {
        await client.query("ROLLBACK");
        const current = await loadWatchlist(pool, req.userId, req.params.id);
        return res.status(409).json({
          error: "Watchlist was modified elsewhere",
          code: "VERSION_CONFLICT",
          current: { version: current.version, items: current.items },
        });
      }
      const unique = [...new Set(symbols)];
      if (unique.length > 0) {
        const known = await client.query<{ symbol: string }>(
          "SELECT symbol FROM symbols WHERE symbol = ANY($1) AND NOT is_index",
          [unique],
        );
        if (known.rowCount !== unique.length) {
          const ok = new Set(known.rows.map((r) => r.symbol));
          const bad = unique.filter((s) => !ok.has(s));
          throw new AppError(422, "UNKNOWN_SYMBOL", `Unknown symbol(s): ${bad.join(", ")}`);
        }
      }
      await client.query("DELETE FROM watchlist_items WHERE watchlist_id = $1", [req.params.id]);
      if (unique.length > 0) {
        // Single multi-row INSERT via UNNEST, not N sequential round-trips.
        // Found via scripts/scale-check.ts: a 500-symbol bulk PUT looping
        // one INSERT per row took ~500ms of pure round-trip time before
        // any real work, and that cost only grows with watchlist size —
        // exactly the "how does this scale" case the brief asks about.
        await client.query(
          `INSERT INTO watchlist_items (watchlist_id, symbol)
           SELECT $1, s FROM unnest($2::text[]) AS s`,
          [req.params.id, unique],
        );
      }
      await client.query(
        "UPDATE watchlists SET version = version + 1, updated_at = now() WHERE id = $1",
        [req.params.id],
      );
      await client.query("COMMIT");
      res.json(await loadWatchlist(pool, req.userId, req.params.id));
    } catch (err) {
      await client?.query("ROLLBACK").catch(() => {});
      next(err);
    } finally {
      client?.release();
    }
  });

  return r;
}

export { loadWatchlist };
export const staleAfterSeconds = config.staleAfterSeconds;
