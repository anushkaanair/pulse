import type { NextFunction, Request, Response } from "express";
import { config } from "../config.js";

// A token bucket per identity. Deliberately hand-rolled rather than pulling
// in express-rate-limit: this is ~40 lines, it has no configuration surface
// worth learning, and adding a dependency to a submission should buy more
// than that.
//
// Scope, stated honestly: this is per-process and in-memory, exactly like
// the checkpoint idempotency cache and the stats cache. It is a guard
// against a runaway or careless client — a polling loop with no backoff, a
// stuck retry — not a defence against a distributed attacker, and it does
// not survive a restart or coordinate across instances. Behind more than
// one process this needs Redis or a proxy-level limiter; see RESILIENCE.md.
//
// Identity is the same X-User-Id the rest of the API scopes on, falling back
// to IP for unauthenticated routes. That means one user hammering the API
// cannot exhaust another user's budget, which a pure IP limiter would get
// wrong the moment two users share a NAT.

interface Bucket { tokens: number; last: number }

const buckets = new Map<string, Bucket>();
// Bounded like every other in-process map here: a per-IP key space is
// attacker-controlled, so it must not be allowed to grow without limit.
const MAX_BUCKETS = 20_000;

function take(key: string, ratePerMs: number, burst: number, now: number): boolean {
  const bucket = buckets.get(key);
  if (!bucket) {
    if (buckets.size >= MAX_BUCKETS) evict(now, ratePerMs, burst);
    buckets.set(key, { tokens: burst - 1, last: now });
    return true;
  }
  // Refill continuously rather than in fixed windows: a fixed window lets a
  // client fire 2× the limit across a window boundary.
  bucket.tokens = Math.min(burst, bucket.tokens + (now - bucket.last) * ratePerMs);
  bucket.last = now;
  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}

/** Drop buckets that have refilled completely — they carry no state worth keeping. */
function evict(now: number, ratePerMs: number, burst: number) {
  for (const [key, bucket] of buckets) {
    if (bucket.tokens + (now - bucket.last) * ratePerMs >= burst) buckets.delete(key);
  }
  // Still full of active clients: drop the oldest-touched to stay bounded.
  if (buckets.size >= MAX_BUCKETS) {
    for (const key of buckets.keys()) {
      buckets.delete(key);
      if (buckets.size < MAX_BUCKETS) break;
    }
  }
}

export function rateLimit(req: Request, res: Response, next: NextFunction) {
  if (config.rateLimitRpm <= 0) return next(); // explicitly disabled (load scripts)
  const ratePerMs = config.rateLimitRpm / 60_000;
  const burst = Math.max(1, config.rateLimitBurst);
  const key = req.header("x-user-id") || req.ip || "anonymous";

  if (take(key, ratePerMs, burst, Date.now())) return next();

  res.setHeader("Retry-After", Math.ceil(1 / ratePerMs / 1000).toString());
  return res.status(429).json({ error: "Too many requests", code: "RATE_LIMITED" });
}

/** Test seam — the bucket map is module state that would otherwise leak between cases. */
export function resetRateLimit() {
  buckets.clear();
}
