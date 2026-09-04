"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, type Quote } from "@/lib/api";

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
    return () => { cancelled = true; };
  }, []);

  const pct = nifty?.prevClose ? ((Number(nifty.price) - Number(nifty.prevClose)) / Number(nifty.prevClose)) * 100 : null;
  const up = pct !== null && pct >= 0;

  return (
    <main style={{ background: "var(--ground)", minHeight: "100vh" }}>
      <div className="sticky top-0 z-30 border-b border-[var(--line)] bg-[var(--surface)]">
        <div className="mx-auto flex h-14 max-w-[1180px] items-center gap-2.5 px-4">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: "var(--accent)" }}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2 11.5 5.5 7l3 2.5L14 4" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </span>
          <span className="text-[15px] font-semibold tracking-tight">Pulse</span>
          <button
            onClick={() => router.push("/app")}
            className="ml-auto rounded-lg px-4 py-2 text-[13px] font-semibold text-white transition-opacity hover:opacity-90"
            style={{ background: "var(--accent)" }}
          >
            Get started
          </button>
        </div>
      </div>

      {nifty ? (
        <div className="border-b border-[var(--line)] bg-[var(--surface)] px-4 py-2 text-xs">
          <div className="mx-auto flex max-w-[1180px] items-center gap-2 text-[var(--muted)]">
            <span className="font-medium">NIFTY (live)</span>
            <span className="numbers text-[var(--ink)]">{Number(nifty.price).toFixed(2)}</span>
            <span className="numbers" style={{ color: up ? "var(--green)" : "var(--red)" }}>{up ? "▲" : "▼"} {pct !== null ? `${Math.abs(pct).toFixed(2)}%` : ""}</span>
          </div>
        </div>
      ) : null}

      <div className="mx-auto max-w-[1180px] px-4 pb-24 pt-20 text-center">
        <h1 className="mx-auto max-w-[720px] text-[56px] font-semibold leading-[1.05] tracking-tight" style={{ color: "var(--ink)" }}>
          Pulse — market on your fingertips
        </h1>
        <p className="mx-auto mt-5 max-w-[540px] text-[16px] leading-relaxed text-[var(--muted)]">
          Not another price table. Return later to a precise, ranked answer for what deserves your attention — weighed against each stock&apos;s own normal, and its sector&apos;s.
        </p>
        <button
          onClick={() => router.push("/app")}
          className="mt-8 rounded-full px-8 py-3.5 text-[15px] font-semibold text-white transition-opacity hover:opacity-90"
          style={{ background: "var(--accent)" }}
        >
          Get started
        </button>

        <div className="mx-auto mt-20 grid max-w-[880px] grid-cols-1 gap-3 sm:grid-cols-3">
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
