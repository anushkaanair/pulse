"use client";

import { useState } from "react";

const STEPS = [
  { title: "Homepage", text: "This is Pulse — no login, one button." },
  { title: "Get started", text: "Straight into your watchlist. No setup screen." },
  { title: "Market rail", text: "Live NIFTY + your tracked stocks — nothing here is a static mockup." },
  { title: "Attention deck", text: "This card stack is ranked, not sorted — closest to you deserves the most attention." },
  { title: "Compact cards", text: "Compact by default. Click to open the why." },
  { title: "Expanded card", text: "Plain language first, the σ math is one tap away for anyone who wants it." },
  { title: "All tracked stocks", text: "Every stock, always visible — the deck triages, it doesn't hide." },
  { title: "Stale badge", text: "If data's late, it says so. It never pretends to be fresh." },
  { title: "Investments card", text: "Paper trading, clearly marked — real prices, zero real money." },
  { title: "/dev/faults", text: "And this — I can break my own feed live, on demand, to prove the honesty claim." },
];

export function DemoTutorial() {
  const [step, setStep] = useState(0);
  const [visible, setVisible] = useState(true); // Start visible for the demo

  if (!visible) {
    return (
      <button 
        onClick={() => setVisible(true)}
        className="fixed bottom-4 left-4 z-50 bg-[var(--surface)] border border-[var(--line)] px-3 py-1.5 rounded-full text-[12px] font-medium text-[var(--muted)] hover:text-[var(--ink)] shadow-sm opacity-50 hover:opacity-100 transition-opacity"
      >
        Show Script
      </button>
    );
  }

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2 w-full max-w-[360px]">
      <div className="bg-[var(--surface)] border border-[var(--line)] shadow-[0_12px_40px_rgb(0,0,0,0.12)] rounded-2xl overflow-hidden backdrop-blur-xl">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--line)] bg-[var(--surface-2)]">
          <span className="text-[11px] font-bold tracking-wider text-[var(--muted)] uppercase">Demo Script • Step {step + 1} of {STEPS.length}</span>
          <button onClick={() => setVisible(false)} className="text-[var(--muted)] hover:text-[var(--ink)]" title="Hide">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
        
        <div className="p-5">
          <h3 className="font-semibold text-[var(--ink)] mb-1.5">{STEPS[step].title}</h3>
          <p className="text-[14px] leading-relaxed text-[var(--muted)]">{STEPS[step].text}</p>
        </div>
        
        <div className="flex items-center justify-between px-4 py-3 bg-[var(--surface-2)] border-t border-[var(--line)]">
          <button 
            onClick={() => setStep(s => Math.max(0, s - 1))}
            disabled={step === 0}
            className="text-[13px] font-medium text-[var(--muted)] hover:text-[var(--ink)] disabled:opacity-30 transition-colors"
          >
            Previous
          </button>
          
          <button 
            onClick={() => setStep(s => Math.min(STEPS.length - 1, s + 1))}
            disabled={step === STEPS.length - 1}
            className="bg-[var(--accent)] text-white px-4 py-1.5 rounded-lg text-[13px] font-semibold hover:opacity-90 disabled:opacity-50 transition-colors"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
