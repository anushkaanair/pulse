"use client";

import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";
import { useParams, usePathname, useRouter } from "next/navigation";

type Page = "watchlist" | "history" | "paper";

interface Step {
  page: Page;
  selector: string;
  title: string;
  text: string;
}

// Cross-page, element-anchored walkthrough. Unlike the old DemoTutorial
// (unused, commented out in layout.tsx — guessed fixed pixel positions,
// never actually pointed at a real element), this locates the real DOM
// node via `[data-tour="..."]`, positions the tooltip next to it, and
// follows the user across /w/[id] → /history → /paper and back, since
// "walk them through the history page and the paper trading page" only
// makes sense if the tour actually goes there.
const STEPS: Step[] = [
  {
    page: "watchlist",
    selector: '[data-tour="history-link"]',
    title: "Visit history",
    text: "Compare right now against any of your past visits — top/bottom performer, average delta, per-stock % change. Let's take a look.",
  },
  {
    page: "history",
    selector: '[data-tour="history-filters"]',
    title: "Filter & search",
    text: "Narrow the comparison to Gainers, Losers, or Flat, search a symbol, or re-sort by ticker or % change — all instant, no reload.",
  },
  {
    page: "history",
    selector: '[data-tour="history-summary"]',
    title: "At a glance",
    text: "Top performer, bottom performer, and your average watchlist delta since whichever past visit you pick on the left.",
  },
  {
    page: "paper",
    selector: '[data-tour="paper-summary"]',
    title: "Paper trading",
    text: "A notional ₹1,000 per tracked stock, priced off real live quotes — current value, 1D return, total return, and how you're doing vs NIFTY. Never real money.",
  },
  {
    page: "paper",
    selector: '[data-tour="paper-table"]',
    title: "Per-stock breakdown",
    text: "Same numbers, broken out one row per stock, so you can see exactly which positions are driving the total.",
  },
  {
    page: "watchlist",
    selector: '[data-tour="sensitivity"]',
    title: "Quiet / Normal / Loud",
    text: "Per-stock sensitivity: Quiet only surfaces a stock's biggest, rarest moves; Loud surfaces smaller moves too, so nothing slips by.",
  },
  {
    page: "watchlist",
    selector: '[data-tour="theme-toggle"]',
    title: "Light or dark",
    text: "Switch anytime — your choice is remembered for next time. That's the whole tour.",
  },
];

const ACTIVE_KEY = "pulse-tour-active";
const STEP_KEY = "pulse-tour-step";
const AUTOSHOWN_KEY = "pulse-tour-autoshown";
const START_EVENT = "pulse:start-tour";

function pageFor(pathname: string): Page | null {
  if (/^\/w\/[^/]+\/history\/?$/.test(pathname)) return "history";
  if (/^\/w\/[^/]+\/paper\/?$/.test(pathname)) return "paper";
  if (/^\/w\/[^/]+\/?$/.test(pathname)) return "watchlist";
  return null;
}

export function ProductTour() {
  const pathname = usePathname();
  const router = useRouter();
  const params = useParams<{ id?: string }>();
  const id = params?.id;
  const page = pageFor(pathname);

  const [active, setActive] = useState(false);
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const pollTimer = useRef<number | null>(null);

  // Restore an in-progress tour on refresh, and listen for the manual
  // "Take the tour" trigger button anywhere in the app.
  useEffect(() => {
    try {
      if (sessionStorage.getItem(ACTIVE_KEY) === "1") {
        const saved = Number(sessionStorage.getItem(STEP_KEY) ?? "0");
        setActive(true);
        setStep(Number.isFinite(saved) ? saved : 0);
      }
    } catch { /* private mode etc. */ }

    const start = () => {
      try { sessionStorage.setItem(ACTIVE_KEY, "1"); sessionStorage.setItem(STEP_KEY, "0"); } catch {}
      setActive(true);
      setStep(0);
    };
    window.addEventListener(START_EVENT, start);
    return () => window.removeEventListener(START_EVENT, start);
  }, []);

  // First-ever visit to a watchlist, on this browser, offers the tour once
  // automatically. Never again after that — the top-of-page button covers
  // anyone who wants to replay it.
  useEffect(() => {
    if (page !== "watchlist" || active) return;
    try {
      if (localStorage.getItem(AUTOSHOWN_KEY)) return;
      localStorage.setItem(AUTOSHOWN_KEY, "1");
    } catch { return; }
    const t = window.setTimeout(() => {
      try { sessionStorage.setItem(ACTIVE_KEY, "1"); sessionStorage.setItem(STEP_KEY, "0"); } catch {}
      setActive(true);
      setStep(0);
    }, 900); // let the page's own content paint first
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  // Locate this step's target element. Polls briefly since right after a
  // cross-page navigation the target hasn't mounted (or its data hasn't
  // loaded) yet.
  useEffect(() => {
    if (pollTimer.current) window.clearTimeout(pollTimer.current);
    if (!active || !page) { setRect(null); return; }
    const current = STEPS[step];
    if (!current || current.page !== page) { setRect(null); return; }

    let cancelled = false;
    let tries = 0;
    const find = () => {
      if (cancelled) return;
      const el = document.querySelector(current.selector);
      if (el) {
        setRect(el.getBoundingClientRect());
        el.scrollIntoView({ block: "center", behavior: "smooth" });
      } else if (tries < 40) {
        tries++;
        pollTimer.current = window.setTimeout(find, 100);
      } else {
        setRect(null); // give up gracefully — tooltip still shows, just unanchored
      }
    };
    find();

    const onReflow = () => {
      const el = document.querySelector(current.selector);
      if (el) setRect(el.getBoundingClientRect());
    };
    window.addEventListener("scroll", onReflow, true);
    window.addEventListener("resize", onReflow);
    return () => {
      cancelled = true;
      if (pollTimer.current) window.clearTimeout(pollTimer.current);
      window.removeEventListener("scroll", onReflow, true);
      window.removeEventListener("resize", onReflow);
    };
  }, [active, page, step]);

  const end = () => {
    setActive(false);
    setRect(null);
    try { sessionStorage.removeItem(ACTIVE_KEY); sessionStorage.removeItem(STEP_KEY); } catch {}
  };

  const goTo = (next: number) => {
    if (next < 0) return;
    if (next >= STEPS.length) { end(); return; }
    const target = STEPS[next];
    try { sessionStorage.setItem(STEP_KEY, String(next)); } catch {}
    setStep(next);
    if (target.page !== page && id) {
      const url = target.page === "history" ? `/w/${id}/history` : target.page === "paper" ? `/w/${id}/paper` : `/w/${id}`;
      router.push(url);
    }
  };

  if (!active || !page) return null;
  const current = STEPS[step];
  if (!current || current.page !== page) return null; // mid cross-page transition

  return (
    <>
      {rect ? (
        <div
          aria-hidden="true"
          className="fixed z-[59] rounded-lg pointer-events-none transition-all duration-300"
          style={{
            left: rect.left - 6, top: rect.top - 6, width: rect.width + 12, height: rect.height + 12,
            boxShadow: "0 0 0 9999px rgba(10,10,12,.5), 0 0 0 2px var(--accent)",
          }}
        />
      ) : (
        <div aria-hidden="true" className="fixed inset-0 z-[59] pointer-events-none" style={{ background: "rgba(10,10,12,.5)" }} />
      )}
      <div
        className="fixed z-[60] w-[min(340px,calc(100vw-32px))] transition-all duration-300"
        style={rect ? tooltipPosition(rect) : { top: "50%", left: "50%", transform: "translate(-50%,-50%)" }}
      >
        <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] shadow-[0_12px_40px_rgb(0,0,0,0.25)] overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--line)] bg-[var(--surface-2)]">
            <span className="text-[10.5px] font-bold uppercase tracking-wider text-[var(--muted)]">Tour · {step + 1} of {STEPS.length}</span>
            <button onClick={end} aria-label="Skip tour" title="Skip tour" className="text-[var(--muted)] hover:text-[var(--ink)]">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
            </button>
          </div>
          <div className="p-4">
            <h3 className="m-0 mb-1 font-semibold text-[14px] text-[var(--ink)]">{current.title}</h3>
            <p className="m-0 text-[13px] leading-relaxed text-[var(--muted)]">{current.text}</p>
          </div>
          <div className="flex items-center justify-between px-4 py-2.5 border-t border-[var(--line)] bg-[var(--surface-2)]">
            <button onClick={() => goTo(step - 1)} disabled={step === 0} className="text-[12.5px] font-medium text-[var(--muted)] hover:text-[var(--ink)] disabled:opacity-30 transition-colors">
              Back
            </button>
            <button onClick={() => goTo(step + 1)} className="rounded-lg bg-[var(--accent)] px-3.5 py-1.5 text-[12.5px] font-semibold text-white hover:opacity-90 transition-opacity">
              {step === STEPS.length - 1 ? "Done" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function tooltipPosition(rect: DOMRect): CSSProperties {
  const vw = window.innerWidth, vh = window.innerHeight, w = 340, margin = 14;
  const spaceBelow = vh - rect.bottom;
  const top = spaceBelow > 220 ? rect.bottom + margin : Math.max(margin, rect.top - margin);
  let left = rect.left;
  if (left + w > vw - margin) left = Math.max(margin, vw - w - margin);
  return { top, left, transform: spaceBelow > 220 ? undefined : "translateY(-100%)" };
}
