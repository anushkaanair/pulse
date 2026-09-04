"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { api, ApiRequestError, switchUser, type WatchlistSummary } from "@/lib/api";

function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof ApiRequestError ? `${error.response.error} (${error.response.code})` : "Could not load watchlists.";
  return <p className="mt-4 text-sm text-[var(--red)]">{message}</p>;
}

export default function WatchlistsPage() {
  const [lists, setLists] = useState<WatchlistSummary[]>([]);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<unknown>();

  const load = async () => {
    setLoading(true);
    try { setLists(await api.watchlists()); setError(undefined); }
    catch (cause) { setError(cause); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    try { const list = await api.createWatchlist(name.trim()); setLists((old) => [{ id: list.id, name: list.name, version: list.version, itemCount: 0, updatedAt: new Date().toISOString() }, ...old]); setName(""); }
    catch (cause) { setError(cause); }
    finally { setCreating(false); }
  }

  return (
    <main className="mx-auto min-h-screen max-w-[880px] px-4 py-12 sm:px-8">
      <header className="flex items-start justify-between border-b border-[var(--line)] pb-6">
        <div>
          <p className="text-xs tracking-[0.16em] text-[var(--muted)] uppercase">Market watchlist</p>
          <h1 className="mt-2 text-[28px] font-medium tracking-tight">What deserves attention</h1>
          <p className="mt-2 max-w-md text-sm text-[var(--muted)]">A calm catch-up on what changed since you last looked.</p>
        </div>
        <button onClick={() => { switchUser(); void load(); }} className="text-xs text-[var(--muted)] underline underline-offset-4 hover:text-[var(--ink)]">Switch user</button>
      </header>

      <section className="mt-8 grid gap-6 md:grid-cols-[1fr_300px]">
        <div>
          <h2 className="text-xl font-medium">Your watchlists</h2>
          {loading ? <p className="mt-5 text-sm text-[var(--muted)]">Loading watchlists…</p> : null}
          {!loading && lists.length === 0 ? <div className="mt-5 border-y border-[var(--line)] py-8"><p className="text-sm">No watchlist yet.</p><p className="mt-1 text-sm text-[var(--muted)]">Create one, then add the symbols you want to check in on.</p></div> : null}
          {!loading && lists.length > 0 ? <ul className="mt-5 divide-y divide-[var(--line)] border-y border-[var(--line)]">{lists.map((list) => <li key={list.id}><Link href={`/w/${list.id}`} className="flex items-center justify-between py-4 transition-opacity hover:opacity-65"><span><span className="block text-base font-medium">{list.name}</span><span className="mt-1 block text-xs text-[var(--muted)]">{list.itemCount} {list.itemCount === 1 ? "symbol" : "symbols"} · updated {new Date(list.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span></span><span aria-hidden="true" className="text-[var(--muted)]">→</span></Link></li>)}</ul> : null}
          <ErrorText error={error} />
        </div>

        <form onSubmit={create} className="h-fit border border-[var(--line)] p-4">
          <h2 className="text-sm font-medium">New watchlist</h2>
          <label htmlFor="watchlist-name" className="sr-only">Watchlist name</label>
          <input id="watchlist-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Long term" className="mt-3 w-full border-b border-[var(--line)] bg-transparent py-2 text-sm outline-none placeholder:text-[var(--muted)] focus:border-[var(--ink)]" />
          <button disabled={creating || !name.trim()} className="mt-4 w-full bg-[var(--ink)] px-3 py-2 text-sm text-[var(--ground)] disabled:opacity-40 enabled:hover:opacity-85">{creating ? "Creating…" : "Create watchlist"}</button>
        </form>
      </section>
    </main>
  );
}
