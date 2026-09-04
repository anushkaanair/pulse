import express from "express";
import { pinoHttp } from "pino-http";
import type { Pool } from "pg";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { rateLimit } from "./middleware/rateLimit.js";
import { requireUserId } from "./middleware/userId.js";
import type { Ingestor } from "./market/ingestor.js";
import { changesRouter } from "./routes/changes.js";
import { checkpointRouter } from "./routes/checkpoint.js";
import { healthRouter } from "./routes/health.js";
import { quotesRouter } from "./routes/quotes.js";
import { simRouter } from "./routes/sim.js";
import { sparklinesRouter } from "./routes/sparklines.js";
import { symbolsRouter } from "./routes/symbols.js";
import { timelineRouter } from "./routes/timeline.js";
import { watchlistsRouter } from "./routes/watchlists.js";

export function createApp(pool: Pool, ingestor: Ingestor) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "256kb" }));
  app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === "/health" } }));

  // Baseline hardening. Hand-set rather than pulling in helmet: this API
  // serves JSON only, so most of helmet's surface (CSP, HSTS preload, DNS
  // prefetch) is either inapplicable or belongs at the TLS terminator.
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");   // no MIME sniffing of JSON
    res.setHeader("X-Frame-Options", "DENY");             // nothing here is meant to be framed
    res.setHeader("Referrer-Policy", "no-referrer");
    next();
  });

  // CORS as an allowlist, not a mirror. Reflecting whatever Origin arrived
  // makes every browser on the internet a permitted caller, which matters
  // here precisely BECAUSE identity is an unauthenticated header: any page a
  // user visits could otherwise call this API as them by guessing an id.
  // Credentials are never enabled, so this stays a same-origin-cookie-free
  // design; the allowlist is just the honest version of what was intended.
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && config.corsOrigins.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin"); // caches must not serve one origin's CORS headers to another
    }
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-User-Id, If-None-Match, Idempotency-Key");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    res.setHeader("Access-Control-Expose-Headers", "ETag");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });

  // Health sits AHEAD of the rate limiter on purpose: a liveness/readiness
  // probe that can be throttled is a probe that reports the process dead
  // under exactly the load where you most need to know it isn't. It is also
  // the one endpoint whose cost is already bounded and whose caller (an
  // orchestrator) polls at a fixed rate by construction.
  app.use(healthRouter(pool, ingestor));

  // Everything else: after CORS, so a rejected preflight doesn't spend a token.
  app.use(rateLimit);
  // Sim/fault-injection is global admin control, not user-scoped data — it
  // must NOT sit behind requireUserId, or the demo's "flip outage live"
  // moment needs a fake identity header for no reason.
  app.use(simRouter(ingestor.provider));
  app.use("/api", requireUserId);
  app.use(symbolsRouter(pool));
  app.use(quotesRouter(pool));
  app.use(watchlistsRouter(pool));
  app.use(changesRouter(pool, ingestor));
  app.use(checkpointRouter(pool));
  app.use(sparklinesRouter(pool));
  app.use(timelineRouter(pool));

  app.use((_req, res) => res.status(404).json({ error: "Not found", code: "NOT_FOUND" }));
  app.use(errorHandler);
  return app;
}
