"use client";

import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { api } from "@/lib/api";

type Page = "watchlist" | "history" | "paper";
type ListTarget = "home" | "empty";

interface Step {
  page: Page;
  list?: ListTarget; // default "home" — only the starter-packs step needs "empty"
  selector: string;
  title: string;
  text: string;
}

// Cross-page, element-anchored, priority-ordered walkthrough. Order mirrors
// what actually matters: get a watchlist populated first (nothing else has
// anything to show before that), then the two headline views (Attention
// Deck, the full list), then the per-stock control, then the two secondary
// pages (History, Paper trading) — each visited on its own and returned
// from before the next one starts, never L2-to-L2 directly — and finally
// the cosmetic theme toggle last.
const STEPS: Step[] = [
  {
    page: "watchlist",
    list: "empty",
    selector: '[data-tour="starter-packs"]',
    title: "Starter watchlist packs",
    text: "One click gets you a real, live-priced watchlist instantly — Nifty Top 10, Banking, or IT. Nothing else here has anything to show until there's something to track.",
  },
  {
    page: "watchlist",
    selector: '[data-tour="attention-deck"]',
    title: "Attention Deck",
    text: "The ranked \"worth a look\" cards — depth mirrors how much each move actually matters, not just a flat list of everything that moved.",
  },
  {
    page: "watchlist",
    selector: '[data-tour="stock-list"]',
    title: "All tracked stocks",
    text: "Every stock you track, always visible — the deck triages what's meaningful, it never hides the rest.",
  },
  {
    page: "watchlist",
    selector: '[data-tour="sensitivity"]',
    title: "Quiet / Normal / Loud",
    text: "Per-stock sensitivity: Quiet only surfaces a stock's biggest, rarest moves; Loud surfaces smaller moves too, so nothing slips by.",
  },
  {
    page: "watchlist",
    selector: '[data-tour="history-link"]',
    title: "Visit history",
    text: "Compare right now against any of your past visits. Let's take a look.",
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
    page: "watchlist",
    selector: '[data-tour="paper-card"]',
    title: "Paper trading",
    text: "A notional ₹1,000 per tracked stock, priced off real live quotes — never real money. Let's see the detail.",
  },
  {
    page: "paper",
    selector: '[data-tour="paper-summary"]',
    title: "Paper trading, summarized",
    text: "Current value, 1D return, total return, and how you're doing vs NIFTY.",
  },
  {
    page: "paper",
    selector: '[data-tour="paper-table"]',
    title: "Per-stock breakdown",
    text: "Same numbers, one row per stock, so you can see exactly which positions are driving the total.",
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
const HOME_KEY = "pulse-tour-home-id";
const EMPTY_KEY = "pulse-tour-empty-id";
const AUTOSHOWN_KEY = "pulse-tour-autoshown";
const START_EVENT = "pulse:start-tour";

function pageFor(pathname: string): Page | null {
  if (/^\/w\/[^/]+\/history\/?$/.test(pathname)) return "history";
  if (/^\/w\/[^/]+\/paper\/?$/.test(pathname)) return "paper";
  if (/^\/w\/[^/]+\/?$/.test(pathname)) return "watchlist";
  return null;
}

function idFromPath(pathname: string): string | null {
  const m = pathname.match(/^\/w\/([^/]+)/);
  return m ? m[1] : null;
}

function urlFor(page: Page, listId: string): string {
  return page === "history" ? `/w/${listId}/history` : page === "paper" ? `/w/${listId}/paper` : `/w/${listId}`;
}

// Find an existing empty watchlist to demo the starter packs on, or create
// one — rather than assume the account (e.g. the seeded `demo` user, or
// anyone's own already-populated list) has an empty list sitting around.
// Reused by name on repeat tours instead of spawning a fresh one each time.
async function resolveEmptyListId(homeId: string): Promise<string> {
  const lists = await api.watchlists();
  const home = lists.find((w) => w.id === homeId);
  if (home && home.itemCount === 0) return homeId;
  const existing = lists.find((w) => w.itemCount === 0);
  if (existing) return existing.id;
  const created = await api.createWatchlist("Starter packs demo");
  return created.id;
}

export function ProductTour() {
  const pathname = usePathname();
  const router = useRouter();
  const page = pageFor(pathname);
  const currentListId = idFromPath(pathname);

  const [active, setActive] = useState(false);
  const [step, setStep] = useState(0);
  const [homeId, setHomeId] = useState<string | null>(null);
  const [emptyId, setEmptyId] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const pollTimer = useRef<number | null>(null);
  const resolvingRef = useRef(false);

  const beginTour = async (originId: string) => {
    try { sessionStorage.setItem(ACTIVE_KEY, "1"); sessionStorage.setItem(STEP_KEY, "0"); sessionStorage.setItem(HOME_KEY, originId); sessionStorage.removeItem(EMPTY_KEY); } catch {}
    setHomeId(originId);
    setEmptyId(null);
    setStep(0);
    setActive(true);
    if (resolvingRef.current) return;
    resolvingRef.current = true;
    setResolving(true);
    try {
      const eid = await resolveEmptyListId(originId);
      try { sessionStorage.setItem(EMPTY_KEY, eid); } catch {}
      setEmptyId(eid);
      if (eid !== originId) router.push(urlFor("watchlist", eid));
    } catch {
      // Couldn't resolve/create one — fall back to the origin list; the
      // starter-packs step just degrades gracefully like any other step
      // whose target isn't present (see the polling below).
      setEmptyId(originId);
    } finally {
      setResolving(false);
      resolvingRef.current = false;
    }
  };

  // Restore an in-progress tour on refresh, and listen for the manual
  // "Take the tour" trigger button anywhere in the app.
  useEffect(() => {
    try {
      if (sessionStorage.getItem(ACTIVE_KEY) === "1") {
        const savedHome = sessionStorage.getItem(HOME_KEY);
        if (savedHome) {
          const saved = Number(sessionStorage.getItem(STEP_KEY) ?? "0");
          const savedEmpty = sessionStorage.getItem(EMPTY_KEY);
          setActive(true);
          setStep(Number.isFinite(saved) ? saved : 0);
          setHomeId(savedHome);
          if (savedEmpty) setEmptyId(savedEmpty);
        }
      }
    } catch { /* private mode etc. */ }

    const start = () => {
      const origin = idFromPath(window.location.pathname);
      if (origin) void beginTour(origin);
    };
    window.addEventListener(START_EVENT, start);
    return () => window.removeEventListener(START_EVENT, start);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // First-ever visit to a watchlist, on this browser, offers the tour once
  // automatically. Never again after that — the top-of-page button covers
  // anyone who wants to replay it.
  useEffect(() => {
    if (page !== "watchlist" || active || !currentListId) return;
    try {
      if (localStorage.getItem(AUTOSHOWN_KEY)) return;
      localStorage.setItem(AUTOSHOWN_KEY, "1");
    } catch { return; }
    const t = window.setTimeout(() => void beginTour(currentListId), 900); // let the page's own content paint first
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, currentListId]);

  const current = active ? STEPS[step] : undefined;
  const desiredListId = current ? (current.list === "empty" ? emptyId : homeId) : null;
  const onRightScreen = Boolean(active && current && page === current.page && (!desiredListId || desiredListId === currentListId));

  // Locate this step's target element once we're actually on the right
  // page AND the right watchlist. Polls briefly since right after a
  // navigation the target hasn't mounted (or its data hasn't loaded) yet.
  // Prefers a currently-visible match when the selector exists more than
  // once (desktop sidebar vs. mobile inline copy of the same card) — an
  // off-screen/hidden duplicate would otherwise win by being first in the
  // DOM regardless of what's actually on screen.
  useEffect(() => {
    if (pollTimer.current) window.clearTimeout(pollTimer.current);
    if (!onRightScreen || !current) { setRect(null); return; }

    let cancelled = false;
    let tries = 0;
    const pick = (selector: string) => {
      const els = Array.from(document.querySelectorAll<HTMLElement>(selector));
      return els.find((el) => el.offsetParent !== null) ?? els[0] ?? null;
    };
    const find = () => {
      if (cancelled) return;
      const el = pick(current.selector);
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
      const el = pick(current.selector);
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
  }, [onRightScreen, current]);

  const end = () => {
    setActive(false);
    setRect(null);
    try { [ACTIVE_KEY, STEP_KEY, HOME_KEY, EMPTY_KEY].forEach((k) => sessionStorage.removeItem(k)); } catch {}
  };

  const goTo = (next: number) => {
    if (next < 0) return;
    if (next >= STEPS.length) { end(); return; }
    const target = STEPS[next];
    const targetListId = target.list === "empty" ? emptyId : homeId;
    try { sessionStorage.setItem(STEP_KEY, String(next)); } catch {}
    setStep(next);
    if (!targetListId) return; // still resolving the empty list; render holds on the loading state below
    if (target.page !== page || targetListId !== currentListId) router.push(urlFor(target.page, targetListId));
  };

  if (!active || !page) return null;

  if (resolving) {
    return (
      <div className="fixed z-[60] w-[min(320px,calc(100vw-32px))]" style={{ top: "50%", left: "50%", transform: "translate(-50%,-50%)" }}>
        <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] shadow-[0_12px_40px_rgb(0,0,0,0.25)] p-4">
          <p className="m-0 text-[13px] text-[var(--muted)]">Setting up a blank watchlist to show the starter packs…</p>
        </div>
      </div>
    );
  }

  if (!current || !onRightScreen) return null; // mid cross-page/cross-list transition

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
