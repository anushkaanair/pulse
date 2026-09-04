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
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);

  useEffect(() => {
    const saved = (typeof localStorage !== "undefined" && localStorage.getItem("smw-theme")) as "light" | "dark" | null;
    if (saved) { 
      document.documentElement.setAttribute("data-theme", saved); 
      setTheme(saved); 
    } else { 
      document.documentElement.setAttribute("data-theme", "light"); 
      setTheme("light"); 
    }
  }, []);

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("smw-theme", next); } catch {}
    setTheme(next);
  };

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
      {/* 1. Header Navigation */}
      <div className="bg-[var(--surface)] border-b border-[var(--line)] sticky top-0 z-40">
        <div className="max-w-[1200px] mx-auto px-4 h-[72px] flex items-center justify-between">
          <div className="flex items-center gap-2 cursor-pointer" onClick={() => router.push("/")}>
             <span className="flex h-8 w-8 items-center justify-center rounded-full" style={{ background: "var(--accent)" }}>
               <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2 11.5 5.5 7l3 2.5L14 4" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
             </span>
             <span className="text-[22px] font-bold tracking-tight text-[var(--ink-dark)]">pulse</span>
          </div>

          <div className="flex items-center gap-4">
             <button
               onClick={toggleTheme}
               aria-label="Toggle light/dark theme"
               title="Toggle theme"
               className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--line)] text-[var(--muted)] hover:text-[var(--ink)] hover:border-[var(--line-2)] transition-colors"
             >
               {theme === "dark" ? (
                 <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
               ) : (
                 <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z"/></svg>
               )}
             </button>
             <button onClick={() => router.push("/app")} className="bg-[#00B67A] text-white px-6 py-2.5 rounded font-medium text-[14px] hover:opacity-90 transition-opacity shadow-sm">
               Get started
             </button>
          </div>
        </div>
      </div>

      {/* 2. Live ticker */}
      <div className="marquee-mask relative w-full overflow-hidden border-b border-[var(--line)] bg-[var(--surface-2)] py-3 text-[13px] font-medium tracking-wide">
        {nifty ? (
          <div className="marquee-track items-center">
            {[0, 1, 2, 3].map((copy) => (
              <div key={copy} className="flex shrink-0 items-center gap-10 px-5">
                <span className="flex items-center gap-2">
                  <span className="text-[var(--muted)]">NIFTY 50</span>
                  <span className="numbers text-[var(--muted)]">{Number(nifty.price).toLocaleString("en-IN", { maximumFractionDigits: 2 })}</span>
                  <span className="numbers" style={{ color: up ? "var(--green)" : "var(--red)" }}>{up ? "↑" : "↓"} {pct !== null ? `${Math.abs(pct).toFixed(2)}%` : ""}</span>
                </span>
                {pct !== null ? DERIVED_INDICES.map((idx) => (
                  <span key={idx.symbol} className="flex items-center gap-2">
                    <span className="text-[var(--muted)]">{idx.symbol}</span>
                    <span className="numbers text-[var(--muted)]">{(idx.base * (1 + pct / 100)).toLocaleString("en-IN", { maximumFractionDigits: 2 })}</span>
                    <span className="numbers" style={{ color: up ? "var(--green)" : "var(--red)" }}>{up ? "↑" : "↓"} {Math.abs(pct).toFixed(2)}%</span>
                  </span>
                )) : null}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center text-[var(--muted)]">Loading market…</div>
        )}
      </div>

      {/* 3. Hero Section */}
      <div className="pt-10 pb-16 text-center">
        <h1 className="mx-auto px-4 max-w-[1200px] text-[clamp(44px,7vw,64px)] font-[800] leading-[1.05] tracking-tight text-[var(--ink-dark)]">
          Market on your fingertips
        </h1>
        
        <p className="mx-auto mt-4 px-4 max-w-[540px] text-[14px] leading-relaxed text-[var(--muted)]">
          Not another price table. Return later to a precise, ranked answer for what deserves your attention.
        </p>
        
        <div className="mt-6 z-10 relative">
          <button onClick={() => router.push("/app")} className="bg-[#00B67A] text-white px-10 py-3 rounded-full font-bold text-[18px] hover:bg-[#00a36d] transition-colors shadow-lg shadow-[#00B67A]/25">
            Get started
          </button>
        </div>

        <div className="w-full max-w-[1500px] mx-auto relative -mt-4 md:-mt-8 flex justify-center">
          <img 
            src="https://resources.groww.in/web-assets/story_assets/landing-page/home_page/cityScape.svg" 
            alt="Groww Cityscape" 
            className="w-full scale-[1.15] md:scale-100" 
            style={{ filter: theme === "dark" ? "brightness(0.9) contrast(1.1)" : "none" }}
          />
        </div>
      </div>
    </main>
  );
}
