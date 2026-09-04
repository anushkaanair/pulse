import express from "express";
import { pinoHttp } from "pino-http";
import type { Pool } from "pg";
import { logger } from "./logger.js";
import { errorHandler } from "./middleware/errorHandler.js";
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

  // Permissive CORS for the local Next.js dev server; identity is a header.
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", req.headers.origin ?? "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-User-Id, If-None-Match, Idempotency-Key");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    res.setHeader("Access-Control-Expose-Headers", "ETag");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });

  app.use(healthRouter(pool, ingestor));
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
