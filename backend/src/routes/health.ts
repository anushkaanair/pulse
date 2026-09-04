import { Router } from "express";
import type { Pool } from "pg";
import { config } from "../config.js";
import type { Ingestor } from "../market/ingestor.js";

export type FeedStatus = "live" | "stale" | "down";

export function feedStatus(lastTickAt: Date | null, now = new Date()): { status: FeedStatus; lastTickAt: string | null; lagSeconds: number | null } {
  if (!lastTickAt) return { status: "down", lastTickAt: null, lagSeconds: null };
  const lag = Math.max(0, Math.round((now.getTime() - lastTickAt.getTime()) / 1000));
  const status: FeedStatus =
    lag > config.staleAfterSeconds * 2 ? "down" : lag > config.staleAfterSeconds ? "stale" : "live";
  return { status, lastTickAt: lastTickAt.toISOString(), lagSeconds: lag };
}

// Health reflects the two things that can actually be wrong: the database
// and the feed. A 200 with feed:"down" is honest; a 200 that hides it is not.
export function healthRouter(pool: Pool, ingestor: Ingestor) {
  const r = Router();
  r.get("/health", async (_req, res) => {
    let db: "connected" | "unreachable" = "connected";
    try {
      await pool.query("SELECT 1");
    } catch {
      db = "unreachable";
    }
    const feed = feedStatus(ingestor.provider.lastTickAt());
    const status = db === "unreachable" || feed.status !== "live" ? "degraded" : "ok";
    res.status(db === "unreachable" ? 503 : 200).json({ status, db, feed, ingest: ingestor.stats });
  });
  return r;
}
