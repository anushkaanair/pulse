"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ChangeCard } from "@/components/ChangeCard";
import { AddSymbol } from "@/components/AddSymbol";
import { ConflictModal } from "@/components/ConflictModal";
import { FeedStatusBar } from "@/components/FeedStatusBar";
import { StaleBadge } from "@/components/StaleBadge";
import { api, ApiRequestError, type ChangesResponse, type ConflictResponse, type Sensitivity, type Watchlist, type WatchlistItem } from "@/lib/api";

function away(seconds: number | null) { if (!seconds) return null; return seconds >= 3600 ? `${Math.floor(seconds / 3600)}h` : `${Math.max(1, Math.floor(seconds / 60))}m`; }

export default function WatchlistPage() {
  const { id } = useParams<{ id: string }>();
  const [watchlist, setWatchlist] = useState<Watchlist>();
  const [changes, setChanges] = useState<ChangesResponse>();
  const [error, setError] = useState<unknown>();
  const [marking, setMarking] = useState(false);
  const [editing, setEditing] = useState(false);
  const [symbolsText, setSymbolsText] = useState("");
  const [conflict, setConflict] = useState<{ theirs: WatchlistItem[]; mine: string[]; version: number }>();

  useEffect(() => {
    let cancelled = false;
    let latestEtag: string | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    const poll = async () => {
      if (document.visibilityState === "hidden") return;
      try { const response = await api.changes(id, 20, latestEtag); if (cancelled) return; latestEtag = response.etag ?? latestEtag; if (response.data) setChanges(response.data); }
      catch (cause) { if (!cancelled) setError(cause); }
    };
    const begin = async () => { try { const list = await api.watchlist(id); if (!cancelled) setWatchlist(list); await poll(); } catch (cause) { if (!cancelled) setError(cause); } };
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

  if (error) { const message = error instanceof ApiRequestError ? `${error.response.error} (${error.response.code})` : "Could not load this watchlist."; return <main className="mx-auto max-w-[880px] px-4 py-12"><Link href="/" className="text-sm underline underline-offset-4">Back to watchlists</Link><p className="mt-8 text-sm text-[var(--red)]">{message}</p></main>; }
  if (!watchlist || !changes) return <main className="mx-auto max-w-[880px] px-4 py-12 text-sm text-[var(--muted)]">Loading your catch-up…</main>;
  const meaningful = changes.items.filter((item) => item.change.kind !== "none");

  return <main className="min-h-screen"><FeedStatusBar status={changes.feed.status} lagSeconds={changes.feed.lagSeconds} /><div className="mx-auto max-w-[880px] px-4 py-8 sm:px-8"><header className="flex items-center justify-between"><div><Link href="/" className="text-xs text-[var(--muted)] underline underline-offset-4">Watchlists</Link><h1 className="mt-2 text-[28px] font-medium tracking-tight">{watchlist.name}</h1></div><button onClick={markSeen} disabled={marking} className="border border-[var(--ink)] px-3 py-2 text-sm disabled:opacity-40">{marking ? "Marking…" : "Mark as seen"}</button></header>
    <section className="mt-8"><p className="text-xs tracking-[0.16em] text-[var(--amber)] uppercase">Since you last looked</p><p className="mt-3 max-w-3xl text-xl font-medium leading-7">{changes.digest}</p><p className="mt-2 text-xs text-[var(--muted)]">{changes.baseline.kind === "first-visit" ? "First visit · this becomes your baseline." : `You were away ${away(changes.baseline.awaySeconds)} · ${changes.summary.meaningful} of ${changes.summary.total} worth a look`}</p>
      {changes.summary.meaningful === 0 ? <p className="mt-6 text-sm text-[var(--muted)]">Nothing meaningful changed since {changes.baseline.takenAt ? new Date(changes.baseline.takenAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "your last visit"}.</p> : <div className="mt-6 grid gap-3 md:grid-cols-2">{meaningful.map((item) => <ChangeCard key={item.symbol} item={item} />)}</div>}</section>
    <section className="mt-12"><div className="flex items-baseline justify-between gap-4"><div><p className="text-xs tracking-[0.16em] text-[var(--muted)] uppercase">Full list</p><h2 className="mt-2 text-xl font-medium">Everything you track</h2></div><div className="flex items-center gap-4"><span className="text-xs text-[var(--muted)]">{watchlist.items.length} symbols</span><AddSymbol watchlistId={id} onAdded={setWatchlist} /></div></div><button onClick={() => { setEditing((value) => !value); setSymbolsText(watchlist.items.map((item) => item.symbol).join(", ")); }} className="mt-4 text-xs text-[var(--muted)] underline underline-offset-4">{editing ? "Close bulk edit" : "Bulk edit symbols"}</button>{editing ? <div className="mt-3 flex gap-2"><input value={symbolsText} onChange={(event) => setSymbolsText(event.target.value)} className="min-w-0 flex-1 border-b border-[var(--line)] bg-transparent py-2 text-sm outline-none" /><button onClick={() => void saveBulk()} className="border border-[var(--ink)] px-3 py-2 text-sm">Save list</button></div> : null}{watchlist.items.length === 0 ? <p className="mt-5 border-y border-[var(--line)] py-6 text-sm text-[var(--muted)]">This watchlist is empty. Add a symbol to start a baseline.</p> : <ul className="mt-5 divide-y divide-[var(--line)] border-y border-[var(--line)]">{watchlist.items.map((item) => { const change = changes.items.find((entry) => entry.symbol === item.symbol)?.change; return <li key={item.symbol} className="flex flex-wrap items-center gap-x-4 gap-y-3 py-3"><div className="min-w-28 flex-1"><span className="text-sm font-medium">{item.symbol}</span><span className="ml-2 text-xs text-[var(--muted)]">{item.name}</span></div><div className="min-w-24 text-right"><span className="numbers text-sm">{item.quote?.price ?? "—"}</span>{change?.pctSincePrev ? <span className={`numbers ml-2 text-xs ${change.pctSincePrev.startsWith("-") ? "text-[var(--red)]" : "text-[var(--green)]"}`}>{change.pctSincePrev}%</span> : null}</div>{item.quote ? <StaleBadge quote={item.quote} /> : <span className="text-xs text-[var(--muted)]">No quote</span>}<div className="flex border border-[var(--line)] text-xs">{(["quiet", "normal", "loud"] as Sensitivity[]).map((choice) => <button key={choice} onClick={() => void refreshWatchlist(() => api.setSensitivity(id, item.symbol, choice))} className={`px-2 py-1 ${item.sensitivity === choice ? "bg-black/10 text-[var(--ink)]" : "text-[var(--muted)]"}`}>{choice}</button>)}</div><button onClick={() => void refreshWatchlist(() => api.removeItem(id, item.symbol))} className="text-xs text-[var(--muted)] underline underline-offset-4 hover:text-[var(--red)]">Remove</button></li>; })}</ul>}</section>
  </div>{conflict ? <ConflictModal theirs={conflict.theirs} mine={conflict.mine} onKeepMine={() => void saveBulk(conflict.mine, conflict.version)} onKeepTheirs={() => { setWatchlist((current) => current ? { ...current, version: conflict.version, items: conflict.theirs } : current); setConflict(undefined); setEditing(false); }} onMerge={() => void saveBulk([...new Set([...conflict.theirs.map((item) => item.symbol), ...conflict.mine])], conflict.version)} /> : null}</main>;
}
