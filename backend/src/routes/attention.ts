import { Router } from "express";
import type { Pool } from "pg";
import { z } from "zod";

const Symbol = z.string().trim().toUpperCase().min(1).max(20);
const SnoozeBody = z.object({ hours: z.number().positive().max(24 * 30).default(24) });

// Per-user, per-symbol personalization signal — see changes/personalization.ts
// for how these two tables actually shape the ranking. Both endpoints are
// intentionally lightweight fire-and-forget writes: the frontend calls
// "open" whenever a card is expanded and doesn't wait on or react to the
// response, the same way analytics-style events normally work.
export function attentionRouter(pool: Pool) {
  const r = Router();

  r.post("/api/attention/:symbol/open", async (req, res, next) => {
    try {
      const symbol = Symbol.parse(req.params.symbol);
      await pool.query(
        "INSERT INTO attention_opens (user_id, symbol) VALUES ($1, $2)",
        [req.userId, symbol],
      );
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  r.post("/api/attention/:symbol/snooze", async (req, res, next) => {
    try {
      const symbol = Symbol.parse(req.params.symbol);
      const { hours } = SnoozeBody.parse(req.body ?? {});
      const result = await pool.query<{ snoozed_until: Date }>(
        `INSERT INTO attention_snoozes (user_id, symbol, snoozed_until)
         VALUES ($1, $2, now() + ($3 || ' hours')::interval)
         ON CONFLICT (user_id, symbol) DO UPDATE SET snoozed_until = EXCLUDED.snoozed_until
         RETURNING snoozed_until`,
        [req.userId, symbol, hours],
      );
      res.json({ snoozedUntil: result.rows[0].snoozed_until.toISOString() });
    } catch (err) {
      next(err);
    }
  });

  r.delete("/api/attention/:symbol/snooze", async (req, res, next) => {
    try {
      const symbol = Symbol.parse(req.params.symbol);
      await pool.query("DELETE FROM attention_snoozes WHERE user_id = $1 AND symbol = $2", [req.userId, symbol]);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return r;
}
