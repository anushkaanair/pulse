// The centerpiece. A pure function: given what the user last saw, what the
// market looks like now, and each stock's own volatility, decide what
// deserves attention and say why in one sentence. No I/O, fully unit-tested.

import type { SymbolStats } from "./stats.js";

export type Sensitivity = "quiet" | "normal" | "loud";
export type ChangeKind = "move" | "event" | "new" | "none";
export type ChangeEvent = "DAY_HIGH_BREACHED" | "DAY_LOW_BREACHED" | "VOLUME_SPIKE" | "GAP" | "CORRECTED";

export interface SnapshotEntry {
  price: string;      // decimal string, as stored in snapshots.payload
  asOf: string;
  volume: number;
  dayHigh: string | null;
  dayLow: string | null;
}
export type SnapshotPayload = Record<string, SnapshotEntry>;

export interface EngineQuote {
  price: string;
  prevClose: string | null;
  dayHigh: string | null;
  dayLow: string | null;
  volume: number;
  asOf: string;
  corrected: boolean;
}

export interface EngineItem {
  symbol: string;
  name: string;
  sensitivity: Sensitivity;
  quote: EngineQuote | null;
}

export interface EngineConfig {
  tickMs: number;
  zThreshold: number;
  historyWindow: number;
  absThresholdPct: number;
  volumeSpikeMultiple: number;
  gapPct: number;
  sensitivityMultiplier: Record<Sensitivity, number>;
}

export interface Change {
  kind: ChangeKind;
  pctSincePrev: string | null;
  zScore: number | null;
  events: ChangeEvent[];
  confidence: "high" | "low";
  attention: number;
  sensitivity: Sensitivity;
  why: string;
}

export interface EngineResult {
  symbol: string;
  name: string;
  change: Change;
}

const EVENT_BONUS: Record<ChangeEvent, number> = {
  DAY_HIGH_BREACHED: 1.0,
  DAY_LOW_BREACHED: 1.0,
  VOLUME_SPIKE: 0.8,
  GAP: 0.6,
  CORRECTED: 0.5,
};

export const DEFAULT_MULTIPLIER: Record<Sensitivity, number> = { quiet: 1.75, normal: 1.0, loud: 0.6 };

export function computeChanges(
  snapshot: SnapshotPayload | null,   // null = first visit
  elapsedMs: number | null,           // since the checkpoint; null on first visit
  items: EngineItem[],
  stats: Map<string, SymbolStats>,
  cfg: EngineConfig,
): EngineResult[] {
  const results = items.map((item) => ({
    symbol: item.symbol,
    name: item.name,
    change: changeFor(item, snapshot?.[item.symbol] ?? null, snapshot !== null, elapsedMs, stats.get(item.symbol), cfg),
  }));
  // Rank: what deserves attention first; "none" always last, ties by symbol
  // so the order is stable between polls (no UI jitter).
  return results.sort((a, b) => {
    const an = a.change.kind === "none" ? 1 : 0;
    const bn = b.change.kind === "none" ? 1 : 0;
    if (an !== bn) return an - bn;
    if (b.change.attention !== a.change.attention) return b.change.attention - a.change.attention;
    return a.symbol.localeCompare(b.symbol);
  });
}

function changeFor(
  item: EngineItem,
  seen: SnapshotEntry | null,
  hasBaseline: boolean,
  elapsedMs: number | null,
  st: SymbolStats | undefined,
  cfg: EngineConfig,
): Change {
  const sensitivity = item.sensitivity;
  const mult = cfg.sensitivityMultiplier[sensitivity] ?? 1;
  const q = item.quote;

  if (!q) {
    return { kind: "none", pctSincePrev: null, zScore: null, events: [], confidence: "low", attention: 0, sensitivity, why: "No market data yet." };
  }
  if (!hasBaseline) {
    return { kind: "none", pctSincePrev: null, zScore: null, events: [], confidence: "high", attention: 0, sensitivity, why: "First look — this is your baseline." };
  }
  if (!seen) {
    return { kind: "new", pctSincePrev: null, zScore: null, events: [], confidence: "high", attention: 0.5, sensitivity, why: "Added since you last looked. No baseline yet." };
  }

  const prev = Number(seen.price);
  const now = Number(q.price);
  const r = prev > 0 ? (now - prev) / prev : 0;
  const pct = r * 100;

  // Away-aware significance: σ is per tick, the move spans n ticks since the
  // checkpoint. Deliberately NOT capped at historyWindow — that constant is
  // how much price history estimates σ from, a different thing from how
  // long the user has been away. Capping n there was a bug: at the default
  // tickMs, historyWindow=50 caps n at ~50 seconds, silently disabling the
  // away-aware scaling for anyone gone more than a minute — exactly the
  // multi-day-absence case this exists to handle. Growing n only shrinks z
  // toward 0, so it's numerically safe with no upper bound needed beyond
  // sane float range; MAX_ELAPSED_TICKS just guards against a pathological
  // clock/timestamp bug producing an absurd elapsedMs.
  const MAX_ELAPSED_TICKS = 30 * 24 * 3600; // ~30 days at tickMs=1000
  const n = Math.min(MAX_ELAPSED_TICKS, Math.max(1, (elapsedMs ?? cfg.tickMs) / cfg.tickMs));
  let z: number | null = null;
  let confidence: "high" | "low" = "high";
  let isMove = false;
  if (st?.sigma && st.sigma > 0) {
    z = r / (st.sigma * Math.sqrt(n));
    isMove = Math.abs(z) >= cfg.zThreshold * mult;
  } else {
    confidence = "low";
    isMove = Math.abs(pct) >= cfg.absThresholdPct * mult;
  }

  const events: ChangeEvent[] = [];
  if (q.dayHigh && seen.dayHigh && Number(q.dayHigh) > Number(seen.dayHigh)) events.push("DAY_HIGH_BREACHED");
  if (q.dayLow && seen.dayLow && Number(q.dayLow) < Number(seen.dayLow)) events.push("DAY_LOW_BREACHED");
  if (st && st.meanVolumePerTick > 0) {
    const perTick = (q.volume - seen.volume) / n;
    if (perTick > st.meanVolumePerTick * cfg.volumeSpikeMultiple) events.push("VOLUME_SPIKE");
  }
  if (q.prevClose && sessionChanged(seen.asOf, q.asOf)) {
    const gap = Math.abs((now - Number(q.prevClose)) / Number(q.prevClose)) * 100;
    if (gap >= cfg.gapPct) events.push("GAP");
  }
  if (q.corrected) events.push("CORRECTED");

  const base = z !== null ? Math.abs(z) : Math.abs(pct) / cfg.absThresholdPct;
  const attention = round2(base + events.reduce((s, e) => s + EVENT_BONUS[e], 0));
  const kind: ChangeKind = isMove ? "move" : events.length ? "event" : "none";

  return {
    kind,
    pctSincePrev: signed(pct),
    zScore: z === null ? null : round2(z),
    events,
    confidence,
    attention,
    sensitivity,
    why: why(item, kind, pct, z, events, confidence, sensitivity, isMove),
  };
}

function why(
  item: EngineItem, kind: ChangeKind, pct: number, z: number | null,
  events: ChangeEvent[], confidence: "high" | "low", sensitivity: Sensitivity, isMove: boolean,
): string {
  const parts: string[] = [];
  const dir = pct >= 0 ? "Up" : "Down";
  const mag = `${Math.abs(pct).toFixed(2)}%`;
  if (isMove) {
    parts.push(
      z !== null
        ? `${dir} ${mag} — unusual for ${item.symbol} (${Math.abs(z).toFixed(1)}σ).`
        : `${dir} ${mag} — flagged on size alone; not enough history for a baseline yet.`,
    );
  } else if (events.length && Math.abs(pct) >= 0.01) {
    parts.push(`${dir} ${mag}${z !== null ? ` (${Math.abs(z).toFixed(1)}σ — ordinary for this stock)` : ""}.`);
  }
  for (const e of events) {
    if (e === "DAY_HIGH_BREACHED") parts.push("Made a new high for the day.");
    if (e === "DAY_LOW_BREACHED") parts.push("Broke below the day's low.");
    if (e === "VOLUME_SPIKE") parts.push("Volume is well above normal — the activity is the story.");
    if (e === "GAP") parts.push("Gapped from the previous close.");
    if (e === "CORRECTED") parts.push("The exchange revised a price you may have seen.");
  }
  if (kind === "none") parts.push("No meaningful change.");
  if (sensitivity === "loud" && isMove) parts.push("(You asked to hear about anything on this one.)");
  if (sensitivity === "quiet" && kind !== "move" && Math.abs(pct) >= 1) parts.push("(Muted — you marked this one quiet.)");
  if (confidence === "low" && kind !== "none") parts.push("Low confidence: limited history.");
  return parts.join(" ");
}

/** One sentence a returning user reads before anything else. */
export function buildDigest(
  results: EngineResult[],
  baselineKind: "checkpoint" | "first-visit",
  elapsedMs: number | null,
): string {
  if (baselineKind === "first-visit") {
    return "First look — this is your baseline. Come back later and this line will tell you what changed.";
  }
  const meaningful = results.filter((r) => r.change.kind === "move" || r.change.kind === "event");
  const added = results.filter((r) => r.change.kind === "new").length;
  const quiet = results.length - meaningful.length - added;
  const since = `Since ${relative(elapsedMs)}`;
  if (meaningful.length === 0) {
    return `${since}: nothing meaningful changed across ${results.length} symbol${results.length === 1 ? "" : "s"}${added ? ` (${added} newly added)` : ""}.`;
  }
  const top = meaningful.slice(0, 3).map((r) => `${r.symbol} ${short(r)}`).join(", ");
  const more = meaningful.length > 3 ? `, and ${meaningful.length - 3} more` : "";
  return `${since}: ${meaningful.length} thing${meaningful.length === 1 ? "" : "s"} worth a look — ${top}${more}. ${quiet} other${quiet === 1 ? "" : "s"}: nothing meaningful.`;
}

function short(r: EngineResult): string {
  const c = r.change;
  const pct = c.pctSincePrev ? `${c.pctSincePrev}%` : "";
  if (c.events.includes("CORRECTED") && c.kind === "event") return "price corrected";
  if (c.events.includes("VOLUME_SPIKE") && c.kind === "event") return `${pct} on heavy volume`;
  if (c.kind === "move") return `${pct}${c.zScore !== null ? ` (${Math.abs(c.zScore).toFixed(1)}σ)` : ""}`;
  return pct || "changed";
}

function relative(ms: number | null): string {
  if (ms === null) return "your last visit";
  const m = Math.round(ms / 60000);
  if (m < 1) return "moments ago";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

function sessionChanged(a: string, b: string) {
  return a.slice(0, 10) !== b.slice(0, 10); // different calendar day (UTC) — good enough for a gap heuristic
}

function signed(pct: number) {
  return `${pct >= 0 ? "+" : "-"}${Math.abs(pct).toFixed(2)}`;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
