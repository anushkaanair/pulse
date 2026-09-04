import { Router } from "express";
import type { Pool } from "pg";
import { z } from "zod";

const Query = z.object({ q: z.string().trim().max(32).optional() });

export function symbolsRouter(pool: Pool) {
  const r = Router();
  r.get("/api/symbols", async (req, res, next) => {
    try {
      const { q } = Query.parse(req.query);
      // is_index rows (the market index proxy) are an internal signal, not
      // a stock — never surfaced for a user to add to their own watchlist.
      const { rows } = q
        ? await pool.query(
            `SELECT symbol, name, exchange FROM symbols
             WHERE NOT is_index AND (symbol ILIKE $1 OR name ILIKE $1)
             ORDER BY (symbol ILIKE $2) DESC, symbol LIMIT 20`,
            [`%${q}%`, `${q}%`],
          )
        : await pool.query("SELECT symbol, name, exchange FROM symbols WHERE NOT is_index ORDER BY symbol LIMIT 100");
      res.json(rows);
    } catch (err) {
      next(err);
    }
  });
  return r;
}
