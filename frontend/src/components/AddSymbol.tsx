"use client";

import { useEffect, useState } from "react";
import { api, ApiRequestError, type Watchlist } from "@/lib/api";

export function AddSymbol({ watchlistId, onAdded }: { watchlistId: string; onAdded: (watchlist: Watchlist) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Awaited<ReturnType<typeof api.searchSymbols>>>([]);
  const [error, setError] = useState<string>();

  useEffect(() => { if (!query.trim()) { setResults([]); return; } const timer = window.setTimeout(() => { void api.searchSymbols(query).then(setResults).catch(() => setError("Could not search symbols.")); }, 200); return () => window.clearTimeout(timer); }, [query]);
  async function add(symbol: string) { try { onAdded(await api.addItem(watchlistId, symbol)); setQuery(""); setResults([]); setError(undefined); } catch (cause) { setError(cause instanceof ApiRequestError && cause.response.code === "UNKNOWN_SYMBOL" ? "That symbol is not available." : "Could not add this symbol."); } }

  return <div className="relative"><label className="sr-only" htmlFor="add-symbol">Add a symbol</label><input id="add-symbol" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Add a symbol" className="w-36 border-b border-[var(--line)] bg-transparent py-1 text-sm outline-none placeholder:text-[var(--muted)] focus:border-[var(--ink)]" />{error ? <p className="mt-1 text-xs text-[var(--red)]">{error}</p> : null}{results.length > 0 ? <ul className="absolute right-0 z-10 mt-1 w-64 border border-[var(--line)] bg-[var(--ground)] shadow-sm">{results.map((result) => <li key={result.symbol}><button onClick={() => void add(result.symbol)} className="w-full px-3 py-2 text-left text-sm hover:bg-black/5"><span className="font-medium">{result.symbol}</span><span className="ml-2 text-xs text-[var(--muted)]">{result.name}</span></button></li>)}</ul> : null}</div>;
}
