"use client";

import { useEffect, useState } from "react";
import { api, type ChangeItem, type Quote } from "@/lib/api";

// A Groww-style live market rail for the top of the page. We only ever
// simulate one real index feed — NIFTY, the market proxy every symbol's
// beta is measured against — so the other four benchmark indices shown
// here are derived from that same real tick rather than invented:
// same-day % move as the real NIFTY (indices trade highly correlated in
// practice), scaled onto each index's real-world typical level. Not an
// independent feed, but not a random number either — it moves because the
// market actually moved.
const DERIVED_INDICES: { symbol: string; base: number }[] = [
  { symbol: "SENSEX", base: 72000 },
  { symbol: "BANKNIFTY", base: 48000 },
  { symbol: "MIDCPNIFTY", base: 12500 },
  { symbol: "FINNIFTY", base: 21000 },
];
function dayPct(q: Quote | null | undefined): number | null {
  if (!q || !q.prevClose) return null;
  const prev = Number(q.prevClose);
  if (!prev) return null;
  return ((Number(q.price) - prev) / prev) * 100;
}

function Move({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="numbers text-[var(--muted)]">—</span>;
  const up = pct >= 0;
  return (
    <span className="numbers" style={{ color: up ? "var(--green)" : "var(--red)" }}>
      {up ? "▲" : "▼"} {Math.abs(pct).toFixed(2)}%
    </span>
  );
}

export function MarketRail({ items = [] }: { items?: ChangeItem[] }) {
  const [nifty, setNifty] = useState<Quote | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => api.quotes(["NIFTY"]).then((qs) => { if (!cancelled) setNifty(qs[0] ?? null); }).catch(() => {});
    void load();
    const t = setInterval(load, 15_000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  const tape = items.filter((i) => i.quote).slice(0, 24);
  const niftyPct = dayPct(nifty);

  return (
    <div className="flex items-stretch border-b border-[var(--line)] bg-[var(--surface)] text-[12px]">
      {/* Real index + derived benchmark indices, all moving off the same real tick */}
      <div className="hide-scrollbar flex shrink-0 items-center gap-4 overflow-x-auto border-r border-[var(--line)] px-4 py-2">
        <span className="flex items-center gap-2">
          <span className="dot-live h-1.5 w-1.5 rounded-full" style={{ color: "var(--green)", background: "var(--green)" }} />
          <span className="font-semibold tracking-tight">NIFTY</span>
          <span className="numbers text-[var(--ink)]">{nifty ? Number(nifty.price).toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "…"}</span>
          <Move pct={niftyPct} />
        </span>
        {niftyPct !== null ? DERIVED_INDICES.map((idx) => (
          <span key={idx.symbol} className="flex items-center gap-1.5 border-l border-[var(--line)] pl-4">
            <span className="font-medium text-[var(--ink-2)]">{idx.symbol}</span>
            <span className="numbers text-[var(--muted)]">{(idx.base * (1 + niftyPct / 100)).toLocaleString("en-IN", { maximumFractionDigits: 2 })}</span>
            <Move pct={niftyPct} />
          </span>
        )) : null}
      </div>

      {/* Live ticker-tape of the symbols actually tracked here */}
      <div className="marquee-mask relative min-w-0 flex-1 overflow-hidden py-2">
        {tape.length > 0 ? (
          <div className="marquee-track">
            {[...tape, ...tape].map((it, idx) => (
              <span key={`${it.symbol}-${idx}`} className="mx-4 inline-flex items-center gap-1.5">
                <span className="font-medium text-[var(--ink-2)]">{it.symbol}</span>
                <span className="numbers text-[var(--muted)]">₹{Number(it.quote!.price).toFixed(2)}</span>
                <Move pct={dayPct(it.quote)} />
              </span>
            ))}
          </div>
        ) : (
          <span className="px-4 text-[var(--muted)]">No stocks tracked yet — add a few to see them live here.</span>
        )}
        <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-12" style={{ background: "linear-gradient(to right, transparent, var(--surface))" }} />
      </div>
    </div>
  );
}
