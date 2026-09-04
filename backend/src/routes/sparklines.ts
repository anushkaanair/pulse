import { Router } from "express";
import type { Pool } from "pg";
import { z } from "zod";
import { AppError } from "../middleware/errorHandler.js";

const Query = z.object({ limit: z.coerce.number().int().min(2).max(200).default(30) });

// One batched query for every symbol in the watchlist — the same lesson
// scripts/scale-check.ts already taught the rest of this codebase: never
// loop a query per symbol when a window function does it in one round trip.
export function sparklinesRouter(pool: Pool) {
  const r = Router();
  r.get("/api/watchlists/:id/sparklines", async (req, res, next) => {
    try {
      const { limit } = Query.parse(req.query);
      const owns = await pool.query("SELECT 1 FROM watchlists WHERE id = $1 AND user_id = $2", [req.params.id, req.userId]);
      if (owns.rowCount === 0) throw new AppError(404, "NOT_FOUND", "Watchlist not found");

      const { rows } = await pool.query<{ symbol: string; as_of: Date; price: string }>(
        `SELECT symbol, as_of, price FROM (
           SELECT h.symbol, h.as_of, h.price,
                  row_number() OVER (PARTITION BY h.symbol ORDER BY h.as_of DESC) AS rn
             FROM quote_history h
             JOIN watchlist_items wi ON wi.symbol = h.symbol
            WHERE wi.watchlist_id = $1
         ) t WHERE rn <= $2
         ORDER BY symbol, as_of ASC`,
        [req.params.id, limit],
      );

      const bySymbol: Record<string, { asOf: string; price: string }[]> = {};
      for (const row of rows) {
        (bySymbol[row.symbol] ??= []).push({ asOf: new Date(row.as_of).toISOString(), price: row.price });
      }
      res.json(bySymbol);
    } catch (err) {
      next(err);
    }
  });
  return r;
}
