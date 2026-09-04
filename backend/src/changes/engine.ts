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
  // The z-score actually used to decide `kind`/`isMove` — residual
  // (sector-adjusted) when available, plain per-stock z otherwise. This is
  // the number the ranking and the primary "why" line are built from.
  zScore: number | null;
  // The plain per-stock z-score, computed whenever sigma is available,
  // REGARDLESS of which one (this or zScore) was actually used to decide
  // significance. Exists so the UI/why-text can say "moved 3.1σ raw, but
  // only 0.4σ once the sector's own move is subtracted out" — the
  // difference between the two numbers IS the beta-adjustment feature made
  // visible, not just asserted. Equal to zScore when sectorAdjusted=false.
  zRaw: number | null;
  events: ChangeEvent[];
  confidence: "high" | "low";
  attention: number;
  sensitivity: Sensitivity;
  why: string;
  // True when zScore/kind reflect this stock's move with what the market
  // (the index proxy) did over the same window subtracted out — i.e. a
  // z-score of "how unusual is this for THIS stock, beyond beta," not raw
  // volatility. False means it fell back to the plain per-stock z (thin
  // beta history, or the index feed itself was unavailable — see `why`).
  sectorAdjusted: boolean;
  // The "second clock" (see changes/significance.ts): how long since this
  // symbol's PREVIOUS significant event, attached only to a genuinely new
  // crossing (never set by the engine itself — it's pure and has no notion
  // of history across requests; routes/changes.ts fills this in). null =
  // this is the symbol's first-ever recorded event. undefined = not
  // applicable (not a new crossing this poll).
  quietForMs?: number | null;
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
  // The index's own fractional return since the checkpoint, computed the
  // same way as any stock's (see routes/changes.ts). null when there's no
  // checkpoint to compare from yet, or the index has no fresh quote right
  // now — either way, changeFor() below degrades to a plain per-stock z
  // rather than silently pretending an adjustment happened.
  indexReturn: number | null = null,
): EngineResult[] {
  const results = items.map((item) => ({
    symbol: item.symbol,
    name: item.name,
    change: changeFor(item, snapshot?.[item.symbol] ?? null, snapshot !== null, elapsedMs, stats.get(item.symbol), cfg, indexReturn),
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
  indexReturn: number | null,
): Change {
  const sensitivity = item.sensitivity;
  const mult = cfg.sensitivityMultiplier[sensitivity] ?? 1;
  const q = item.quote;

  if (!q) {
    return { kind: "none", pctSincePrev: null, zScore: null, zRaw: null, events: [], confidence: "low", attention: 0, sensitivity, why: "No market data yet.", sectorAdjusted: false };
  }
  if (!hasBaseline) {
    return { kind: "none", pctSincePrev: null, zScore: null, zRaw: null, events: [], confidence: "high", attention: 0, sensitivity, why: "First look — this is your baseline.", sectorAdjusted: false };
  }
  if (!seen) {
    return { kind: "new", pctSincePrev: null, zScore: null, zRaw: null, events: [], confidence: "high", attention: 0.5, sensitivity, why: "Added since you last looked. No baseline yet.", sectorAdjusted: false };
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
  let sectorAdjusted = false;
  let indexUnavailableDespiteBeta = false;
  // Beta-adjusted first: "meaningful" should mean unusual for THIS stock
  // beyond what the market did, not just a big raw number — a stock down
  // 3% on a day its beta says it should be down ~3% anyway isn't news; the
  // same 3% while the market was flat is. Falls back to plain per-stock z
  // (below) when there isn't yet a reliable beta/idio-σ estimate, or when
  // the index itself has no return to compare against right now (e.g. its
  // feed is delayed) — never silently pretends an adjustment happened.
  if (st?.beta != null && st.idioSigma && st.idioSigma > 0 && indexReturn !== null) {
    const residual = r - st.beta * indexReturn;
    z = residual / (st.idioSigma * Math.sqrt(n));
    isMove = Math.abs(z) >= cfg.zThreshold * mult;
    sectorAdjusted = true;
  } else if (st?.sigma && st.sigma > 0) {
    z = r / (st.sigma * Math.sqrt(n));
    isMove = Math.abs(z) >= cfg.zThreshold * mult;
    indexUnavailableDespiteBeta = st.beta != null && indexReturn === null;
  } else {
    confidence = "low";
    isMove = Math.abs(pct) >= cfg.absThresholdPct * mult;
  }
  // Plain per-stock z, independent of which path was used above — the
  // beta-adjustment made visible as a number, not just asserted: the gap
  // between zRaw and zScore IS the sector's share of the move.
  const zRaw = st?.sigma && st.sigma > 0 ? r / (st.sigma * Math.sqrt(n)) : null;

  // A breach only counts if it's significant by the SAME bar as a price
  // move — not merely non-zero. Without this, a stock drifting upward sets
  // a "new high" on almost every tick (trivially true whenever price rises
  // while already near the day's peak), spamming false "meaningful"
  // changes and breaking the core promise that "nothing changed" actually
  // means nothing changed. Bug found by testing checkpoint immediately
  // followed by /changes — see DECISIONS.md.
  const isSignificant = (deltaPct: number) => {
    if (st?.sigma && st.sigma > 0) return Math.abs(deltaPct) / (st.sigma * Math.sqrt(n)) >= cfg.zThreshold * mult;
    return Math.abs(deltaPct) >= cfg.absThresholdPct * mult;
  };

  const events: ChangeEvent[] = [];
  if (q.dayHigh && seen.dayHigh && Number(q.dayHigh) > Number(seen.dayHigh)) {
    const breachPct = (Number(q.dayHigh) - Number(seen.dayHigh)) / Number(seen.dayHigh);
    if (isSignificant(breachPct)) events.push("DAY_HIGH_BREACHED");
  }
  if (q.dayLow && seen.dayLow && Number(q.dayLow) < Number(seen.dayLow)) {
    const breachPct = (Number(seen.dayLow) - Number(q.dayLow)) / Number(seen.dayLow);
    if (isSignificant(breachPct)) events.push("DAY_LOW_BREACHED");
  }
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
    zRaw: zRaw === null ? null : round2(zRaw),
    events,
    confidence,
    attention,
    sensitivity,
    sectorAdjusted,
    why: why(item, kind, pct, z, zRaw, events, confidence, sensitivity, isMove, sectorAdjusted, indexUnavailableDespiteBeta),
  };
}

function why(
  item: EngineItem, kind: ChangeKind, pct: number, z: number | null, zRaw: number | null,
  events: ChangeEvent[], confidence: "high" | "low", sensitivity: Sensitivity, isMove: boolean,
  sectorAdjusted: boolean, indexUnavailableDespiteBeta: boolean,
): string {
  const parts: string[] = [];
  const dir = pct >= 0 ? "Up" : "Down";
  const mag = `${Math.abs(pct).toFixed(2)}%`;
  // When sector-adjusted, prefer stating both numbers when they actually
  // differ — "3.1σ raw, 0.4σ vs its sector" makes the adjustment visible
  // instead of just asserted. When they're close, one number reads cleaner.
  const rawNote = sectorAdjusted && zRaw !== null && z !== null && Math.abs(Math.abs(zRaw) - Math.abs(z)) >= 0.3
    ? ` (${Math.abs(zRaw).toFixed(1)}σ raw)` : "";
  if (isMove) {
    parts.push(
      z !== null
        ? `${dir} ${mag} — unusual for ${item.symbol}${sectorAdjusted ? " even after accounting for the sector" : ""} (${Math.abs(z).toFixed(1)}σ${sectorAdjusted ? " idiosyncratic" : ""}${rawNote}).`
        : `${dir} ${mag} — flagged on size alone; not enough history for a baseline yet.`,
    );
  } else if (z !== null && sectorAdjusted && Math.abs(pct) >= 0.5) {
    // The raw move looks big, but it's explained by the sector, not this
    // stock — this is the beta-adjustment feature actually doing its job,
    // so it's worth saying explicitly rather than looking like nothing
    // happened.
    parts.push(`${dir} ${mag} — largely tracks the sector; not unusual for ${item.symbol} once that's accounted for (${Math.abs(z).toFixed(1)}σ idiosyncratic${rawNote}).`);
  } else if (events.length && Math.abs(pct) >= 0.01) {
    parts.push(`${dir} ${mag}${z !== null ? ` (${Math.abs(z).toFixed(1)}σ — ordinary for this stock)` : ""}.`);
  }
  if (indexUnavailableDespiteBeta) parts.push("(Sector data delayed — using this stock's own volatility only.)");
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
