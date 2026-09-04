"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { AddSymbol } from "@/components/AddSymbol";
import { AttentionDeck } from "@/components/AttentionDeck";
import { ConflictModal } from "@/components/ConflictModal";
import { FeedStatusBar } from "@/components/FeedStatusBar";
import { MarketTrends } from "@/components/MarketTrends";
import { WatchlistRow } from "@/components/WatchlistRow";
import { api, ApiRequestError, type ChangesResponse, type ConflictResponse, type Sensitivity, type Sparklines, type Watchlist, type WatchlistItem } from "@/lib/api";

// Below this, real DOM rows are simpler and there's no cost to justify
// virtualizing. Above it, a plain map() renders every row's DOM eagerly
// even for the ~99% that are scrolled out of view — virtualization keeps
// the mounted node count roughly constant regardless of list size.
const VIRTUALIZE_ABOVE = 100;

function away(seconds: number | null) { if (!seconds) return null; return seconds >= 3600 ? `${Math.floor(seconds / 3600)}h` : `${Math.max(1, Math.floor(seconds / 60))}m`; }

export default function WatchlistPage() {
  const { id } = useParams<{ id: string }>();
  const [watchlist, setWatchlist] = useState<Watchlist>();
  const [changes, setChanges] = useState<ChangesResponse>();
  const [sparklines, setSparklines] = useState<Sparklines>({});
  const [error, setError] = useState<unknown>();
  const [marking, setMarking] = useState(false);
  const [editing, setEditing] = useState(false);
  const [symbolsText, setSymbolsText] = useState("");
  const [conflict, setConflict] = useState<{ theirs: WatchlistItem[]; mine: string[]; version: number }>();
  const [sort, setSort] = useState<{ key: "symbol" | "price" | "change" | "volume"; dir: 1 | -1 }>({ key: "symbol", dir: 1 });

  useEffect(() => {
    let cancelled = false;
    let latestEtag: string | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    // The actual fetch — always runs when called. Visibility only gates
    // whether it gets called on a *recurring* timer (see `poll` below); a
    // navigation to this page is an explicit visit and must load data even
    // if the tab happens to be backgrounded (opened via middle-click, not
    // yet focused, etc.) or the browser reports 'hidden' for other reasons
    // (headless test runners do this by default) — gating the FIRST load
    // on visibility was a real bug, not just a testing inconvenience: a
    // background tab would show "Loading..." forever until focused.
    const fetchChanges = async () => {
      try {
        const response = await api.changes(id, 20, latestEtag);
        if (cancelled) return;
        latestEtag = response.etag ?? latestEtag;
        if (response.data) setChanges(response.data);
        setSparklines(await api.sparklines(id, 30));
      } catch (cause) { if (!cancelled) setError(cause); }
    };
    // Recurring/background-triggered polls DO respect visibility — no
    // point spending requests on a tab nobody's looking at.
    const poll = async () => { if (document.visibilityState !== "hidden") await fetchChanges(); };
    const begin = async () => { try { const list = await api.watchlist(id); if (!cancelled) setWatchlist(list); await fetchChanges(); } catch (cause) { if (!cancelled) setError(cause); } };
    const visibility = () => { if (document.visibilityState === "visible") void poll(); };
    void begin();
    timer = setInterval(() => void poll(), 15_000);
    document.addEventListener("visibilitychange", visibility);
    return () => { cancelled = true; if (timer) clearInterval(timer); document.removeEventListener("visibilitychange", visibility); };
  }, [id]);
  const refreshWatchlist = async (work: () => Promise<Watchlist>) => { try { setWatchlist(await work()); } catch (cause) { setError(cause); } };
  const markSeen = async () => { if (!changes) return; setMarking(true); try { await api.checkpoint(id, changes.snapshotId); const latest = await api.changes(id); setChanges(latest.data ?? undefined); } catch (cause) { setError(cause); } finally { setMarking(false); } };
  const requestedSymbols = () => [...new Set(symbolsText.split(",").map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))];
  const saveBulk = async (symbols = requestedSymbols(), version = watchlist!.version) => { try { setWatchlist(await api.replaceItems(id, symbols, version)); setEditing(false); setConflict(undefined); } catch (cause) { const current = cause instanceof ApiRequestError ? (cause.response as unknown as Partial<ConflictResponse>).current : undefined; if (current) setConflict({ theirs: current.items, mine: symbols, version: current.version }); else setError(cause); } };

  if (error) { const message = error instanceof ApiRequestError ? `${error.response.error} (${error.response.code})` : "Could not load this watchlist."; return <main className="mx-auto max-w-[880px] px-4 py-12"><Link href="/app" className="text-sm underline underline-offset-4 hover:text-[var(--ink)]">Back to watchlists</Link><p className="mt-8 text-sm text-[var(--red)]">{message}</p></main>; }
  if (!watchlist || !changes) return <main className="mx-auto max-w-[880px] px-4 py-12 text-sm text-[var(--muted)]">Loading your catch-up…</main>;

  // Ranked, not thresholded: `changes.items` already arrives sorted by the
  // engine's own attention score, so the first `attentionBudget` of them
  // ARE the ones that most deserve a first glance. Triage, not a flood —
  // the rest are still real and still visible, just in the full list below
  // rather than competing for attention above it. The deck below NEVER
  // falls back to "largest recent movement" filler when nothing is
  // meaningful — "nothing meaningful changed" stays a real empty state.
  const meaningful = changes.items.filter((item) => item.change.kind !== "none");
  const rankedForAttention = meaningful.slice(0, changes.attentionBudget);
  const overflow = meaningful.length - rankedForAttention.length;

  const changeBySymbol = new Map(changes.items.map((c) => [c.symbol, c.change]));
  const sortVal = (it: WatchlistItem, key: typeof sort.key) =>
    key === "symbol" ? it.symbol
    : key === "price" ? Number(it.quote?.price ?? 0)
    : key === "volume" ? (it.quote?.volume ?? 0)
    : Number(changeBySymbol.get(it.symbol)?.pctSincePrev ?? 0); // change
  const sortedItems = [...watchlist.items].sort((a, b) => {
    const va = sortVal(a, sort.key), vb = sortVal(b, sort.key);
    if (va < vb) return -1 * sort.dir;
    if (va > vb) return 1 * sort.dir;
    return 0;
  });
  const toggleSort = (key: typeof sort.key) => setSort((s) => s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: key === "symbol" ? 1 : -1 });
  const arrow = (key: typeof sort.key) => sort.key === key ? (sort.dir === 1 ? " ↑" : " ↓") : "";

  return (
    <main className="min-h-screen">
      <FeedStatusBar status={changes.feed.status} lagSeconds={changes.feed.lagSeconds} />
      <div className="mx-auto max-w-7xl px-4 pt-3">
        <Link href="/app" className="text-sm text-[var(--muted)] hover:text-[var(--ink)] underline-offset-4 hover:underline">← Back to watchlists</Link>
        <div className="mt-0.5 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold tracking-tight">{watchlist.name}</h1>
          {changes.summary.meaningful > 0
            ? <span className="rounded-full bg-[var(--amber)]/15 px-2.5 py-0.5 text-[11px] font-medium text-[var(--amber)]">{changes.summary.meaningful} worth a look</span>
            : <span className="rounded-full bg-[var(--green)]/15 px-2.5 py-0.5 text-[11px] font-medium text-[var(--green)]">Caught up</span>}
        </div>
        <p className="text-xs text-[var(--muted)] mt-0.5">{watchlist.items.length} {watchlist.items.length === 1 ? "symbol" : "symbols"}</p>
      </div>
      <div className="mx-auto max-w-7xl px-4 pt-4 pb-8 grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-8">

        {/* Left Column - Main Content */}
        <div className="min-w-0">
          {/* A retraction is corrected, never silently deleted — shown as
              its own small, explicit list, distinct from the ranked deck
              below. Almost always empty. */}
          {changes.retractions.length > 0 ? (
            <div className="mb-6 rounded-2xl border border-[var(--amber)]/30 bg-[var(--amber)]/5 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-[var(--amber)] mb-2">Corrected since last shown</p>
              {changes.retractions.map((r) => (
                <p key={r.symbol} className="text-sm text-[var(--ink)]">
                  <span className="font-medium">{r.symbol}</span>&rsquo;s earlier move was revised{r.previousZ !== null ? ` (was ${Math.abs(r.previousZ).toFixed(1)}σ)` : ""} — no longer unusual for this stock.
                </p>
              ))}
            </div>
          ) : null}

          {/* Since You Last Looked */}
          <section className="mb-4">
            <h2 className="text-lg font-medium mb-1 tracking-tight">Most meaningful changes</h2>
            <p className="text-sm text-[var(--muted)] mb-3">{changes.digest}</p>
            {changes.summary.meaningful === 0 ? (
               <p className="text-sm text-[var(--muted)] bg-[var(--surface)] p-6 rounded-2xl border border-[var(--line)]">Nothing meaningful changed since {changes.baseline.takenAt ? new Date(changes.baseline.takenAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "your last visit"}.</p>
            ) : (
               <AttentionDeck items={rankedForAttention} sparklines={sparklines} topMover={changes.topMover} />
            )}
            {overflow > 0 ? (
              <p className="mt-2 text-xs text-[var(--muted)]">+{overflow} more meaningful, ranked lower — see the full list below.</p>
            ) : null}
          </section>

          {/* Full List */}
          <section>
            <div className="flex items-center gap-4 mb-4 flex-wrap">
               <h2 className="text-xl font-medium tracking-tight">All tracked stocks</h2>
               <div className="hidden sm:flex gap-2">
                 {(["symbol", "price", "change", "volume"] as const).map((k) => (
                   <button key={k} onClick={() => toggleSort(k)} className="rounded-full border px-3.5 py-1 text-xs font-medium transition-colors" style={sort.key === k ? { borderColor: "var(--amber)", color: "var(--amber)", background: "rgba(0,190,140,.1)" } : { borderColor: "var(--line)", color: "var(--muted)" }}>{k.charAt(0).toUpperCase() + k.slice(1)}{arrow(k)}</button>
                 ))}
               </div>
               <div className="ml-auto w-56">
                 <AddSymbol watchlistId={id} onAdded={setWatchlist} />
               </div>
            </div>

            <div className="rounded-2xl border border-[var(--line)] overflow-hidden" style={{ background: "linear-gradient(180deg, var(--surface-2), var(--surface))" }}>
               <div className="hidden md:flex md:items-center md:gap-x-4 px-4 py-2.5 border-b border-[var(--line)] text-[10.5px] uppercase tracking-wide text-[var(--muted)]">
                 <div className="md:min-w-28 md:flex-1">Company</div>
                 <div className="md:min-w-24 md:text-right">Market Price</div>
                 <div className="md:w-16 md:text-right">Volume</div>
                 <div className="flex-1 max-w-[120px] text-center">52W Range</div>
                 <div className="w-16"></div>
                 <div className="w-[150px]"></div>
               </div>

               {watchlist.items.length === 0 ? (
                 <p className="p-8 text-center text-sm text-[var(--muted)]">This watchlist is empty. Add a symbol to start a baseline.</p>
               ) : watchlist.items.length > VIRTUALIZE_ABOVE ? (
                 <VirtualizedRows items={sortedItems} changes={changes} sparklines={sparklines} id={id} refreshWatchlist={refreshWatchlist} />
               ) : (
                 <ul className="divide-y divide-[var(--line)] px-4">
                   {sortedItems.map((item) => (
                     <WatchlistRow
                       key={item.symbol}
                       item={item}
                       change={changes.items.find((entry) => entry.symbol === item.symbol)?.change}
                       sparkline={sparklines[item.symbol]}
                       onSensitivity={(choice) => void refreshWatchlist(() => api.setSensitivity(id, item.symbol, choice))}
                       onRemove={() => void refreshWatchlist(() => api.removeItem(id, item.symbol))}
                     />
                   ))}
                 </ul>
               )}
            </div>
          </section>
        </div>

        {/* Right Column - Sidebar */}
        <aside className="flex flex-col gap-4">
          {/* Watchlist Summary */}
          <div className="rounded-2xl border border-[var(--line)] p-5" style={{ background: "linear-gradient(180deg, var(--surface-2), var(--surface))" }}>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)] mb-5">Watchlist Summary</h3>
            <div className="mb-5">
               <p className="text-sm text-[var(--muted)] mb-1">Total Tracked</p>
               <p className="numbers text-[30px] font-semibold tracking-tight">{watchlist.items.length}</p>
            </div>
            <div className="flex justify-between items-center mb-2 text-[13px]">
               <span className="text-[var(--muted)]">Meaningful changes</span>
               <span className="numbers font-semibold" style={{ color: changes.summary.meaningful > 0 ? "var(--amber)" : "var(--ink)" }}>{changes.summary.meaningful}</span>
            </div>
            <div className="flex justify-between items-center mb-6 text-[13px]">
               <span className="text-[var(--muted)]">Time away</span>
               <span className="font-medium">{changes.baseline.kind === "first-visit" ? "First visit" : (away(changes.baseline.awaySeconds) ?? "—")}</span>
            </div>
            <button
              onClick={markSeen} disabled={marking}
              className="w-full rounded-xl py-2.5 text-[13px] font-semibold text-[#0b0d0e] disabled:opacity-40 transition-opacity"
              style={{ background: "linear-gradient(140deg, var(--amber-2), var(--amber))" }}
            >
               {marking ? "Marking…" : "Mark as seen"}
            </button>
          </div>

          <MarketTrends items={changes.items} />

          <Link href={`/w/${id}/history`} className="rounded-2xl border border-[var(--line)] p-5 text-sm text-[var(--muted)] hover:text-[var(--ink)] transition-colors" style={{ background: "linear-gradient(180deg, var(--surface-2), var(--surface))" }}>
            View visit history →
          </Link>

          {/* Tools Widget */}
          <div className="rounded-2xl border border-[var(--line)] p-5" style={{ background: "linear-gradient(180deg, var(--surface-2), var(--surface))" }}>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)] mb-4">Tools & Settings</h3>
            <div className="flex flex-col gap-4">
              <div className="border-t border-[var(--line)] pt-4">
                <button onClick={() => { setEditing((value) => !value); setSymbolsText(watchlist.items.map((item) => item.symbol).join(", ")); }} className="text-left text-sm font-medium flex items-center gap-2" style={{ color: "var(--amber)" }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                  {editing ? "Close bulk edit" : "Bulk edit symbols"}
                </button>

                {editing ? (
                  <div className="mt-3 flex flex-col gap-3">
                    <label className="sr-only" htmlFor="bulk-symbols">Symbols, comma separated</label>
                    <textarea id="bulk-symbols" value={symbolsText} onChange={(event) => setSymbolsText(event.target.value)} rows={3} className="w-full rounded-xl border border-[var(--line-2)] bg-[var(--ground-2)] p-3 text-sm outline-none focus:border-[var(--amber)] transition-colors" />
                    <button onClick={() => void saveBulk()} className="rounded-xl bg-[var(--ink)] px-4 py-2 text-sm font-medium text-[var(--ground)] hover:opacity-90 transition-opacity">Save list</button>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </aside>
      </div>
      {conflict ? <ConflictModal theirs={conflict.theirs} mine={conflict.mine} onKeepMine={() => void saveBulk(conflict.mine, conflict.version)} onKeepTheirs={() => { setWatchlist((current) => current ? { ...current, version: conflict.version, items: conflict.theirs } : current); setConflict(undefined); setEditing(false); }} onMerge={() => void saveBulk([...new Set([...conflict.theirs.map((item) => item.symbol), ...conflict.mine])], conflict.version)} /> : null}
    </main>
  );
}

// Only mounted above VIRTUALIZE_ABOVE items. A fixed-height scroll
// container is required for @tanstack/react-virtual to know how much of
// the list is actually visible at once; row height is estimated then
// measured for real via `measureElement`, since row height varies
// slightly (a stale badge or a low-confidence tag can wrap the row).
function VirtualizedRows({
  items, changes, sparklines, id, refreshWatchlist,
}: {
  items: WatchlistItem[];
  changes: ChangesResponse;
  sparklines: Sparklines;
  id: string;
  refreshWatchlist: (work: () => Promise<Watchlist>) => Promise<void>;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 64,
    overscan: 8,
  });

  return (
    <div ref={parentRef} className="mt-5 max-h-[640px] overflow-y-auto border-y border-[var(--line)]">
      <ul style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}>
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const item = items[virtualRow.index];
          return (
            <WatchlistRow
              key={item.symbol}
              item={item}
              change={changes.items.find((entry) => entry.symbol === item.symbol)?.change}
              sparkline={sparklines[item.symbol]}
              onSensitivity={(choice) => void refreshWatchlist(() => api.setSensitivity(id, item.symbol, choice))}
              onRemove={() => void refreshWatchlist(() => api.removeItem(id, item.symbol))}
              dataIndex={virtualRow.index}
              innerRef={virtualizer.measureElement}
              style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${virtualRow.start}px)` }}
              className={virtualRow.index > 0 ? "border-t border-[var(--line)]" : ""}
            />
          );
        })}
      </ul>
    </div>
  );
}
