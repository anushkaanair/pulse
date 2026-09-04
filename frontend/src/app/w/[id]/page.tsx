"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ChangeCard } from "@/components/ChangeCard";
import { FeedStatusBar } from "@/components/FeedStatusBar";
import { StaleBadge } from "@/components/StaleBadge";
import { api, ApiRequestError, type ChangesResponse, type Sensitivity, type Watchlist } from "@/lib/api";

function away(seconds: number | null) { if (!seconds) return null; return seconds >= 3600 ? `${Math.floor(seconds / 3600)}h` : `${Math.max(1, Math.floor(seconds / 60))}m`; }

export default function WatchlistPage() {
  const { id } = useParams<{ id: string }>();
  const [watchlist, setWatchlist] = useState<Watchlist>();
  const [changes, setChanges] = useState<ChangesResponse>();
  const [error, setError] = useState<unknown>();
  const [marking, setMarking] = useState(false);

  useEffect(() => { void Promise.all([api.watchlist(id), api.changes(id)]).then(([list, poll]) => { setWatchlist(list); setChanges(poll.data ?? undefined); }).catch(setError); }, [id]);
  const refreshWatchlist = async (work: () => Promise<Watchlist>) => { try { setWatchlist(await work()); } catch (cause) { setError(cause); } };
  const markSeen = async () => { if (!changes) return; setMarking(true); try { await api.checkpoint(id, changes.snapshotId); const latest = await api.changes(id); setChanges(latest.data ?? undefined); } catch (cause) { setError(cause); } finally { setMarking(false); } };

  if (error) { const message = error instanceof ApiRequestError ? `${error.response.error} (${error.response.code})` : "Could not load this watchlist."; return <main className="mx-auto max-w-[880px] px-4 py-12"><Link href="/" className="text-sm underline underline-offset-4">Back to watchlists</Link><p className="mt-8 text-sm text-[var(--red)]">{message}</p></main>; }
  if (!watchlist || !changes) return <main className="mx-auto max-w-[880px] px-4 py-12 text-sm text-[var(--muted)]">Loading your catch-up…</main>;
  const meaningful = changes.items.filter((item) => item.change.kind !== "none");

  return <main className="min-h-screen"><FeedStatusBar status={changes.feed.status} lagSeconds={changes.feed.lagSeconds} /><div className="mx-auto max-w-[880px] px-4 py-8 sm:px-8"><header className="flex items-center justify-between"><div><Link href="/" className="text-xs text-[var(--muted)] underline underline-offset-4">Watchlists</Link><h1 className="mt-2 text-[28px] font-medium tracking-tight">{watchlist.name}</h1></div><button onClick={markSeen} disabled={marking} className="border border-[var(--ink)] px-3 py-2 text-sm disabled:opacity-40">{marking ? "Marking…" : "Mark as seen"}</button></header>
    <section className="mt-8"><p className="text-xs tracking-[0.16em] text-[var(--amber)] uppercase">Since you last looked</p><p className="mt-3 max-w-3xl text-xl font-medium leading-7">{changes.digest}</p><p className="mt-2 text-xs text-[var(--muted)]">{changes.baseline.kind === "first-visit" ? "First visit · this becomes your baseline." : `You were away ${away(changes.baseline.awaySeconds)} · ${changes.summary.meaningful} of ${changes.summary.total} worth a look`}</p>
      {changes.summary.meaningful === 0 ? <p className="mt-6 text-sm text-[var(--muted)]">Nothing meaningful changed since {changes.baseline.takenAt ? new Date(changes.baseline.takenAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "your last visit"}.</p> : <div className="mt-6 grid gap-3 md:grid-cols-2">{meaningful.map((item) => <ChangeCard key={item.symbol} item={item} />)}</div>}</section>
    <section className="mt-12"><div className="flex items-baseline justify-between"><div><p className="text-xs tracking-[0.16em] text-[var(--muted)] uppercase">Full list</p><h2 className="mt-2 text-xl font-medium">Everything you track</h2></div><span className="text-xs text-[var(--muted)]">{watchlist.items.length} symbols</span></div>{watchlist.items.length === 0 ? <p className="mt-5 border-y border-[var(--line)] py-6 text-sm text-[var(--muted)]">This watchlist is empty. Add a symbol to start a baseline.</p> : <ul className="mt-5 divide-y divide-[var(--line)] border-y border-[var(--line)]">{watchlist.items.map((item) => { const change = changes.items.find((entry) => entry.symbol === item.symbol)?.change; return <li key={item.symbol} className="flex flex-wrap items-center gap-x-4 gap-y-3 py-3"><div className="min-w-28 flex-1"><span className="text-sm font-medium">{item.symbol}</span><span className="ml-2 text-xs text-[var(--muted)]">{item.name}</span></div><div className="min-w-24 text-right"><span className="numbers text-sm">{item.quote?.price ?? "—"}</span>{change?.pctSincePrev ? <span className={`numbers ml-2 text-xs ${change.pctSincePrev.startsWith("-") ? "text-[var(--red)]" : "text-[var(--green)]"}`}>{change.pctSincePrev}%</span> : null}</div>{item.quote ? <StaleBadge quote={item.quote} /> : <span className="text-xs text-[var(--muted)]">No quote</span>}<div className="flex border border-[var(--line)] text-xs">{(["quiet", "normal", "loud"] as Sensitivity[]).map((choice) => <button key={choice} onClick={() => void refreshWatchlist(() => api.setSensitivity(id, item.symbol, choice))} className={`px-2 py-1 ${item.sensitivity === choice ? "bg-black/10 text-[var(--ink)]" : "text-[var(--muted)]"}`}>{choice}</button>)}</div><button onClick={() => void refreshWatchlist(() => api.removeItem(id, item.symbol))} className="text-xs text-[var(--muted)] underline underline-offset-4 hover:text-[var(--red)]">Remove</button></li>; })}</ul>}</section>
  </div></main>;
}
