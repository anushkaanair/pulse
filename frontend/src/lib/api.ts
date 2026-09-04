export type FeedStatus = "live" | "stale" | "down";
export type Sensitivity = "quiet" | "normal" | "loud";
export type ChangeKind = "move" | "event" | "new" | "none";
export type ChangeEvent = "DAY_HIGH_BREACHED" | "DAY_LOW_BREACHED" | "VOLUME_SPIKE" | "GAP" | "CORRECTED";

export interface ApiError { error: string; code: string }
export class ApiRequestError extends Error {
  constructor(public readonly response: ApiError, public readonly status: number) { super(response.error); }
}
export interface Quote {
  symbol: string; price: string; prevClose: string | null; dayHigh: string | null; dayLow: string | null;
  weekHigh: string | null; weekLow: string | null;
  volume: number; asOf: string; receivedAt: string; ageSeconds: number; stale: boolean; corrected: boolean; source: string;
}
export interface SymbolSearchResult { symbol: string; name: string; exchange: string }
export interface WatchlistSummary { id: string; name: string; version: number; itemCount: number; updatedAt: string }
export interface WatchlistItem { symbol: string; name: string; sensitivity: Sensitivity; quote: Quote | null; stale: boolean }
export interface Watchlist { id: string; name: string; version: number; items: WatchlistItem[] }
export interface Health { status: "ok" | "degraded"; db: "connected" | "unreachable"; feed: { status: FeedStatus; lastTickAt: string | null; lagSeconds: number | null } }
export interface ChangeItem {
  symbol: string; name: string; quote: Quote; stale: boolean;
  change: { kind: ChangeKind; pctSincePrev: string | null; zScore: number | null; events: ChangeEvent[]; confidence: "high" | "low"; attention: number; sensitivity: Sensitivity; why: string };
}
export interface ChangesResponse {
  snapshotId: string;
  baseline: { takenAt: string | null; kind: "checkpoint" | "first-visit"; awaySeconds: number | null };
  asOf: string; feed: { status: FeedStatus; lagSeconds: number | null }; digest: string;
  summary: { meaningful: number; total: number; stale: number; newSinceLast: number }; items: ChangeItem[];
}
export interface ConflictResponse { error: string; code: "VERSION_CONFLICT"; current: { version: number; items: WatchlistItem[] } }
export interface FaultConfig { outage?: boolean; delayMs?: number; outOfOrderPct?: number; duplicatePct?: number; correctionPct?: number }
export interface ChangesPoll { data: ChangesResponse | null; etag: string | null; notModified: boolean }
export interface SparklinePoint { asOf: string; price: string }
export type Sparklines = Record<string, SparklinePoint[]>;
export interface TimelineVisit { snapshotId: string; takenAt: string }
export interface TimelineResponse { visits: TimelineVisit[] }
export interface TimelineDiffItem { symbol: string; name: string; priceBefore: string | null; priceAfter: string | null; pct: string | null; status: "tracked" | "added" | "removed" }
export interface TimelineDiffResponse { takenAt: string; comparedTo: string | null; items: TimelineDiffItem[] }

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
const USE_MOCK = process.env.NEXT_PUBLIC_USE_MOCK === "true";
const USER_KEY = "market-watchlist-user-id";

export function userId() {
  if (typeof window === "undefined") return "server-render";
  const saved = window.localStorage.getItem(USER_KEY);
  if (saved) return saved;
  const id = crypto.randomUUID();
  window.localStorage.setItem(USER_KEY, id);
  return id;
}
export function switchUser() {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(USER_KEY, crypto.randomUUID());
}

async function request<T>(path: string, init: RequestInit = {}, etag?: string): Promise<{ data: T | null; etag: string | null; status: number }> {
  const headers = new Headers(init.headers);
  headers.set("X-User-Id", userId());
  headers.set("Accept", "application/json");
  if (init.body) headers.set("Content-Type", "application/json");
  if (etag) headers.set("If-None-Match", etag);
  const response = await fetch(`${API_URL}${path}`, { ...init, headers });
  if (response.status === 304) return { data: null, etag: response.headers.get("ETag"), status: 304 };
  if (!response.ok) throw new ApiRequestError(await response.json() as ApiError, response.status);
  return { data: await response.json() as T, etag: response.headers.get("ETag"), status: response.status };
}

export const api = {
  health: () => USE_MOCK ? import("./mock").then(({ mock }) => mock.health()) : request<Health>("/health").then(({ data }) => data!),
  searchSymbols: (q: string) => USE_MOCK ? import("./mock").then(({ mock }) => mock.searchSymbols(q)) : request<SymbolSearchResult[]>(`/api/symbols?q=${encodeURIComponent(q)}`).then(({ data }) => data!),
  createWatchlist: (name: string) => USE_MOCK ? import("./mock").then(({ mock }) => mock.createWatchlist(name)) : request<Watchlist>("/api/watchlists", { method: "POST", body: JSON.stringify({ name }) }).then(({ data }) => data!),
  watchlists: () => USE_MOCK ? import("./mock").then(({ mock }) => mock.watchlists()) : request<WatchlistSummary[]>("/api/watchlists").then(({ data }) => data!),
  watchlist: (id: string) => USE_MOCK ? import("./mock").then(({ mock }) => mock.watchlist(id)) : request<Watchlist>(`/api/watchlists/${id}`).then(({ data }) => data!),
  setSensitivity: (id: string, symbol: string, sensitivity: Sensitivity) => USE_MOCK ? import("./mock").then(({ mock }) => mock.setSensitivity(id, symbol, sensitivity)) : request<Watchlist>(`/api/watchlists/${id}/items/${symbol}`, { method: "PATCH", body: JSON.stringify({ sensitivity }) }).then(({ data }) => data!),
  addItem: (id: string, symbol: string) => USE_MOCK ? import("./mock").then(({ mock }) => mock.addItem(id, symbol)) : request<Watchlist>(`/api/watchlists/${id}/items`, { method: "POST", body: JSON.stringify({ symbol }) }).then(({ data }) => data!),
  removeItem: (id: string, symbol: string) => USE_MOCK ? import("./mock").then(({ mock }) => mock.removeItem(id, symbol)) : request<Watchlist>(`/api/watchlists/${id}/items/${symbol}`, { method: "DELETE" }).then(({ data }) => data!),
  replaceItems: (id: string, symbols: string[], version: number) => USE_MOCK ? import("./mock").then(({ mock }) => mock.replaceItems(id, symbols, version)) : request<Watchlist>(`/api/watchlists/${id}/items`, { method: "PUT", body: JSON.stringify({ symbols, version }) }).then(({ data }) => data!),
  changes: async (id: string, limit = 20, etag?: string): Promise<ChangesPoll> => {
    if (USE_MOCK) return (await import("./mock")).mock.changes(id, limit, etag);
    const response = await request<ChangesResponse>(`/api/watchlists/${id}/changes?limit=${limit}`, {}, etag);
    return { data: response.data, etag: response.etag, notModified: response.status === 304 };
  },
  checkpoint: (id: string, snapshotId: string) => USE_MOCK ? import("./mock").then(({ mock }) => mock.checkpoint(id, snapshotId)) : request<{ takenAt: string }>(`/api/watchlists/${id}/checkpoint`, { method: "POST", body: JSON.stringify({ snapshotId }) }).then(({ data }) => data!),
  quotes: (symbols: string[]) => USE_MOCK ? import("./mock").then(({ mock }) => mock.quotes(symbols)) : request<Quote[]>(`/api/quotes?symbols=${encodeURIComponent(symbols.join(","))}`).then(({ data }) => data!),
  setFaults: (config: FaultConfig) => USE_MOCK ? import("./mock").then(({ mock }) => mock.setFaults(config)) : request<{ active: FaultConfig }>("/api/_sim/faults", { method: "POST", body: JSON.stringify(config) }).then(({ data }) => data!),
  sparklines: (id: string, limit = 30) => USE_MOCK ? import("./mock").then(({ mock }) => mock.sparklines(id, limit)) : request<Sparklines>(`/api/watchlists/${id}/sparklines?limit=${limit}`).then(({ data }) => data!),
  timeline: (id: string, limit = 30) => USE_MOCK ? import("./mock").then(({ mock }) => mock.timeline(id, limit)) : request<TimelineResponse>(`/api/watchlists/${id}/timeline?limit=${limit}`).then(({ data }) => data!),
  timelineDiff: (id: string, snapshotId: string, against?: string) => USE_MOCK ? import("./mock").then(({ mock }) => mock.timelineDiff(id, snapshotId, against)) : request<TimelineDiffResponse>(`/api/watchlists/${id}/timeline/${snapshotId}/diff${against ? `?against=${against}` : ""}`).then(({ data }) => data!),
};
