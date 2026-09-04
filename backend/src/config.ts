import "dotenv/config";

function num(name: string, fallback: number) {
  const v = process.env[name];
  const n = v === undefined ? NaN : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function bool(name: string, fallback: boolean) {
  const v = process.env[name];
  if (v === undefined) return fallback;
  return v === "true" || v === "1";
}

// Every knob that defines "meaningful" or "stale" is here, named, with a
// default. These are product decisions, not magic numbers; see DECISIONS.md.
export const config = {
  port: num("PORT", 4000),
  databaseUrl: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/watchlist",
  logLevel: process.env.LOG_LEVEL ?? "info",

  tickMs: num("TICK_MS", 1000),
  // quote_history retention. Trailing volatility only ever reads the most
  // recent HISTORY_WINDOW rows per symbol, so anything older is dead weight
  // that costs disk and slows every sweep over the table. Generous by
  // default (a month is far more than the window needs, and leaves room for
  // ad-hoc inspection); set to 0 to disable pruning entirely.
  historyRetentionDays: num("HISTORY_RETENTION_DAYS", 30),
  historyPruneMs: num("HISTORY_PRUNE_MS", 3_600_000),
  simSeed: num("SIM_SEED", 42),
  // Fault injection (POST /api/_sim/faults) is unauthenticated by design —
  // it's a demo control surface, not user data. That makes the DEFAULT the
  // security boundary: defaulting to true meant any deployment that didn't
  // explicitly opt out shipped a live "force an outage / inject corrupt
  // ticks" endpoint to the internet. Off unless deliberately enabled, which
  // is what routes/sim.ts always claimed it did.
  simAdmin: bool("SIM_ADMIN", false),
  staleAfterSeconds: num("STALE_AFTER_SECONDS", 90),

  // Per-identity request budget. Generous by default: the frontend polls
  // /changes every 15s per open tab, so this only ever bites a client that
  // has genuinely lost the plot. 0 disables it (the load scripts do this —
  // they exist precisely to exceed sane rates).
  rateLimitRpm: num("RATE_LIMIT_RPM", 1200),
  rateLimitBurst: num("RATE_LIMIT_BURST", 120),
  // Browser origins allowed to call this API. An allowlist, not a mirror of
  // whatever Origin turned up — see app.ts.
  corsOrigins: (process.env.CORS_ORIGINS ?? "http://localhost:3000,http://localhost:3001")
    .split(",").map((o) => o.trim()).filter(Boolean),
  symbolRefreshMs: num("SYMBOL_REFRESH_MS", 10_000),

  // Longest absence the away-aware √n scaling models before the bar stops
  // growing. One NSE session (9:15–15:30) by default — see the horizon
  // comment in changes/engine.ts for why an uncapped horizon made long
  // absences report less, not more.
  maxHorizonMs: num("MAX_HORIZON_HOURS", 6.25) * 3_600_000,

  zThreshold: num("Z_THRESHOLD", 2.0),
  historyWindow: num("HISTORY_WINDOW", 50),
  minHistory: num("MIN_HISTORY", 20),
  absThresholdPct: num("ABS_THRESHOLD_PCT", 1.5),
  volumeSpikeMultiple: num("VOLUME_SPIKE_MULTIPLE", 2.0),
  gapPct: num("GAP_PCT", 2.0),

  // "Quickly understand," not "see everything above threshold." A volatile
  // day can put a dozen symbols over the meaningful bar; surfacing all of
  // them as ranked cards is a flood, not a triage. This caps how many are
  // pushed into the ranked "most meaningful" view — the rest are still
  // real, still visible, just in the full sortable list below rather than
  // competing for first-glance attention. The engine's own ranking (by
  // `attention`, see engine.ts) decides which ones make the cut.
  attentionBudget: num("ATTENTION_BUDGET", 5),
};
