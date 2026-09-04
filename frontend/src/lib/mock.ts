import { ApiRequestError, type ChangesPoll, type ChangesResponse, type ConflictResponse, type FaultConfig, type Health, type Quote, type Sensitivity, type Sparklines, type SymbolSearchResult, type TimelineDiffResponse, type TimelineResponse, type Watchlist, type WatchlistItem, type WatchlistSummary } from "./api";

const now = "2026-09-04T11:42:13.000Z";
const symbols: SymbolSearchResult[] = [
  { symbol: "TCS", name: "Tata Consultancy Services", exchange: "NSE" },
  { symbol: "SUZLON", name: "Suzlon Energy", exchange: "NSE" },
  { symbol: "RELIANCE", name: "Reliance Industries", exchange: "NSE" },
  { symbol: "ZOMATO", name: "Zomato", exchange: "NSE" },
  { symbol: "IDEA", name: "Vodafone Idea", exchange: "NSE" },
  { symbol: "HDFCBANK", name: "HDFC Bank", exchange: "NSE" },
];
const quote = (symbol: string, price: string, stale = false): Quote => ({ symbol, price, prevClose: price, dayHigh: price, dayLow: price, weekHigh: (Number(price) * 1.3).toFixed(4), weekLow: (Number(price) * 0.75).toFixed(4), volume: 1234000, asOf: now, receivedAt: now, ageSeconds: stale ? 212 : 1, stale, corrected: false, source: "simulated" });
const item = (symbol: string, price: string, stale = false): WatchlistItem => ({ symbol, name: symbols.find((entry) => entry.symbol === symbol)?.name ?? symbol, sensitivity: "normal", quote: quote(symbol, price, stale), stale });
let current: Watchlist = { id: "demo-watchlist", name: "Market watch", version: 1, items: [item("TCS", "3812.4500"), item("SUZLON", "71.2000"), item("RELIANCE", "2951.0000"), item("ZOMATO", "241.3000"), item("IDEA", "13.4500", true), item("HDFCBANK", "1642.1000")] };
// The /app selector page needs several lists (rename/archive/delete,
// duplicate-name rejection, the "N of M worth a look" summary) — only
// `current` gets the rich per-item demo payload above; the others are
// realistic decoys (one empty, matching the real "three empty duplicate
// lists" bug this was built to fix) so the list-level features have
// something real to operate on without a full multi-watchlist mock engine.
let lists: WatchlistSummary[] = [
  { id: current.id, name: current.name, version: current.version, itemCount: current.items.length, updatedAt: now, createdAt: new Date(Date.parse(now) - 7 * 86_400_000).toISOString(), archivedAt: null },
  { id: "mock-empty-list", name: "Long term", version: 1, itemCount: 0, updatedAt: now, createdAt: new Date(Date.parse(now) - 2 * 86_400_000).toISOString(), archivedAt: null },
];
let faults: FaultConfig = {};
let acknowledged = false;
// The seeded "Market watch" represents a RETURNING user with unseen
// changes (so the demo has something to show). A freshly created watchlist
// is a genuine first visit — no baseline yet — and must mirror the real
// backend's first-visit digest exactly, not the "3 things" demo copy.
let firstVisit = false;

function changesData(): ChangesResponse {
  if (firstVisit) {
    return {
      snapshotId: "mock-snapshot-first",
      baseline: { takenAt: null, kind: "first-visit", awaySeconds: null },
      asOf: now,
      feed: { status: faults.outage ? "stale" : "live", lagSeconds: faults.outage ? 212 : 1 },
      digest: "First look — this is your baseline. Come back later and this line will tell you what changed.",
      summary: { meaningful: 0, total: current.items.length, stale: 0, newSinceLast: 0 },
      attentionBudget: 5,
      topMover: null,
      retractions: [],
      items: current.items.map((entry) => ({
        ...entry, quote: entry.quote ?? quote(entry.symbol, "0"),
        change: { kind: "none", pctSincePrev: null, zScore: null, zRaw: null, events: [], confidence: "high", attention: 0, sensitivity: entry.sensitivity, why: "First look — this is your baseline.", sectorAdjusted: false },
      })),
    };
  }
  const changes: ChangesResponse["items"] = current.items.map((entry, index) => ({
    ...entry, quote: entry.quote ?? quote(entry.symbol, "0"),
    // TCS demonstrates sector-adjustment: the raw move (zRaw) looks bigger
    // than what actually gets flagged (zScore) once the sector's own move
    // is subtracted out — the beta-adjustment feature made visible in the
    // mock, not just in real backend data.
    change: index === 0 ? { kind: "move", pctSincePrev: "-3.09", zScore: -2.8, zRaw: -3.4, events: ["DAY_LOW_BREACHED"], confidence: "high", attention: 3.8, sensitivity: entry.sensitivity, why: "Down 3.09% — unusual for TCS even after accounting for the sector (2.8σ idiosyncratic, 3.4σ raw). Broke below the day's low.", sectorAdjusted: true }
      : index === 1 ? { kind: "event", pctSincePrev: "+7.07", zScore: 1.6, zRaw: 1.6, events: ["VOLUME_SPIKE", "DAY_HIGH_BREACHED"], confidence: "high", attention: 3.4, sensitivity: entry.sensitivity, why: "Up 7.07% on heavy volume. The volume is the story.", sectorAdjusted: false }
      : index === 2 ? { kind: "event", pctSincePrev: "+0.08", zScore: 0.1, zRaw: 0.1, events: ["CORRECTED"], confidence: "high", attention: 0.6, sensitivity: entry.sensitivity, why: "The exchange revised a price you may have seen.", sectorAdjusted: false }
      : { kind: "none", pctSincePrev: "+0.13", zScore: 0.2, zRaw: 0.2, events: [], confidence: "high", attention: 0.2, sensitivity: entry.sensitivity, why: "No meaningful change.", sectorAdjusted: false },
  }));
  const meaningful = acknowledged ? 0 : 3;
  return {
    snapshotId: "mock-snapshot-1",
    baseline: { takenAt: acknowledged ? now : null, kind: acknowledged ? "checkpoint" : "first-visit", awaySeconds: acknowledged ? 9000 : null },
    asOf: now, feed: { status: faults.outage ? "stale" : "live", lagSeconds: faults.outage ? 212 : 1 },
    digest: acknowledged ? "Nothing meaningful changed since you last looked." : "Since 2 hours ago: 3 things worth a look — TCS −3.09%, SUZLON on heavy volume, RELIANCE price corrected.",
    summary: { meaningful, total: current.items.length, stale: current.items.filter((entry) => entry.stale).length, newSinceLast: 0 },
    attentionBudget: 5,
    topMover: acknowledged ? null : { symbol: "TCS", displaced: "RELIANCE" },
    retractions: [],
    items: changes,
  };
}

export const mock = {
  health: async (): Promise<Health> => ({ status: faults.outage ? "degraded" : "ok", db: "connected", feed: { status: faults.outage ? "stale" : "live", lastTickAt: now, lagSeconds: faults.outage ? 212 : 1 } }),
  searchSymbols: async (q: string) => symbols.filter((entry) => `${entry.symbol} ${entry.name}`.toLowerCase().includes(q.toLowerCase())),
  createWatchlist: async (name: string) => {
    const trimmed = name.trim();
    if (lists.some((l) => !l.archivedAt && l.name.toLowerCase() === trimmed.toLowerCase())) {
      throw new ApiRequestError({ error: "You already have a watchlist with this name.", code: "DUPLICATE_NAME" }, 409);
    }
    const id = crypto.randomUUID();
    lists = [...lists, { id, name: trimmed, version: 1, itemCount: 0, updatedAt: now, createdAt: now, archivedAt: null }];
    // Becomes the new "active" detail-page watchlist — see the module
    // comment above on why only one list at a time gets rich item data.
    current = { id, name: trimmed, version: 1, items: [] };
    acknowledged = false; firstVisit = true;
    return current;
  },
  watchlists: async (includeArchived = false): Promise<WatchlistSummary[]> => lists.filter((l) => includeArchived || !l.archivedAt),
  patchWatchlist: async (id: string, patch: { name?: string; archived?: boolean }): Promise<WatchlistSummary> => {
    const target = lists.find((l) => l.id === id);
    if (!target) throw new ApiRequestError({ error: "Watchlist not found", code: "NOT_FOUND" }, 404);
    if (patch.name !== undefined) {
      const trimmed = patch.name.trim();
      if (lists.some((l) => l.id !== id && !l.archivedAt && l.name.toLowerCase() === trimmed.toLowerCase())) {
        throw new ApiRequestError({ error: "You already have a watchlist with this name.", code: "DUPLICATE_NAME" }, 409);
      }
      target.name = trimmed;
      if (id === current.id) current = { ...current, name: trimmed };
    }
    if (patch.archived !== undefined) target.archivedAt = patch.archived ? new Date().toISOString() : null;
    lists = [...lists];
    return target;
  },
  deleteWatchlist: async (id: string): Promise<void> => { lists = lists.filter((l) => l.id !== id); },
  // Any OTHER known list (the seeded empty decoy, or one created via the
  // "+ Watchlist" modal) is a real, empty Watchlist — not an error. Only
  // `current` carries the rich demo payload; everything else in `lists`
  // still needs to open cleanly with zero items, the same as a real
  // freshly-created list would. Found live: clicking "Long term" (the
  // seeded second list) hit the `throw` below and rendered as a hard
  // "Could not load this watchlist" error instead of an empty state.
  watchlist: async (id: string) => {
    if (id === current.id) return current;
    const known = lists.find((l) => l.id === id);
    if (!known) throw new Error("Watchlist not found");
    return { id: known.id, name: known.name, version: known.version, items: [] };
  },
  setSensitivity: async (id: string, symbol: string, sensitivity: Sensitivity) => { await mock.watchlist(id); current = { ...current, version: current.version + 1, items: current.items.map((entry) => entry.symbol === symbol ? { ...entry, sensitivity } : entry) }; return current; },
  addItem: async (id: string, symbol: string) => { await mock.watchlist(id); if (!symbols.some((entry) => entry.symbol === symbol)) throw new Error("Unknown symbol"); if (!current.items.some((entry) => entry.symbol === symbol)) current = { ...current, version: current.version + 1, items: [...current.items, item(symbol, "0.0000")] }; return current; },
  removeItem: async (id: string, symbol: string) => { await mock.watchlist(id); current = { ...current, version: current.version + 1, items: current.items.filter((entry) => entry.symbol !== symbol) }; return current; },
  replaceItems: async (id: string, requested: string[], version: number) => { await mock.watchlist(id); if (version !== current.version) { const response: ConflictResponse = { error: "Watchlist version conflict", code: "VERSION_CONFLICT", current: { version: current.version, items: current.items } }; throw new ApiRequestError(response, 409); } current = { ...current, version: current.version + 1, items: requested.map((symbol) => current.items.find((entry) => entry.symbol === symbol) ?? item(symbol, "0.0000")) }; return current; },
  changes: async (id: string, _limit: number, etag?: string): Promise<ChangesPoll> => {
    // Any list other than the "active" one (see module comment) is a
    // realistic empty decoy, not a fully-simulated watchlist — real,
    // honest "nothing meaningful" rather than reusing `current`'s payload
    // under a different id.
    if (id !== current.id) {
      const list = lists.find((l) => l.id === id);
      return {
        data: {
          snapshotId: `mock-snapshot-${id}`, baseline: { takenAt: null, kind: "first-visit", awaySeconds: null },
          asOf: now, feed: { status: "live", lagSeconds: 1 },
          digest: "First look — this is your baseline. Come back later and this line will tell you what changed.",
          summary: { meaningful: 0, total: list?.itemCount ?? 0, stale: 0, newSinceLast: 0 },
          attentionBudget: 5, topMover: null, retractions: [], items: [],
        }, etag: `mock-snapshot-${id}`, notModified: false,
      };
    }
    return etag === "mock-snapshot-1" ? { data: null, etag, notModified: true } : { data: changesData(), etag: "mock-snapshot-1", notModified: false };
  },
  checkpoint: async (_id: string, _snapshotId: string) => { acknowledged = true; firstVisit = false; return { takenAt: now }; },
  // The real backend always has a NIFTY row (the market-index proxy every
  // symbol's beta is measured against); the mock's `current.items` never
  // includes it, so it's synthesized here rather than left to render as a
  // dash in the market rail.
  quotes: async (requested: string[]) => [...current.items, item("NIFTY", "22150.4000")]
    .filter((entry) => requested.includes(entry.symbol)).flatMap((entry) => entry.quote ? [entry.quote] : []),
  setFaults: async (config: FaultConfig) => { faults = { ...faults, ...config }; return { active: faults }; },
  sparklines: async (_id: string, limit: number): Promise<Sparklines> => {
    const out: Sparklines = {};
    for (const entry of current.items) {
      if (!entry.quote) continue;
      const base = Number(entry.quote.price);
      // Deterministic little wiggle so the shape looks organic without a real feed.
      out[entry.symbol] = Array.from({ length: Math.min(limit, 12) }, (_, i) => ({
        asOf: new Date(Date.parse(now) - (12 - i) * 60_000).toISOString(),
        price: (base * (1 + Math.sin(i * 0.9 + entry.symbol.length) * 0.01)).toFixed(4),
      }));
    }
    return out;
  },
  timeline: async (_id: string, limit: number): Promise<TimelineResponse> => ({
    visits: [
      { snapshotId: "mock-visit-2", takenAt: now },
      { snapshotId: "mock-visit-1", takenAt: new Date(Date.parse(now) - 2 * 3600_000).toISOString() },
    ].slice(0, limit),
  }),
  // NOT used by the app itself. Exposed only so e2e tests can simulate a
  // concurrent edit from "another device" deterministically, within one
  // page lifetime — the mock has no server, so there's no other way to
  // create a real version conflict for the conflict-modal test to exercise.
  __simulateConcurrentEdit: async (symbols: string[]) => { await mock.replaceItems(current.id, symbols, current.version); },
  timelineDiff: async (_id: string, snapshotId: string, _against?: string): Promise<TimelineDiffResponse> => ({
    takenAt: snapshotId === "mock-visit-1" ? new Date(Date.parse(now) - 2 * 3600_000).toISOString() : now,
    comparedTo: snapshotId === "mock-visit-1" ? null : new Date(Date.parse(now) - 2 * 3600_000).toISOString(),
    items: current.items.map((entry, i) => ({
      symbol: entry.symbol,
      name: entry.name,
      priceBefore: entry.quote ? (Number(entry.quote.price) * 0.98).toFixed(4) : null,
      priceAfter: entry.quote?.price ?? null,
      pct: entry.quote ? "2.00" : null,
      status: i === current.items.length - 1 ? "added" : "tracked",
    })),
  }),
};

// Test-only hook, dev/e2e builds only — this module is never imported when
// NEXT_PUBLIC_USE_MOCK is unset, so it never ships in the real-backend path.
if (typeof window !== "undefined") {
  (window as unknown as { __mock?: typeof mock }).__mock = mock;
}
