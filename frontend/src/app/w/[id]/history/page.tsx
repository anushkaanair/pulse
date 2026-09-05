"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState, useMemo } from "react";
import { api, ApiRequestError, withRetry, type TimelineDiffItem, type TimelineDiffResponse, type TimelineVisit } from "@/lib/api";

export default function HistoryPage() {
  const { id } = useParams<{ id: string }>();
  const [visits, setVisits] = useState<TimelineVisit[]>();
  const [selected, setSelected] = useState<string>();
  const [diff, setDiff] = useState<TimelineDiffResponse>();
  const [error, setError] = useState<unknown>();
  
  const [sortConfig, setSortConfig] = useState<{ key: "symbol" | "pct", dir: "asc" | "desc" }>({ key: "symbol", dir: "asc" });
  const [searchQuery, setSearchQuery] = useState("");
  const [perfFilter, setPerfFilter] = useState("All");
  const [assetFilter, setAssetFilter] = useState("All");
  const [sectorFilter, setSectorFilter] = useState("All");
  
  useEffect(() => {
    // Retry the first read so a transient blip doesn't dead-end the page.
    void withRetry(() => api.timeline(id)).then((response) => {
      setVisits(response.visits);
      if (response.visits.length) setSelected(response.visits[0].snapshotId);
    }).catch(setError);
  }, [id]);

  useEffect(() => {
    if (!selected) return;
    void withRetry(() => api.timelineDiff(id, selected)).then(setDiff).catch(setError);
  }, [id, selected]);

  const formattedVisits = useMemo(() => {
    if (!visits) return [];
    const hasOld = visits.some(v => Date.now() - new Date(v.takenAt).getTime() >= 24 * 3600 * 1000);
    return visits.map(v => {
      if (hasOld) {
        return { ...v, label: new Date(v.takenAt).toLocaleDateString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) };
      } else {
        const ms = Date.now() - new Date(v.takenAt).getTime();
        const m = Math.floor(ms / 60_000);
        const s = Math.floor((ms % 60_000) / 1000);
        if (m < 1) return { ...v, label: `${s}s ago` };
        if (m < 60) return { ...v, label: `${m}m ${s}s ago` };
        return { ...v, label: `${Math.floor(m / 60)}h ${m % 60}m ago` };
      }
    });
  }, [visits]);

  const { topPerformer, bottomPerformer, avgDelta, sortedItems } = useMemo<{
    topPerformer: TimelineDiffItem | null;
    bottomPerformer: TimelineDiffItem | null;
    avgDelta: number;
    sortedItems: (TimelineDiffItem & { numPct: number | null })[];
  }>(() => {
    if (!diff) return { topPerformer: null, bottomPerformer: null, avgDelta: 0, sortedItems: [] };
    
    let totalPct = 0;
    let count = 0;
    let top: TimelineDiffItem | null = null;
    let bottom: TimelineDiffItem | null = null;
    let maxPct = -Infinity;
    let minPct = Infinity;
    
    const items = diff.items.map(item => {
      const val = (item.pct && item.status !== "removed" && item.status !== "added") ? parseFloat(item.pct) : null;
      if (val !== null && !isNaN(val)) {
        totalPct += val;
        count++;
        if (val > maxPct) { maxPct = val; top = item; }
        if (val < minPct) { minPct = val; bottom = item; }
      }
      return { ...item, numPct: val };
    });
    
    const filteredItems = items.filter(item => {
      if (searchQuery && !item.symbol.toLowerCase().includes(searchQuery.toLowerCase()) && !item.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      if (perfFilter === "Gainers" && (item.numPct ?? 0) <= 0) return false;
      if (perfFilter === "Losers" && (item.numPct ?? 0) >= 0) return false;
      if (perfFilter === "Flat" && (item.numPct ?? 0) !== 0) return false;
      return true;
    });
    
    filteredItems.sort((a, b) => {
      if (sortConfig.key === "symbol") {
        return sortConfig.dir === "asc" ? a.symbol.localeCompare(b.symbol) : b.symbol.localeCompare(a.symbol);
      } else {
        const valA = a.numPct ?? 0;
        const valB = b.numPct ?? 0;
        return sortConfig.dir === "asc" ? valA - valB : valB - valA;
      }
    });

    return { 
      topPerformer: maxPct !== -Infinity ? top : null, 
      bottomPerformer: minPct !== Infinity ? bottom : null, 
      avgDelta: count > 0 ? totalPct / count : 0,
      sortedItems: filteredItems
    };
  }, [diff, sortConfig]);

  if (error) {
    const message = error instanceof ApiRequestError ? `${error.response.error} (${error.response.code})` : "Could not load history.";
    return <main className="mx-auto max-w-[1000px] px-4 py-12"><Link href={`/w/${id}`} className="text-sm underline underline-offset-4 hover:text-[var(--ink)]">Back</Link><p className="mt-8 text-sm text-[var(--red)]">{message}</p></main>;
  }
  if (!visits) return <main className="mx-auto max-w-[1000px] px-4 py-12 text-sm text-[var(--muted)]">Loading history…</main>;

  return (
    <main className="min-h-screen">
      <div className="mx-auto max-w-[1200px] px-4 pt-2 pb-8 sm:px-8">
        <div className="flex items-center gap-3">
          <Link href={`/w/${id}`} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--surface-2)] border border-[var(--line)] text-[var(--muted)] hover:text-[var(--ink)] hover:border-[var(--line-2)] transition-colors">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
          </Link>
          <h1 className="text-[26px] font-semibold tracking-tight">Watchlist History</h1>
        </div>
        <p className="mt-2 max-w-xl text-[13px] text-[var(--muted)] sm:ml-12">A plain comparison between two of your past visits — not a significance judgment, just what the price was and what it became.</p>

        {visits.length === 0 ? (
          <p className="mt-8 rounded-2xl border border-[var(--line)] p-6 text-sm text-[var(--muted)]" style={{ background: "linear-gradient(180deg, var(--surface-2), var(--surface))" }}>No visits recorded yet — this fills in once you&apos;ve marked the watchlist as seen more than once.</p>
        ) : (
          <div className="mt-8 grid gap-8 md:grid-cols-[220px_1fr]">
            <ul className="space-y-1.5 list-none p-0 sticky top-24 self-start">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)] mb-3 px-1">Compare right now vs:</h3>
              {formattedVisits.map((visit) => (
                <li key={visit.snapshotId}>
                  <button
                    onClick={() => setSelected(visit.snapshotId)}
                    className="w-full rounded-xl border px-3.5 py-2.5 text-left text-sm transition-all"
                    style={selected === visit.snapshotId ? { borderColor: "var(--amber)", color: "var(--ink)", background: "var(--amber)/10" } : { borderColor: "transparent", color: "var(--muted)", background: "var(--surface-2)" }}
                  >
                    {visit.label}
                  </button>
                </li>
              ))}
            </ul>

            <div className="min-w-0">
              {!diff ? (
                <p className="text-sm text-[var(--muted)]">Loading comparison…</p>
              ) : diff.items.length === 0 ? (
                <p className="text-sm text-[var(--muted)]">Nothing to compare — this was your first visit.</p>
              ) : (
                <>
                  <p className="text-sm font-medium text-[var(--ink-2)] mb-4">
                    {diff.comparedTo ? `Performance since ${formattedVisits.find(v => v.snapshotId === selected)?.label || "your past visit"}` : "Your first visit — no earlier comparison."}
                  </p>
                  
                  {/* Summary Cards */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                     <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] p-4 flex flex-col justify-between">
                        <span className="text-xs font-medium text-[var(--muted)] uppercase tracking-wide">Top Performer</span>
                        {topPerformer ? (
                          <div className="mt-3 flex items-end justify-between">
                            <span className="font-semibold text-base">{topPerformer.symbol}</span>
                            <span className="text-[var(--green)] font-semibold text-base">+{topPerformer.pct}%</span>
                          </div>
                        ) : <span className="mt-3 text-sm text-[var(--muted)]">—</span>}
                     </div>
                     <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] p-4 flex flex-col justify-between">
                        <span className="text-xs font-medium text-[var(--muted)] uppercase tracking-wide">Bottom Performer</span>
                        {bottomPerformer ? (
                          <div className="mt-3 flex items-end justify-between">
                            <span className="font-semibold text-base">{bottomPerformer.symbol}</span>
                            <span className="text-[var(--red)] font-semibold text-base">{bottomPerformer.pct}%</span>
                          </div>
                        ) : <span className="mt-3 text-sm text-[var(--muted)]">—</span>}
                     </div>
                     <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] p-4 flex flex-col justify-between">
                        <span className="text-xs font-medium text-[var(--muted)] uppercase tracking-wide">Avg Watchlist Delta</span>
                        <div className="mt-3 flex items-end justify-between">
                           <span className="font-semibold text-base" style={{ color: avgDelta >= 0 ? "var(--green)" : "var(--red)" }}>
                             {avgDelta >= 0 ? "+" : ""}{avgDelta.toFixed(2)}%
                           </span>
                           {/* Tiny mock sparkline */}
                           <div className="flex items-end h-4 gap-[2px] opacity-60">
                             {[0.2, 0.4, 0.3, 0.6, 0.5, 0.8, 0.7, 1].map((h, i) => (
                               <div key={i} className="w-1 rounded-sm" style={{ height: `${h * 100}%`, background: avgDelta >= 0 ? "var(--green)" : "var(--red)" }} />
                             ))}
                           </div>
                        </div>
                     </div>
                  </div>

                  {/* Filter Bar */}
                  <div className="flex flex-nowrap items-end gap-3 mb-6 text-[12px] overflow-x-auto hide-scrollbar pb-2">
                    <div className="flex flex-col gap-1.5 shrink-0">
                      <span className="font-semibold text-[var(--ink)] tracking-tight">Filter by Asset</span>
                      <select className="h-8 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-2 outline-none font-medium text-[var(--muted)]" value={assetFilter} onChange={e => setAssetFilter(e.target.value)}>
                        <option value="All">All Assets</option>
                        <option value="Equity">Equity</option>
                        <option value="ETF">ETF</option>
                        <option value="Option">Option</option>
                      </select>
                    </div>
                    <div className="flex flex-col gap-1.5 shrink-0">
                      <span className="font-semibold text-[var(--ink)] tracking-tight">Filter by Sector</span>
                      <select className="h-8 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-2 outline-none font-medium text-[var(--muted)]" value={sectorFilter} onChange={e => setSectorFilter(e.target.value)}>
                        <option value="All">All Sectors</option>
                        <option value="IT">IT</option>
                        <option value="Finance">Finance</option>
                        <option value="Consumer">Consumer</option>
                        <option value="Energy">Energy</option>
                      </select>
                    </div>
                    <div className="flex flex-col gap-1.5 shrink-0">
                      <span className="font-semibold text-[var(--ink)] tracking-tight">Filter by Performance</span>
                      <div className="flex items-center h-8 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] overflow-hidden p-0.5">
                        {["All", "Gainers", "Losers", "Flat"].map(opt => (
                          <button key={opt} onClick={() => setPerfFilter(opt)} className={`px-3 py-1 rounded transition-colors ${perfFilter === opt ? "bg-[var(--line-2)] text-[var(--ink)] font-semibold shadow-sm" : "text-[var(--muted)] font-medium hover:text-[var(--ink)]"}`}>
                            {opt}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="flex flex-col gap-1.5 shrink-0 w-[200px]">
                      <span className="font-semibold text-[var(--ink)] tracking-tight opacity-0 hidden sm:block">Search</span>
                      <input type="text" placeholder="Search Stocks in History..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="h-8 w-full rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 outline-none font-medium placeholder:text-[var(--muted)]" />
                    </div>
                    <div className="flex flex-col gap-1.5 shrink-0">
                      <span className="font-semibold text-[var(--ink)] tracking-tight">Sort By</span>
                      <select className="h-8 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-2 outline-none font-medium text-[var(--muted)]" value={`${sortConfig.key}-${sortConfig.dir}`} onChange={e => {
                        const [k, d] = e.target.value.split("-");
                        setSortConfig({ key: k as any, dir: d as any });
                      }}>
                        <option value="symbol-asc">Ticker (A-Z)</option>
                        <option value="symbol-desc">Ticker (Z-A)</option>
                        <option value="pct-desc">% Change (High-Low)</option>
                        <option value="pct-asc">% Change (Low-High)</option>
                      </select>
                    </div>
                    <div className="flex flex-col gap-1.5 shrink-0 hidden lg:flex">
                      <span className="font-semibold text-[var(--ink)] tracking-tight">Comparison Point</span>
                      <select className="h-8 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-2 outline-none font-medium text-[var(--muted)]" value={selected || ""} onChange={e => setSelected(e.target.value)}>
                        {formattedVisits.map(v => (
                          <option key={v.snapshotId} value={v.snapshotId}>{v.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-[var(--line)] overflow-hidden" style={{ background: "linear-gradient(180deg, var(--surface-2), var(--surface))" }}>
                    <div className="flex items-center px-4 py-3 border-b border-[var(--line)] bg-[var(--surface-2)]/50 text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
                      <button 
                        onClick={() => setSortConfig(s => ({ key: "symbol", dir: s.key === "symbol" && s.dir === "asc" ? "desc" : "asc" }))}
                        className="flex-1 text-left flex items-center gap-1 hover:text-[var(--ink)] transition-colors"
                      >
                        Ticker {sortConfig.key === "symbol" && (sortConfig.dir === "asc" ? "↑" : "↓")}
                      </button>
                      <button 
                        onClick={() => setSortConfig(s => ({ key: "pct", dir: s.key === "pct" && s.dir === "desc" ? "asc" : "desc" }))}
                        className="w-24 text-right flex items-center justify-end gap-1 hover:text-[var(--ink)] transition-colors"
                      >
                        % Change {sortConfig.key === "pct" && (sortConfig.dir === "asc" ? "↑" : "↓")}
                      </button>
                    </div>
                    <ul className="divide-y divide-[var(--line)]">
                      {sortedItems.map((row) => (
                        <li key={row.symbol} className="flex flex-col">
                          <div className="flex flex-wrap items-center justify-between px-4 py-3 text-sm">
                            <div className="flex flex-col">
                              <span className="font-semibold text-[15px]">{row.symbol}</span>
                              <span className="text-xs text-[var(--muted)] hidden sm:inline">{row.name}</span>
                            </div>
                            
                            {row.status === "added" ? (
                              <div className="w-24 text-right"><span className="rounded-full border border-[var(--line-2)] bg-[var(--surface-3)] px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--muted)]">+ added</span></div>
                            ) : row.status === "removed" ? (
                              <div className="w-24 text-right"><span className="rounded-full border border-[var(--line-2)] bg-[var(--surface-3)] px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--muted)]">− removed</span></div>
                            ) : (
                              <div className="numbers flex flex-col items-end w-24">
                                {row.pct ? <span className="font-semibold text-[15px]" style={{ color: row.pct.startsWith("-") ? "var(--red)" : "var(--green)" }}>{row.pct.startsWith("-") ? "" : "+"}{row.pct}%</span> : <span className="text-[var(--muted)]">—</span>}
                                <span className="text-xs text-[var(--muted)] mt-0.5">{row.priceBefore} → {row.priceAfter}</span>
                              </div>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
