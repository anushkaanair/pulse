"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { AddSymbol } from "@/components/AddSymbol";
import { AttentionDeck } from "@/components/AttentionDeck";
import { ConflictModal } from "@/components/ConflictModal";
import { FeedStatusBar } from "@/components/FeedStatusBar";
import { InvestmentsCard } from "@/components/InvestmentsCard";
import { MarketRail } from "@/components/MarketRail";
import { MarketTrends } from "@/components/MarketTrends";
import { WatchlistRow } from "@/components/WatchlistRow";
import { api, ApiRequestError, withRetry, type ChangesResponse, type ConflictResponse, type Sensitivity, type Sparklines, type Watchlist, type WatchlistSummary, type WatchlistItem } from "@/lib/api";

// Below this, real DOM rows are simpler and there's no cost to justify
// virtualizing. Above it, a plain map() renders every row's DOM eagerly
// even for the ~99% that are scrolled out of view — virtualization keeps
// the mounted node count roughly constant regardless of list size.
const VIRTUALIZE_ABOVE = 100;

// One-click fixes for the empty-first-visit problem: a brand-new watchlist
// (and every fresh demo user) starts with nothing to show a baseline
// against. These reuse the existing bulk-replace mutation — no new backend
// endpoint — so they're just a curated symbol list, not new plumbing.
const STARTER_PACKS: { label: string; symbols: string[] }[] = [
  { label: "Nifty Top 10", symbols: ["RELIANCE", "TCS", "HDFCBANK", "INFY", "ICICIBANK", "HINDUNILVR", "ITC", "SBIN", "BHARTIARTL", "LT"] },
  { label: "Banking", symbols: ["HDFCBANK", "ICICIBANK", "KOTAKBANK", "AXISBANK", "SBIN", "INDUSINDBK"] },
  { label: "IT", symbols: ["TCS", "INFY", "HCLTECH", "WIPRO", "TECHM"] },
];

function away(seconds: number | null) { if (!seconds) return null; return seconds >= 3600 ? `${Math.floor(seconds / 3600)}h` : `${Math.max(1, Math.floor(seconds / 60))}m`; }

const NEW_LIST_MAX = 18;

export default function WatchlistPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [watchlist, setWatchlist] = useState<Watchlist>();
  const [allWatchlists, setAllWatchlists] = useState<WatchlistSummary[]>([]);
  const [newListOpen, setNewListOpen] = useState(false);
  const [newListName, setNewListName] = useState("");
  const [newListBusy, setNewListBusy] = useState(false);
  const [newListError, setNewListError] = useState<string>();
  const [changes, setChanges] = useState<ChangesResponse>();
  const [sparklines, setSparklines] = useState<Sparklines>({});
  const [error, setError] = useState<unknown>();
  const [marking, setMarking] = useState(false);
  const [editing, setEditing] = useState(false);
  const [symbolsText, setSymbolsText] = useState("");
  const [conflict, setConflict] = useState<{ theirs: WatchlistItem[]; mine: string[]; version: number }>();
  const [sort, setSort] = useState<{ key: "symbol" | "price" | "change" | "volume"; dir: 1 | -1 }>({ key: "symbol", dir: 1 });

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

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
    // retry=true only for the FIRST load — the fetch the user waits on before
    // anything is on screen. Recurring/background polls pass false: a failed
    // poll should be skipped and retried on the next 15s tick, not hammered.
    const fetchChanges = async (retry = false) => {
      try {
        const response = retry ? await withRetry(() => api.changes(id, 20, latestEtag)) : await api.changes(id, 20, latestEtag);
        if (cancelled) return;
        latestEtag = response.etag ?? latestEtag;
        if (response.data) setChanges(response.data);
        setSparklines(await api.sparklines(id, 30));
      } catch (cause) { if (!cancelled) setError(cause); }
    };
    // Recurring/background-triggered polls DO respect visibility — no
    // point spending requests on a tab nobody's looking at.
    const poll = async () => { if (document.visibilityState !== "hidden") await fetchChanges(); };
    const begin = async () => { try { const list = await withRetry(() => api.watchlist(id)); if (!cancelled) setWatchlist(list); await fetchChanges(true); api.watchlists().then(wl => { if (!cancelled) setAllWatchlists(wl); }).catch(() => {}); } catch (cause) { if (!cancelled) setError(cause); } };
    const visibility = () => { if (document.visibilityState === "visible") void poll(); };
    void begin();
    timer = setInterval(() => void poll(), 15_000);
    document.addEventListener("visibilitychange", visibility);
    return () => { cancelled = true; if (timer) clearInterval(timer); document.removeEventListener("visibilitychange", visibility); };
  }, [id]);
  const refreshWatchlist = async (work: () => Promise<Watchlist>) => { try { setWatchlist(await work()); } catch (cause) { setError(cause); } };
  const markSeen = async () => { if (!changes) return; setMarking(true); try { await api.checkpoint(id, changes.snapshotId); const latest = await api.changes(id); setChanges(latest.data ?? undefined); } catch (cause) { setError(cause); } finally { setMarking(false); } };
  // Personalization: fire-and-forget, never surfaced to the user as an
  // error — a failed "you opened this" write shouldn't interrupt reading it.
  const recordOpen = (symbol: string) => { void api.recordOpen(symbol).catch(() => {}); };
  // Snooze needs a real re-fetch (not an optimistic local edit): the card
  // disappearing from the deck should reflect the server actually having
  // suppressed it, the same trust boundary markSeen already follows.
  const snoozeSymbol = async (symbol: string) => { try { await api.snooze(symbol); const latest = await api.changes(id); setChanges(latest.data ?? undefined); } catch (cause) { setError(cause); } };
  // Deep link from a preview chip on /app ("BAJFINANCE -2.52%" → this
  // exact row in this exact list). Plain window.location rather than
  // useSearchParams — this only needs to run once, and useSearchParams
  // would require wrapping the whole page in a Suspense boundary for the
  // production build for a one-off scroll-and-highlight.
  const deepLinkDone = useRef(false);
  useEffect(() => {
    if (deepLinkDone.current || !watchlist || !changes) return;
    const symbol = new URLSearchParams(window.location.search).get("symbol");
    if (!symbol) return;
    deepLinkDone.current = true;
    // The attention deck and sparklines above this list are still settling
    // their own layout for a beat after `changes` first arrives — scrolling
    // immediately landed short (found live: the target row was still
    // drifting downward as the deck finished sizing itself). A short delay
    // lets that settle before measuring position. `changes` also re-fires
    // on every 15s poll, so this only ever runs once (deepLinkDone) —
    // otherwise a stale ?symbol= in the URL would re-scroll-and-flash the
    // page out from under the user every time it repolls.
    const t = setTimeout(() => {
      const row = document.getElementById(`row-${symbol}`);
      if (!row) return;
      row.scrollIntoView({ block: "center", behavior: "smooth" });
      row.classList.add("deep-link-flash");
      setTimeout(() => row.classList.remove("deep-link-flash"), 2200);
    }, 350);
    return () => clearTimeout(t);
  }, [watchlist, changes]);

  const requestedSymbols = () => [...new Set(symbolsText.split(",").map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))];
  const createNewList = async () => {
    const trimmed = newListName.trim();
    if (!trimmed) return;
    setNewListBusy(true); setNewListError(undefined);
    try {
      const list = await api.createWatchlist(trimmed);
      // A brand-new list has nothing to show yet — its own page's
      // first-visit baseline message is the correct landing spot, not
      // back to the /app list-of-lists.
      router.push(`/w/${list.id}`);
    } catch (cause) {
      setNewListError(cause instanceof ApiRequestError ? `${cause.response.error} (${cause.response.code})` : "Could not create this watchlist.");
    } finally { setNewListBusy(false); }
  };
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
  const lowConfidence = changes.items.filter((item) => item.change.confidence === "low").length;
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
      <MarketRail items={changes.items} />
      <div className="mx-auto max-w-7xl px-4 pt-3 pb-2">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
          {allWatchlists.map(wl => (
            <Link
              key={wl.id}
              href={`/w/${wl.id}`}
              className={`px-4 py-1.5 rounded-full text-[14px] font-medium transition-colors ${wl.id === id ? 'bg-[var(--accent)] text-white shadow-md shadow-[var(--accent)]/20' : 'bg-[var(--surface-2)] text-[var(--muted)] hover:text-[var(--ink)]'}`}
            >
              {wl.name}
            </Link>
          ))}
          <button
            type="button"
            data-tour="new-watchlist-button"
            onClick={() => { setNewListName(""); setNewListError(undefined); setNewListOpen(true); }}
            className="flex items-center gap-1.5 rounded-full border border-dashed border-[var(--line-2)] px-3 py-1.5 text-[13px] font-medium text-[var(--muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)] ml-1"
          >
            <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 2.5v11M2.5 8h11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
            Watchlist
          </button>
          <button
            type="button"
            onClick={() => window.dispatchEvent(new Event("pulse:start-tour"))}
            className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium text-[var(--amber)] transition-colors hover:opacity-80 ml-auto"
            style={{ background: "rgba(230,160,60,.14)" }}
          >
            <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M5 3.5v9l7-4.5-7-4.5Z" fill="currentColor"/></svg>
            Take the tour
          </button>
        </div>
      </div>

      {newListOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(10,10,12,.55)" }}
          onClick={() => !newListBusy && setNewListOpen(false)}
        >
          <div
            role="dialog" aria-modal="true" aria-labelledby="new-list-title"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-[360px] rounded-2xl border border-[var(--line)] p-6"
            style={{ background: "var(--surface)" }}
          >
            <h2 id="new-list-title" className="m-0 text-[17px] font-semibold tracking-tight">Create new watchlist</h2>
            <input
              autoFocus value={newListName} maxLength={NEW_LIST_MAX}
              onChange={(e) => setNewListName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && newListName.trim() && !newListBusy) void createNewList(); }}
              placeholder="Enter watchlist name"
              className="mt-4 w-full rounded-xl border border-[var(--line-2)] bg-[var(--ground-2)] px-3.5 py-2.5 text-sm outline-none transition-colors placeholder:text-[var(--muted)] focus:border-[var(--amber)]"
            />
            <p className="mt-1.5 mb-0 text-[11px] text-[var(--muted)]">Max {NEW_LIST_MAX} characters</p>
            {newListError ? <p className="mt-2 mb-0 text-xs text-[var(--red)]">{newListError}</p> : null}
            <button
              onClick={() => void createNewList()}
              disabled={!newListName.trim() || newListBusy}
              className="mt-4 w-full rounded-xl py-2.5 text-[14px] font-semibold text-[#0b0d0e] disabled:opacity-30 transition-opacity"
              style={{ background: "linear-gradient(140deg, var(--amber-2), var(--amber))" }}
            >
              {newListBusy ? "Creating…" : "Create"}
            </button>
          </div>
        </div>
      ) : null}
      <div className="mx-auto max-w-7xl px-4 pt-4 pb-24 lg:pb-8 grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-8">

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
          <section data-tour="attention-deck" className="mb-4">
            <h2 className="text-lg font-medium mb-3 tracking-tight">Most meaningful changes</h2>
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <span className="text-sm font-medium text-[var(--muted)] whitespace-nowrap">
                {changes.baseline.takenAt ? `Since ${away(Math.floor((Date.now() - new Date(changes.baseline.takenAt).getTime()) / 1000))} ago:` : "Since your last visit:"}
              </span>
              
              {changes.summary.meaningful > 0 ? (
                <span className="rounded-full bg-[var(--amber)]/15 px-2.5 py-1 text-[11px] font-bold text-[var(--amber)] whitespace-nowrap border border-[var(--amber)]/30 shadow-sm">
                  {changes.summary.meaningful} {changes.summary.meaningful === 1 ? "thing" : "things"} worth a look
                </span>
              ) : (
                <span className="rounded-full border border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-1 text-[11px] font-medium text-[var(--muted)] whitespace-nowrap">
                  No major updates
                </span>
              )}
              {/* The count alone doesn't say WHICH stocks — the actual
                  "since you last looked" chips, restored here after the
                  mobile-layout pass had quietly dropped them down to just
                  a number. This is the line the whole product's pitch
                  rests on; it needs to name names, not just count them. */}
              {meaningful.slice(0, 3).map((item) => (
                <span key={item.symbol} className="numbers rounded-full bg-[var(--surface-2)] border border-[var(--line)] px-2.5 py-1 text-[11px] font-medium whitespace-nowrap">
                  <span className="text-[var(--ink-2)]">{item.symbol}</span>{" "}
                  <span style={{ color: item.change.pctSincePrev?.startsWith("-") ? "var(--red)" : "var(--green)" }}>
                    {item.change.pctSincePrev ? `${item.change.pctSincePrev}%` : "new"}
                  </span>
                  {item.change.zScore !== null ? <span className="text-[var(--muted)]"> ({Math.abs(item.change.zScore).toFixed(1)}σ)</span> : null}
                </span>
              ))}
              {meaningful.length > 3 ? (
                <span className="text-[11px] text-[var(--muted)] whitespace-nowrap">+{meaningful.length - 3} more</span>
              ) : null}
            </div>
            {changes.summary.meaningful === 0 ? (
               <div className="relative">
                 <p className="text-[13px] font-medium text-[var(--muted)] mb-3 bg-[var(--surface-2)] inline-block px-3 py-1.5 rounded-lg border border-[var(--line)]">
                   No major updates since {changes.baseline.takenAt ? new Date(changes.baseline.takenAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "your last visit"}. Showing latest movements:
                 </p>
                 {changes.items.length > 0 ? (
                   <AttentionDeck items={changes.items.slice(0, 3)} sparklines={sparklines} topMover={changes.topMover} onRefresh={markSeen} refreshing={marking} onOpen={recordOpen} onSnooze={snoozeSymbol} />
                 ) : (
                   <p className="text-sm text-[var(--muted)] bg-[var(--surface)] p-6 rounded-2xl border border-[var(--line)]">Your watchlist is completely empty.</p>
                 )}
               </div>
            ) : (
               <AttentionDeck items={rankedForAttention} sparklines={sparklines} topMover={changes.topMover} onRefresh={markSeen} refreshing={marking} onOpen={recordOpen} onSnooze={snoozeSymbol} />
            )}
            {overflow > 0 ? (
              <p className="mt-2 text-xs text-[var(--muted)]">+{overflow} more meaningful, ranked lower — see the full list below.</p>
            ) : null}
          </section>

          {/* Mobile Investments Card (shown only on mobile below attention deck) */}
          <div className="block lg:hidden mb-6">
            <InvestmentsCard items={changes.items} id={id} dataTour="paper-card" />
          </div>

          {/* Full List */}
          <section data-tour="stock-list">
            <div className="flex items-center gap-4 mb-4 flex-wrap">
               <h2 className="text-xl font-medium tracking-tight">All tracked stocks</h2>
               <div className="hidden sm:flex gap-2">
                 {(["symbol", "price", "change", "volume"] as const).map((k) => (
                   <button key={k} onClick={() => toggleSort(k)} className="rounded-full border px-3.5 py-1 text-xs font-medium transition-colors" style={sort.key === k ? { borderColor: "var(--amber)", color: "var(--amber)", background: "rgba(0,190,140,.1)" } : { borderColor: "var(--line)", color: "var(--muted)" }}>{k === "symbol" ? "Stock" : k.charAt(0).toUpperCase() + k.slice(1)}{arrow(k)}</button>
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
                 <div className="p-8 text-center">
                   <p className="text-sm text-[var(--muted)]">This watchlist is empty. Add a stock to start a baseline.</p>
                   <p className="mt-4 text-xs text-[var(--muted)]">Or start from a preset:</p>
                   <div data-tour="starter-packs" className="mt-2.5 flex flex-wrap justify-center gap-2">
                     {STARTER_PACKS.map((pack) => (
                       <button
                         key={pack.label}
                         onClick={() => void saveBulk(pack.symbols, watchlist.version)}
                         className="rounded-full border border-[var(--line)] bg-[var(--surface-2)] px-4 py-2 text-xs font-medium text-[var(--ink-2)] transition-colors hover:border-[var(--amber)] hover:text-[var(--amber)]"
                       >
                         {pack.label}
                       </button>
                     ))}
                   </div>
                 </div>
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
        {/* Right Column - Sidebar */}
        <aside className="hidden lg:flex flex-col gap-4">
          <SidebarContent />
        </aside>
      </div>

      {/* Mobile Sticky Menu Button */}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-30 lg:hidden pointer-events-auto">
        <button onClick={() => setMobileMenuOpen(true)} className="bg-[var(--surface)] text-[var(--ink)] border border-[var(--line)] shadow-[0_8px_30px_rgb(0,0,0,0.12)] px-5 py-2.5 rounded-full font-medium text-[14px] flex items-center gap-2 hover:bg-[var(--surface-2)] transition-colors">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 6h16M4 12h16M4 18h16"/></svg>
          Tools & Summary
        </button>
      </div>

      {/* Mobile Menu Slide Sleeve */}
      <div 
        className={`fixed inset-0 z-50 lg:hidden transition-opacity duration-300 ${mobileMenuOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`} 
        onClick={() => setMobileMenuOpen(false)}
      >
        {/* Backdrop */}
        <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" />
        
        {/* Sliding Panel */}
        <div 
          className={`absolute inset-y-0 right-0 w-full sm:w-[400px] bg-[var(--ground)] shadow-2xl transition-transform duration-300 ease-out flex flex-col ${mobileMenuOpen ? 'translate-x-0' : 'translate-x-full'}`} 
          onClick={e => e.stopPropagation()}
        >
          <div className="flex items-center justify-between border-b border-[var(--line)] p-5">
            <h2 className="text-xl font-bold tracking-tight">Menu</h2>
            <button onClick={() => setMobileMenuOpen(false)} className="p-2 -mr-2 text-[var(--muted)] hover:text-[var(--ink)] bg-[var(--surface)] rounded-full border border-[var(--line-2)]">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </div>
          
          <div className="p-5 flex-1 overflow-y-auto flex flex-col gap-4">
            <SidebarContent isMobile={true} />
          </div>
        </div>
      </div>

      {conflict ? <ConflictModal theirs={conflict.theirs} mine={conflict.mine} onKeepMine={() => void saveBulk(conflict.mine, conflict.version)} onKeepTheirs={() => { setWatchlist((current) => current ? { ...current, version: conflict.version, items: conflict.theirs } : current); setConflict(undefined); setEditing(false); }} onMerge={() => void saveBulk([...new Set([...conflict.theirs.map((item) => item.symbol), ...conflict.mine])], conflict.version)} /> : null}
    </main>
  );

  function SidebarContent({ isMobile = false }: { isMobile?: boolean }) {
    return (
      <>
        {/* Watchlist Summary */}
        <div className="rounded-2xl border border-[var(--line)] p-4" style={{ background: "linear-gradient(180deg, var(--surface-2), var(--surface))" }}>
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Watchlist summary</h3>
            <p className="numbers m-0 text-[22px] font-semibold tracking-tight">{watchlist!.items.length}</p>
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-[var(--line)] pt-2.5 text-[12.5px]">
             <span className="text-[var(--muted)]">Thin history</span>
             <span className="numbers font-semibold" style={{ color: lowConfidence > 0 ? "var(--amber)" : "var(--ink)" }}>{lowConfidence}</span>
          </div>
          <div className="mt-1.5 flex items-center justify-between text-[12.5px]">
             <span className="text-[var(--muted)]">Time away</span>
             <span className="font-medium">{changes!.baseline.kind === "first-visit" ? "First visit" : (away(changes!.baseline.awaySeconds) ?? "—")}</span>
          </div>
          <button
            onClick={markSeen} disabled={marking}
            title="Resets your baseline to the current prices — future visits compare against this moment"
            className="mt-3 w-full rounded-xl py-2 text-[12.5px] font-semibold text-[#0b0d0e] disabled:opacity-40 transition-opacity"
            style={{ background: "linear-gradient(140deg, var(--amber-2), var(--amber))" }}
          >
             {marking ? "Resetting…" : "Reset baseline"}
          </button>
        </div>

        {/* Also shown on mobile now (previously desktop-only here, to avoid
            a duplicate with the inline copy further down the page) — the
            "Tools & Summary" sheet is the natural place a mobile user
            checks for it, and it was invisible from there entirely. A
            second entry point costs nothing; being unreachable did. */}
        <InvestmentsCard items={changes!.items} id={id} dataTour="paper-card" />
        <MarketTrends items={changes!.items} />

        <Link href={`/w/${id}/history`} data-tour="history-link" className="rounded-2xl border border-[var(--line)] p-5 text-sm font-medium text-[var(--muted)] hover:text-[var(--ink)] transition-colors flex items-center justify-between" style={{ background: "linear-gradient(180deg, var(--surface-2), var(--surface))" }}>
          View visit history <span>→</span>
        </Link>

        {/* Tools Widget */}
        <div className="rounded-2xl border border-[var(--line)] p-5" style={{ background: "linear-gradient(180deg, var(--surface-2), var(--surface))" }}>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)] mb-4">Settings</h3>
          <div className="flex flex-col gap-4">
            <div className="border-t border-[var(--line)] pt-4">
              <button onClick={() => { setEditing((value) => !value); setSymbolsText(watchlist!.items.map((item) => item.symbol).join(", ")); }} className="text-left text-sm font-medium flex items-center gap-2" style={{ color: "var(--amber)" }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                {editing ? "Close bulk edit" : "Bulk edit stocks"}
              </button>

              {editing ? (
                <div className="mt-3 flex flex-col gap-3">
                  <label className="sr-only" htmlFor="bulk-symbols">Stocks, comma separated</label>
                  <textarea id="bulk-symbols" value={symbolsText} onChange={(event) => setSymbolsText(event.target.value)} rows={3} className="w-full rounded-xl border border-[var(--line-2)] bg-[var(--ground-2)] p-3 text-sm outline-none focus:border-[var(--amber)] transition-colors" />
                  <button onClick={() => { void saveBulk(); if (isMobile) setMobileMenuOpen(false); }} className="rounded-xl bg-[var(--ink)] px-4 py-2 text-sm font-medium text-[var(--ground)] hover:opacity-90 transition-opacity">Save list</button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </>
    );
  }
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
