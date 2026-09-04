import { Router } from "express";
import type { Pool } from "pg";
import { z } from "zod";
import { config } from "../config.js";

// pg returns numeric as string; we keep it that way all the way to the
// client. Money is never a float in this codebase.
export interface QuoteRow {
  symbol: string;
  price: string;
  prev_close: string | null;
  day_high: string | null;
  day_low: string | null;
  volume: string;
  as_of: Date;
  received_at: Date;
  corrected: boolean;
  source: string;
}

export interface Quote {
  symbol: string;
  price: string;
  prevClose: string | null;
  dayHigh: string | null;
  dayLow: string | null;
  volume: number;
  asOf: string;
  receivedAt: string;
  ageSeconds: number;
  stale: boolean;
  corrected: boolean;
  source: string;
}

export function formatQuote(row: QuoteRow, now = new Date()): Quote {
  const ageSeconds = Math.max(0, Math.round((now.getTime() - new Date(row.as_of).getTime()) / 1000));
  return {
    symbol: row.symbol,
    price: fixed4(row.price),
    prevClose: row.prev_close === null ? null : fixed4(row.prev_close),
    dayHigh: row.day_high === null ? null : fixed4(row.day_high),
    dayLow: row.day_low === null ? null : fixed4(row.day_low),
    volume: Number(row.volume),
    asOf: new Date(row.as_of).toISOString(),
    receivedAt: new Date(row.received_at).toISOString(),
    ageSeconds,
    stale: ageSeconds > config.staleAfterSeconds,
    corrected: row.corrected,
    source: row.source,
  };
}

export function fixed4(s: string | number) {
  return Number(s).toFixed(4);
}

const Query = z.object({
  symbols: z.string().transform((s) => [...new Set(s.split(",").map((x) => x.trim().toUpperCase()).filter(Boolean))]),
});

export function quotesRouter(pool: Pool) {
  const r = Router();
  r.get("/api/quotes", async (req, res, next) => {
    try {
      const { symbols } = Query.parse(req.query);
      if (symbols.length === 0) return res.json([]);
      const { rows } = await pool.query<QuoteRow>(
        `SELECT symbol, price, prev_close, day_high, day_low, volume, as_of, received_at, corrected, source
           FROM quotes WHERE symbol = ANY($1) ORDER BY symbol`,
        [symbols.slice(0, 500)],
      );
      const now = new Date();
      res.json(rows.map((q) => formatQuote(q, now)));
    } catch (err) {
      next(err);
    }
  });
  return r;
}
