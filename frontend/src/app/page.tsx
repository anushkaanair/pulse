"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { HeroIllustration } from "@/components/HeroIllustration";
import { api, type Quote } from "@/lib/api";

const DERIVED_INDICES: { symbol: string; base: number }[] = [
  { symbol: "SENSEX", base: 72000 },
  { symbol: "BANKNIFTY", base: 48000 },
  { symbol: "MIDCPNIFTY", base: 12500 },
  { symbol: "FINNIFTY", base: 21000 },
];

// Public landing page — no auth, one CTA. Structurally close to a real
// broker homepage (sticky nav, live ticker strip, big headline, single
// action) but the ticker pulls the real simulated NIFTY quote through the
// same API the rest of the app uses — never a decorative fake number,
// which is this project's own thesis (see RESILIENCE.md).
export default function LandingPage() {
  const router = useRouter();
  const [nifty, setNifty] = useState<Quote | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.quotes(["NIFTY"]).then((qs) => { if (!cancelled) setNifty(qs[0] ?? null); }).catch(() => {});
    // Marks that this browser tab has actually seen the homepage — /app
    // checks this and bounces straight back here if it's missing, so a
    // direct/bookmarked link to /app can't skip the intro. Session-scoped
    // on purpose: once you've been through it this tab, later /app visits
    // (refresh, back button) go straight to the dashboard as expected.
    try { sessionStorage.setItem("pulse-entered", "1"); } catch { /* private mode etc. */ }
    return () => { cancelled = true; };
  }, []);

  const pct = nifty?.prevClose ? ((Number(nifty.price) - Number(nifty.prevClose)) / Number(nifty.prevClose)) * 100 : null;
  const up = pct !== null && pct >= 0;

  return (
    <main style={{ background: "var(--ground)", minHeight: "100vh" }}>
      {/* Live ticker — real NIFTY, plus the same market-correlated derived
          indices used on the dashboard rail (see MarketRail.tsx). No auth,
          no nav — this bar plus the hero below is the entire homescreen. */}
      <div className="hide-scrollbar sticky top-0 z-30 flex items-center gap-5 overflow-x-auto border-b border-[var(--line)] bg-[var(--surface)] px-4 py-2 text-[12px]">
        {nifty ? (
          <span className="flex shrink-0 items-center gap-1.5">
            <span className="dot-live h-1.5 w-1.5 rounded-full" style={{ color: "var(--green)", background: "var(--green)" }} />
            <span className="font-semibold">NIFTY 50</span>
            <span className="numbers text-[var(--ink)]">{Number(nifty.price).toLocaleString("en-IN", { maximumFractionDigits: 2 })}</span>
            <span className="numbers" style={{ color: up ? "var(--green)" : "var(--red)" }}>{up ? "▲" : "▼"} {pct !== null ? `${Math.abs(pct).toFixed(2)}%` : ""}</span>
          </span>
        ) : <span className="text-[var(--muted)]">Loading market…</span>}
        {pct !== null ? DERIVED_INDICES.map((idx) => (
          <span key={idx.symbol} className="flex shrink-0 items-center gap-1.5 border-l border-[var(--line)] pl-5">
            <span className="font-medium text-[var(--ink-2)]">{idx.symbol}</span>
            <span className="numbers text-[var(--muted)]">{(idx.base * (1 + pct / 100)).toLocaleString("en-IN", { maximumFractionDigits: 0 })}</span>
            <span className="numbers" style={{ color: up ? "var(--green)" : "var(--red)" }}>{up ? "▲" : "▼"} {Math.abs(pct).toFixed(2)}%</span>
          </span>
        )) : null}
      </div>

      <div className="mx-auto max-w-[1180px] px-4 pb-16 pt-14 text-center">
        <span className="flex h-11 w-11 mx-auto items-center justify-center rounded-2xl" style={{ background: "var(--accent)" }}>
          <svg width="20" height="20" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2 11.5 5.5 7l3 2.5L14 4" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </span>
        <h1 className="mx-auto mt-4 text-[clamp(40px,9vw,64px)] font-extrabold leading-[1.05] tracking-tight" style={{ color: "var(--ink)" }}>
          Pulse
        </h1>
        <p className="mx-auto mt-1.5 text-[clamp(17px,3.4vw,24px)] font-semibold tracking-tight" style={{ color: "var(--accent)" }}>
          Market on your fingertips
        </p>
        <p className="mx-auto mt-4 max-w-[540px] text-[15px] leading-relaxed text-[var(--muted)]">
          Not another price table. Return later to a precise, ranked answer for what deserves your attention — weighed against each stock&apos;s own normal, and its sector&apos;s.
        </p>
        <button
          onClick={() => router.push("/app")}
          className="mt-7 rounded-full px-8 py-3.5 text-[15px] font-semibold text-white transition-opacity hover:opacity-90"
          style={{ background: "var(--accent)" }}
        >
          Get started
        </button>

        <div className="mt-14">
          <HeroIllustration />
        </div>

        <div className="mx-auto mt-14 grid max-w-[880px] grid-cols-1 gap-3 sm:grid-cols-3">
          {[
            ["Sector-adjusted", "A move is only news once what its sector did is subtracted out."],
            ["Never silent", "A correction to something already shown is a visible retraction — not a delete."],
            ["Ranked, not flooded", "An attention budget means a volatile day is a triage, not a wall of cards."],
          ].map(([t, d]) => (
            <div key={t} className="rounded-2xl border border-[var(--line)] p-5 text-left" style={{ background: "var(--surface-2)" }}>
              <p className="m-0 text-[13.5px] font-semibold" style={{ color: "var(--accent)" }}>{t}</p>
              <p className="mt-1.5 mb-0 text-[12.5px] leading-relaxed text-[var(--muted)]">{d}</p>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
