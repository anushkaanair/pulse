"use client";

import { useEffect, useState } from "react";
import { api, type ChangeItem, type Quote } from "@/lib/api";

// A Groww-style "Your investments" card. There's no brokerage/holdings
// concept in this app (no buy orders, no cost basis), so rather than draw
// a fake portfolio, this treats the watchlist itself as a notional equal-
// weight basket: ₹1,000 invested per tracked symbol, valued at real live
// prices. 1D return uses each quote's real prevClose; total return uses
// the real pctSincePrev computed against your saved baseline. Every number
// on the card is arithmetic over real simulated prices — the same
// commitment as the rest of the app, just applied to a demo holdings view.
const PER_SYMBOL = 1000;

export function InvestmentsCard({ items }: { items: ChangeItem[] }) {
  const [nifty, setNifty] = useState<Quote | null>(null);
  useEffect(() => {
    let cancelled = false;
    api.quotes(["NIFTY"]).then((qs) => { if (!cancelled) setNifty(qs[0] ?? null); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const tracked = items.filter((i) => i.quote);
  if (tracked.length === 0) return null;

  const invested = tracked.length * PER_SYMBOL;

  const oneDayReturn = tracked.reduce((sum, it) => {
    const price = Number(it.quote!.price);
    const prevClose = it.quote!.prevClose ? Number(it.quote!.prevClose) : price;
    return sum + (prevClose ? PER_SYMBOL * ((price - prevClose) / prevClose) : 0);
  }, 0);
  const totalReturn = tracked.reduce((sum, it) => {
    const pct = it.change.pctSincePrev ? Number(it.change.pctSincePrev) / 100 : 0;
    return sum + PER_SYMBOL * pct;
  }, 0);
  const current = invested + totalReturn;
  const oneDayPct = invested ? (oneDayReturn / invested) * 100 : 0;
  const totalPct = invested ? (totalReturn / invested) * 100 : 0;

  // Benchmark context: a flat 1D return means nothing on its own — beating
  // or lagging the real live NIFTY move over the same day is what actually
  // says whether the basket did anything.
  const niftyPct = nifty?.prevClose ? ((Number(nifty.price) - Number(nifty.prevClose)) / Number(nifty.prevClose)) * 100 : null;
  const vsNifty = niftyPct !== null ? oneDayPct - niftyPct : null;

  const fmt = (n: number) => `₹${Math.abs(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

  return (
    // Dashed border + a persistent "Paper" badge (not just a caption line)
    // so this can never read as a real holdings widget at a glance — the
    // exact ambiguity that gets flagged in a real fintech compliance
    // review. Distinct border style, not just color, so it still reads
    // right for colorblind users.
    <div className="rounded-2xl border border-dashed border-[var(--amber)]/40 p-5" style={{ background: "linear-gradient(180deg, var(--surface-2), var(--surface))" }}>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="m-0 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Your investments</h3>
        <span
          className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-[var(--amber)]"
          style={{ background: "rgba(230,160,60,.14)" }}
          title="Notional — priced off real live data, but not a real position or real money"
        >
          <svg width="9" height="9" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 1.5h6l2.5 2.5V14a.5.5 0 0 1-.5.5H4A.5.5 0 0 1 3.5 14V2a.5.5 0 0 1 .5-.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /><path d="M6 8h4M6 10.5h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
          Paper
        </span>
      </div>
      <p className="m-0 text-[11px] text-[var(--muted)]">Current</p>
      <p className="numbers m-0 mt-1 text-[26px] font-semibold tracking-tight">{fmt(current)}</p>

      <div className="mt-4 flex items-center justify-between text-[13px]">
        <span className="text-[var(--muted)]">1D returns</span>
        <span className="numbers font-semibold" style={{ color: oneDayReturn >= 0 ? "var(--green)" : "var(--red)" }}>
          {oneDayReturn >= 0 ? "+" : "-"}{fmt(oneDayReturn)} ({oneDayPct >= 0 ? "+" : "-"}{Math.abs(oneDayPct).toFixed(2)}%)
        </span>
      </div>
      {vsNifty !== null ? (
        <div className="mt-0.5 flex items-center justify-end text-[10.5px]">
          <span className="text-[var(--muted)]" title={`Your 1D return minus NIFTY's own 1D move (${niftyPct! >= 0 ? "+" : ""}${niftyPct!.toFixed(2)}%)`}>
            {vsNifty >= 0 ? "▲" : "▼"} {Math.abs(vsNifty).toFixed(2)}% {vsNifty >= 0 ? "ahead of" : "behind"} NIFTY
          </span>
        </div>
      ) : null}
      <div className="mt-2 flex items-center justify-between border-t border-[var(--line)] pt-2 text-[13px]">
        <span className="text-[var(--muted)]">Total returns</span>
        <span className="numbers font-semibold" style={{ color: totalReturn >= 0 ? "var(--green)" : "var(--red)" }}>
          {totalReturn >= 0 ? "+" : "-"}{fmt(totalReturn)} ({totalPct >= 0 ? "+" : "-"}{Math.abs(totalPct).toFixed(2)}%)
        </span>
      </div>
      <div className="mt-2 flex items-center justify-between border-t border-[var(--line)] pt-2 text-[13px]">
        <span className="text-[var(--muted)]">Invested</span>
        <span className="numbers font-medium">{fmt(invested)}</span>
      </div>
      <p className="mt-3 mb-0 text-[10px] leading-relaxed text-[var(--muted)]">₹{PER_SYMBOL.toLocaleString("en-IN")} notional per tracked stock, priced live.</p>
    </div>
  );
}
