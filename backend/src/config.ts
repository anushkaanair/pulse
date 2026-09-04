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
  simSeed: num("SIM_SEED", 42),
  simAdmin: bool("SIM_ADMIN", true),
  staleAfterSeconds: num("STALE_AFTER_SECONDS", 90),
  symbolRefreshMs: num("SYMBOL_REFRESH_MS", 10_000),

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
