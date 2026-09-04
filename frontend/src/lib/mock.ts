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
      items: current.items.map((entry) => ({
        ...entry, quote: entry.quote ?? quote(entry.symbol, "0"),
        change: { kind: "none", pctSincePrev: null, zScore: null, events: [], confidence: "high", attention: 0, sensitivity: entry.sensitivity, why: "First look — this is your baseline." },
      })),
    };
  }
  const changes: ChangesResponse["items"] = current.items.map((entry, index) => ({
    ...entry, quote: entry.quote ?? quote(entry.symbol, "0"),
    change: index === 0 ? { kind: "move", pctSincePrev: "-3.09", zScore: -2.8, events: ["DAY_LOW_BREACHED"], confidence: "high", attention: 3.8, sensitivity: entry.sensitivity, why: "Moved −3.09%, unusual for TCS (2.8σ). Broke below the day's low." }
      : index === 1 ? { kind: "event", pctSincePrev: "+7.07", zScore: 1.6, events: ["VOLUME_SPIKE", "DAY_HIGH_BREACHED"], confidence: "high", attention: 3.4, sensitivity: entry.sensitivity, why: "Up 7.07% on heavy volume. The volume is the story." }
      : index === 2 ? { kind: "event", pctSincePrev: "+0.08", zScore: 0.1, events: ["CORRECTED"], confidence: "high", attention: 0.6, sensitivity: entry.sensitivity, why: "The exchange revised a price you may have seen." }
      : { kind: "none", pctSincePrev: "+0.13", zScore: 0.2, events: [], confidence: "high", attention: 0.2, sensitivity: entry.sensitivity, why: "No meaningful change." },
  }));
  const meaningful = acknowledged ? 0 : 3;
  return { snapshotId: "mock-snapshot-1", baseline: { takenAt: acknowledged ? now : null, kind: acknowledged ? "checkpoint" : "first-visit", awaySeconds: acknowledged ? 9000 : null }, asOf: now, feed: { status: faults.outage ? "stale" : "live", lagSeconds: faults.outage ? 212 : 1 }, digest: acknowledged ? "Nothing meaningful changed since you last looked." : "Since 2 hours ago: 3 things worth a look — TCS −3.09%, SUZLON on heavy volume, RELIANCE price corrected.", summary: { meaningful, total: current.items.length, stale: current.items.filter((entry) => entry.stale).length, newSinceLast: 0 }, items: changes };
}

export const mock = {
  health: async (): Promise<Health> => ({ status: faults.outage ? "degraded" : "ok", db: "connected", feed: { status: faults.outage ? "stale" : "live", lastTickAt: now, lagSeconds: faults.outage ? 212 : 1 } }),
  searchSymbols: async (q: string) => symbols.filter((entry) => `${entry.symbol} ${entry.name}`.toLowerCase().includes(q.toLowerCase())),
  createWatchlist: async (name: string) => { current = { id: crypto.randomUUID(), name, version: 1, items: [] }; acknowledged = false; firstVisit = true; return current; },
  watchlists: async (): Promise<WatchlistSummary[]> => [{ id: current.id, name: current.name, version: current.version, itemCount: current.items.length, updatedAt: now }],
  watchlist: async (id: string) => { if (id !== current.id) throw new Error("Watchlist not found"); return current; },
  setSensitivity: async (id: string, symbol: string, sensitivity: Sensitivity) => { await mock.watchlist(id); current = { ...current, version: current.version + 1, items: current.items.map((entry) => entry.symbol === symbol ? { ...entry, sensitivity } : entry) }; return current; },
  addItem: async (id: string, symbol: string) => { await mock.watchlist(id); if (!symbols.some((entry) => entry.symbol === symbol)) throw new Error("Unknown symbol"); if (!current.items.some((entry) => entry.symbol === symbol)) current = { ...current, version: current.version + 1, items: [...current.items, item(symbol, "0.0000")] }; return current; },
  removeItem: async (id: string, symbol: string) => { await mock.watchlist(id); current = { ...current, version: current.version + 1, items: current.items.filter((entry) => entry.symbol !== symbol) }; return current; },
  replaceItems: async (id: string, requested: string[], version: number) => { await mock.watchlist(id); if (version !== current.version) { const response: ConflictResponse = { error: "Watchlist version conflict", code: "VERSION_CONFLICT", current: { version: current.version, items: current.items } }; throw new ApiRequestError(response, 409); } current = { ...current, version: current.version + 1, items: requested.map((symbol) => current.items.find((entry) => entry.symbol === symbol) ?? item(symbol, "0.0000")) }; return current; },
  changes: async (_id: string, _limit: number, etag?: string): Promise<ChangesPoll> => etag === "mock-snapshot-1" ? { data: null, etag, notModified: true } : { data: changesData(), etag: "mock-snapshot-1", notModified: false },
  checkpoint: async (_id: string, _snapshotId: string) => { acknowledged = true; firstVisit = false; return { takenAt: now }; },
  quotes: async (requested: string[]) => current.items.filter((entry) => requested.includes(entry.symbol)).flatMap((entry) => entry.quote ? [entry.quote] : []),
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
