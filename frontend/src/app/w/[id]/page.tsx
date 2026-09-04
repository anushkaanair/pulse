"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChangeCard } from "@/components/ChangeCard";
import { AddSymbol } from "@/components/AddSymbol";
import { ConflictModal } from "@/components/ConflictModal";
import { FeedStatusBar } from "@/components/FeedStatusBar";
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

  if (error) { const message = error instanceof ApiRequestError ? `${error.response.error} (${error.response.code})` : "Could not load this watchlist."; return <main className="mx-auto max-w-[880px] px-4 py-12"><Link href="/" className="text-sm underline underline-offset-4 hover:text-[var(--ink)]">Back to watchlists</Link><p className="mt-8 text-sm text-[var(--red)]">{message}</p></main>; }
  if (!watchlist || !changes) return <main className="mx-auto max-w-[880px] px-4 py-12 text-sm text-[var(--muted)]">Loading your catch-up…</main>;
  const meaningful = changes.items.filter((item) => item.change.kind !== "none");

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

  return <main className="min-h-screen"><FeedStatusBar status={changes.feed.status} lagSeconds={changes.feed.lagSeconds} /><div className="mx-auto max-w-[880px] px-4 py-8 sm:px-8"><header className="flex items-center justify-between"><div><Link href="/" className="text-xs text-[var(--muted)] underline underline-offset-4 hover:text-[var(--ink)]">Watchlists</Link><h1 className="mt-2 text-[28px] font-medium tracking-tight">{watchlist.name}</h1><Link href={`/w/${id}/history`} className="mt-1 inline-block text-xs text-[var(--muted)] underline underline-offset-4 hover:text-[var(--ink)]">History</Link></div><button onClick={markSeen} disabled={marking} className="border border-[var(--ink)] px-3 py-2 text-sm disabled:opacity-40 enabled:hover:bg-black/5">{marking ? "Marking…" : "Mark as seen"}</button></header>
    <section className="mt-8"><p className="text-xs tracking-[0.16em] text-[var(--amber)] uppercase">Since you last looked</p><p className="mt-3 max-w-3xl text-xl font-medium leading-7">{changes.digest}</p><p className="mt-2 text-xs text-[var(--muted)]">{changes.baseline.kind === "first-visit" ? "First visit · this becomes your baseline." : `You were away ${away(changes.baseline.awaySeconds)} · ${changes.summary.meaningful} of ${changes.summary.total} worth a look`}</p>
      {changes.summary.meaningful === 0 ? <p className="mt-6 text-sm text-[var(--muted)]">Nothing meaningful changed since {changes.baseline.takenAt ? new Date(changes.baseline.takenAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "your last visit"}.</p> : <div className="mt-6 grid gap-3 md:grid-cols-2">{meaningful.map((item) => <ChangeCard key={item.symbol} item={item} />)}</div>}</section>
    <section className="mt-12"><div className="flex items-baseline justify-between gap-4"><div><p className="text-xs tracking-[0.16em] text-[var(--muted)] uppercase">Full list</p><h2 className="mt-2 text-xl font-medium">Everything you track</h2></div><div className="flex items-center gap-4"><span className="text-xs text-[var(--muted)]">{watchlist.items.length} symbols</span><AddSymbol watchlistId={id} onAdded={setWatchlist} /></div></div><button onClick={() => { setEditing((value) => !value); setSymbolsText(watchlist.items.map((item) => item.symbol).join(", ")); }} className="mt-4 text-xs text-[var(--muted)] underline underline-offset-4 hover:text-[var(--ink)]">{editing ? "Close bulk edit" : "Bulk edit symbols"}</button>{editing ? <div className="mt-3 flex gap-2"><input value={symbolsText} onChange={(event) => setSymbolsText(event.target.value)} aria-label="Symbols, comma separated" className="min-w-0 flex-1 border-b border-[var(--line)] bg-transparent py-2 text-sm outline-none" /><button onClick={() => void saveBulk()} className="border border-[var(--ink)] px-3 py-2 text-sm hover:bg-black/5">Save list</button></div> : null}{watchlist.items.length === 0 ? <p className="mt-5 border-y border-[var(--line)] py-6 text-sm text-[var(--muted)]">This watchlist is empty. Add a symbol to start a baseline.</p> : <>
      <div className="mt-5 flex gap-4 text-[11px] tracking-wide text-[var(--muted)] uppercase">Sort:{(["symbol", "price", "change", "volume"] as const).map((k) => <button key={k} onClick={() => toggleSort(k)} className={`hover:text-[var(--ink)] ${sort.key === k ? "text-[var(--ink)]" : ""}`}>{k}{arrow(k)}</button>)}</div>
      {watchlist.items.length > VIRTUALIZE_ABOVE ? (
      <VirtualizedRows items={sortedItems} changes={changes} sparklines={sparklines} id={id} refreshWatchlist={refreshWatchlist} />
    ) : (
      <ul className="mt-3 divide-y divide-[var(--line)] border-y border-[var(--line)]">
        {sortedItems.map((item) => (
          <li key={item.symbol}>
            <WatchlistRow
              item={item}
              change={changes.items.find((entry) => entry.symbol === item.symbol)?.change}
              sparkline={sparklines[item.symbol]}
              onSensitivity={(choice) => void refreshWatchlist(() => api.setSensitivity(id, item.symbol, choice))}
              onRemove={() => void refreshWatchlist(() => api.removeItem(id, item.symbol))}
            />
          </li>
        ))}
      </ul>
    )}</>}</section>
  </div>{conflict ? <ConflictModal theirs={conflict.theirs} mine={conflict.mine} onKeepMine={() => void saveBulk(conflict.mine, conflict.version)} onKeepTheirs={() => { setWatchlist((current) => current ? { ...current, version: conflict.version, items: conflict.theirs } : current); setConflict(undefined); setEditing(false); }} onMerge={() => void saveBulk([...new Set([...conflict.theirs.map((item) => item.symbol), ...conflict.mine])], conflict.version)} /> : null}</main>;
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
      <div style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}>
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const item = items[virtualRow.index];
          return (
            <div
              key={item.symbol}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${virtualRow.start}px)` }}
              className={virtualRow.index > 0 ? "border-t border-[var(--line)]" : ""}
            >
              <WatchlistRow
                item={item}
                change={changes.items.find((entry) => entry.symbol === item.symbol)?.change}
                sparkline={sparklines[item.symbol]}
                onSensitivity={(choice) => void refreshWatchlist(() => api.setSensitivity(id, item.symbol, choice))}
                onRemove={() => void refreshWatchlist(() => api.removeItem(id, item.symbol))}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
