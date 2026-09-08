"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { api, ApiRequestError, withRetry, type ChangesResponse, type Quote } from "@/lib/api";

// Per-symbol breakdown of the same notional paper basket InvestmentsCard
// summarizes on the watchlist page: ₹1,000 per tracked symbol, priced off
// real live quotes. This page is the "tell me more" destination for that
// card — same math, one row per stock instead of one aggregate number.
const PER_SYMBOL = 1000;

export default function PaperTradingPage() {
  const { id } = useParams<{ id: string }>();
  const [changes, setChanges] = useState<ChangesResponse>();
  const [nifty, setNifty] = useState<Quote | null>(null);
  const [error, setError] = useState<unknown>();

  useEffect(() => {
    void withRetry(() => api.changes(id)).then((res) => setChanges(res.data ?? undefined)).catch(setError);
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    api.quotes(["NIFTY"]).then((qs) => { if (!cancelled) setNifty(qs[0] ?? null); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const rows = useMemo(() => {
    if (!changes) return [];
    return changes.items
      .filter((it) => it.quote)
      .map((it) => {
        const price = Number(it.quote.price);
        const prevClose = it.quote.prevClose ? Number(it.quote.prevClose) : price;
        const oneDayReturn = prevClose ? PER_SYMBOL * ((price - prevClose) / prevClose) : 0;
        const oneDayPct = prevClose ? ((price - prevClose) / prevClose) * 100 : 0;
        const totalPct = it.change.pctSincePrev ? Number(it.change.pctSincePrev) : 0;
        const totalReturn = PER_SYMBOL * (totalPct / 100);
        return {
          symbol: it.symbol,
          name: it.name,
          price,
          invested: PER_SYMBOL,
          current: PER_SYMBOL + totalReturn,
          oneDayReturn,
          oneDayPct,
          totalReturn,
          totalPct,
        };
      })
      .sort((a, b) => b.totalPct - a.totalPct);
  }, [changes]);

  const invested = rows.length * PER_SYMBOL;
  const current = rows.reduce((sum, r) => sum + r.current, 0);
  const oneDayReturn = rows.reduce((sum, r) => sum + r.oneDayReturn, 0);
  const totalReturn = rows.reduce((sum, r) => sum + r.totalReturn, 0);
  const oneDayPct = invested ? (oneDayReturn / invested) * 100 : 0;
  const totalPct = invested ? (totalReturn / invested) * 100 : 0;
  const niftyPct = nifty?.prevClose ? ((Number(nifty.price) - Number(nifty.prevClose)) / Number(nifty.prevClose)) * 100 : null;
  const vsNifty = niftyPct !== null ? oneDayPct - niftyPct : null;

  const fmt = (n: number) => `₹${Math.abs(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

  if (error) {
    const message = error instanceof ApiRequestError ? `${error.response.error} (${error.response.code})` : "Could not load your paper portfolio.";
    return <main className="mx-auto max-w-[1000px] px-4 py-12"><Link href={`/w/${id}`} className="text-sm underline underline-offset-4 hover:text-[var(--ink)]">Back</Link><p className="mt-8 text-sm text-[var(--red)]">{message}</p></main>;
  }
  if (!changes) return <main className="mx-auto max-w-[1000px] px-4 py-12 text-sm text-[var(--muted)]">Loading paper portfolio…</main>;

  return (
    <main className="min-h-screen">
      <div className="mx-auto max-w-[1000px] px-4 pt-2 pb-12 sm:px-8">
        <div className="flex items-center gap-3">
          <Link href={`/w/${id}`} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--surface-2)] border border-[var(--line)] text-[var(--muted)] hover:text-[var(--ink)] hover:border-[var(--line-2)] transition-colors">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
          </Link>
          <h1 className="text-[26px] font-semibold tracking-tight">Paper Portfolio</h1>
          <span
            className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-[var(--amber)]"
            style={{ background: "rgba(230,160,60,.14)" }}
            title="Notional — priced off real live data, but not a real position or real money"
          >
            Paper
          </span>
        </div>
        <p className="mt-2 max-w-xl text-[13px] text-[var(--muted)] sm:ml-12">₹{PER_SYMBOL.toLocaleString("en-IN")} notional invested per tracked stock, valued at real live prices — no real broker, no real money.</p>

        {rows.length === 0 ? (
          <p className="mt-8 rounded-2xl border border-[var(--line)] p-6 text-sm text-[var(--muted)]" style={{ background: "linear-gradient(180deg, var(--surface-2), var(--surface))" }}>Nothing to show yet — add a stock to your watchlist to start a notional position.</p>
        ) : (
          <>
            <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] p-4">
                <span className="text-xs font-medium text-[var(--muted)] uppercase tracking-wide">Current</span>
                <p className="numbers m-0 mt-2 text-[22px] font-semibold tracking-tight">{fmt(current)}</p>
              </div>
              <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] p-4">
                <span className="text-xs font-medium text-[var(--muted)] uppercase tracking-wide">1D returns</span>
                <p className="numbers m-0 mt-2 text-[22px] font-semibold tracking-tight" style={{ color: oneDayReturn >= 0 ? "var(--green)" : "var(--red)" }}>
                  {oneDayReturn >= 0 ? "+" : "-"}{fmt(oneDayReturn)} ({oneDayPct >= 0 ? "+" : "-"}{Math.abs(oneDayPct).toFixed(2)}%)
                </p>
                {vsNifty !== null ? (
                  <p className="mt-1 text-[10.5px] text-[var(--muted)]">{vsNifty >= 0 ? "▲" : "▼"} {Math.abs(vsNifty).toFixed(2)}% {vsNifty >= 0 ? "ahead of" : "behind"} NIFTY</p>
                ) : null}
              </div>
              <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] p-4">
                <span className="text-xs font-medium text-[var(--muted)] uppercase tracking-wide">Total returns</span>
                <p className="numbers m-0 mt-2 text-[22px] font-semibold tracking-tight" style={{ color: totalReturn >= 0 ? "var(--green)" : "var(--red)" }}>
                  {totalReturn >= 0 ? "+" : "-"}{fmt(totalReturn)} ({totalPct >= 0 ? "+" : "-"}{Math.abs(totalPct).toFixed(2)}%)
                </p>
                <p className="mt-1 text-[10.5px] text-[var(--muted)]">Invested {fmt(invested)}</p>
              </div>
            </div>

            <div className="mt-8 rounded-2xl border border-[var(--line)] overflow-hidden" style={{ background: "linear-gradient(180deg, var(--surface-2), var(--surface))" }}>
              <div className="flex items-center px-4 py-3 border-b border-[var(--line)] bg-[var(--surface-2)]/50 text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
                <span className="flex-1">Stock</span>
                <span className="w-24 text-right">1D</span>
                <span className="w-28 text-right">Total</span>
                <span className="w-24 text-right hidden sm:inline">Value</span>
              </div>
              <ul className="divide-y divide-[var(--line)]">
                {rows.map((row) => (
                  <li key={row.symbol} className="flex flex-wrap items-center justify-between px-4 py-3 text-sm">
                    <div className="flex flex-col flex-1 min-w-0">
                      <span className="font-semibold text-[15px]">{row.symbol}</span>
                      <span className="text-xs text-[var(--muted)] truncate">{row.name}</span>
                    </div>
                    <div className="numbers w-24 text-right text-[13px] font-medium" style={{ color: row.oneDayReturn >= 0 ? "var(--green)" : "var(--red)" }}>
                      {row.oneDayPct >= 0 ? "+" : ""}{row.oneDayPct.toFixed(2)}%
                    </div>
                    <div className="numbers w-28 text-right text-[13px] font-semibold" style={{ color: row.totalReturn >= 0 ? "var(--green)" : "var(--red)" }}>
                      {row.totalReturn >= 0 ? "+" : "-"}{fmt(row.totalReturn)}
                    </div>
                    <div className="numbers w-24 text-right text-[13px] hidden sm:block">{fmt(row.current)}</div>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
