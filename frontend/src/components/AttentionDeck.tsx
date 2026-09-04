"use client";

import { useEffect, useRef, useState } from "react";
import type { ChangeItem, SparklinePoint } from "@/lib/api";
import { Sparkline } from "@/components/Sparkline";

const EVENT_LABELS: Record<string, string> = { DAY_HIGH_BREACHED: "day high", DAY_LOW_BREACHED: "day low", VOLUME_SPIKE: "volume spike", GAP: "gap", CORRECTED: "corrected" };
const STEP_ROT = 13;

// σ is the right internal metric but not the right word for a new trader
// at a glance — plain language leads, σ becomes a tooltip/secondary tag.
function moveLabel(zScore: number | null): string {
  if (zScore === null) return "New";
  const a = Math.abs(zScore);
  return a >= 3 ? "Very unusual" : a >= 2 ? "Unusual move" : "Bigger than usual";
}

// The stack is anchored at 30% from the left on desktop so receding cards
// have room to fan out to the right without the front card looking dead
// centered. On a narrow viewport there's no room for that offset — a
// 300px card anchored at 30% of a 375px screen clips its own left edge
// (found live, screenshotted: "HDFCBANK" rendered as "FCBANK", cut off by
// the stage's own overflow:hidden). Below the breakpoint the card shrinks
// to fit and the anchor recentres to 50%.
const NARROW_BREAKPOINT = 560;
// Compact by default (roughly half the old footprint — it was taking up
// too much vertical space at rest) and grows to the old full size only
// when the front card is actually clicked open. Two complete dimension
// sets rather than one CSS-scaled box, so the stage height genuinely
// shrinks at rest instead of just visually shrinking inside a fixed box.
function layoutFor(containerWidth: number) {
  const narrow = containerWidth > 0 && containerWidth < NARROW_BREAKPOINT;
  if (narrow) {
    const cardWExp = Math.max(200, Math.min(280, containerWidth - 48));
    return {
      compact: { cardW: cardWExp * 0.62, cardH: 128, stepX: cardWExp * 0.22, stepZ: 40, anchor: "50%", stageH: 196, cardTop: -64 },
      expanded: { cardW: cardWExp, cardH: 244, stepX: cardWExp * 0.34, stepZ: 70, anchor: "50%", stageH: 400, cardTop: -150 },
    };
  }
  return {
    compact: { cardW: 178, cardH: 120, stepX: 78, stepZ: 60, anchor: "42%", stageH: 184, cardTop: -60 },
    expanded: { cardW: 300, cardH: 244, stepX: 132, stepZ: 108, anchor: "42%", stageH: 372, cardTop: -140 },
  };
}

// The ranked "what deserves your attention" list, rendered as glass panes
// standing in real 3D space — depth driven by the engine's own attention
// score. 3D at rest, parallaxes with the cursor, scrubs on wheel, expands
// in place. `items` arrives already ranked and capped by the caller
// (attentionBudget) — this component only ever shows genuinely meaningful
// items, never a "nothing to show, here's filler" fallback: "nothing
// meaningful changed" is a real empty state elsewhere on the page, not
// something this deck should paper over with ordinary movement.
export function AttentionDeck({
  items, sparklines, topMover, onRefresh, refreshing,
}: {
  items: ChangeItem[];
  sparklines: Record<string, SparklinePoint[] | undefined>;
  topMover: { symbol: string; displaced: string | null } | null;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [parallax, setParallax] = useState({ x: 0, y: 0 });
  const [flat, setFlat] = useState(false);
  const [layout, setLayout] = useState(() => layoutFor(0));

  useEffect(() => {
    const node = stage.current;
    if (!node || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(([entry]) => setLayout(layoutFor(entry.contentRect.width)));
    ro.observe(node);
    return () => ro.disconnect();
  }, []);

  const activeRef = useRef(0), expandedRef = useRef(false), countRef = useRef(0), wheelLock = useRef(0);
  useEffect(() => { activeRef.current = active; expandedRef.current = expanded; countRef.current = items.length; }, [active, expanded, items.length]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setFlat(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  // Attached by hand rather than via onWheel: React registers wheel
  // listeners as passive, which makes preventDefault a no-op — the page
  // would scroll instead of the deck moving. Rate-limited so one flick
  // moves one pane, and only swallowed while the deck has somewhere to go.
  useEffect(() => {
    const node = stage.current;
    if (!node) return undefined;
    const onWheel = (event: WheelEvent) => {
      // Only trap horizontal scrolling, let vertical scrolls pass to the page
      if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) return;
      
      const delta = event.deltaX;
      if (Math.abs(delta) < 4) return;
      const next = delta > 0 ? activeRef.current + 1 : activeRef.current - 1;
      if (next < 0 || next > countRef.current - 1) return;
      event.preventDefault();
      const now = Date.now();
      if (now - wheelLock.current < 260) return;
      wheelLock.current = now;
      setActive(next);
      setExpanded(true);
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, []);

  // Snap to the front when the ranking itself changes. Adjusted during
  // render (React's sanctioned pattern) rather than in an effect.
  const deckKey = items.map((i) => i.symbol).join(",");
  const [seenKey, setSeenKey] = useState(deckKey);
  if (deckKey !== seenKey) { setSeenKey(deckKey); setActive(0); setExpanded(true); }

  if (items.length === 0) return null;

  const dims = expanded ? layout.expanded : layout.compact;

  const onMove = (event: React.MouseEvent) => {
    if (flat) return;
    const r = stage.current?.getBoundingClientRect();
    if (!r) return;
    setParallax({ x: ((event.clientY - r.top) / r.height - 0.5) * -7, y: ((event.clientX - r.left) / r.width - 0.5) * 16 });
  };
  const onKey = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowRight") { event.preventDefault(); setActive((a) => Math.min(items.length - 1, a + 1)); setExpanded(true); }
    if (event.key === "ArrowLeft") { event.preventDefault(); setActive((a) => Math.max(0, a - 1)); setExpanded(true); }
    if (event.key === "Escape" && expanded) { event.preventDefault(); setExpanded(false); }
  };

  return (
    <div
      ref={stage}
      tabIndex={-1}
      onMouseMove={onMove}
      onMouseLeave={() => setParallax({ x: 0, y: 0 })}
      onKeyDown={onKey}
      className="relative select-none overflow-hidden rounded-2xl border border-[var(--line)] outline-none"
      style={{
        height: expanded ? dims.stageH + 186 : dims.stageH, perspective: 1500, perspectiveOrigin: "50% 42%",
        background: "radial-gradient(120% 90% at 22% 0%, rgba(0,190,140,.04), transparent 58%), linear-gradient(175deg, var(--surface-2), var(--ground-2))",
        transition: "height .5s cubic-bezier(.22,1.4,.36,1)",
      }}
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-28" style={{ background: "linear-gradient(to top, color-mix(in srgb, var(--surface-2) 94%, transparent), transparent)" }} />

      <p className="absolute left-5 top-4 z-20 m-0 text-[10.5px] uppercase tracking-[.15em] text-[var(--muted)]">
        {items.length} worth a look — closest deserves attention
      </p>
      {onRefresh ? (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRefresh(); }}
          disabled={refreshing}
          title="Reset baseline — compares future visits against right now"
          aria-label="Reset baseline (attention deck)"
          className="absolute right-4 top-3.5 z-20 flex h-6 w-6 items-center justify-center rounded-full text-[var(--muted)] transition-colors hover:text-[var(--ink)] disabled:opacity-40"
          style={{ background: "var(--surface-3)", border: "1px solid var(--line-2)" }}
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" style={refreshing ? { animation: "spin .7s linear infinite" } : undefined}>
            <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.89M13.5 2v3.5H10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      ) : null}

      <div
        className="absolute top-1/2"
        style={{
          left: dims.anchor,
          transformStyle: "preserve-3d",
          transform: flat ? "translate(-50%,-50%)" : `translate(-50%,-46%) rotateX(${6 + parallax.x}deg) rotateY(${-9 + parallax.y * 0.35}deg)`,
          transition: "transform .42s cubic-bezier(.2,.8,.2,1)",
        }}
      >
        {items.map((item, index) => {
          const depth = index - active, behind = Math.abs(depth), isFront = depth === 0;
          const { zScore, zRaw, sectorAdjusted } = item.change;
          const positive = zScore !== null && zScore > 0;
          const magnitude = zScore === null ? 0 : Math.min(1, Math.abs(zScore) / 3);
          const rim = 0.08 + magnitude * 0.25; // significantly reduced gradient intensity
          const dim = isFront ? 1 : Math.max(0.3, 1 - behind * 0.26);
          const isTop = topMover?.symbol === item.symbol;
          const rawDiffers = sectorAdjusted && zScore !== null && zRaw !== null && Math.abs(Math.abs(zRaw) - Math.abs(zScore)) >= 0.3;

          const transform = flat
            ? `translateX(${depth * 18}px) scale(${isFront ? 1 : 0.94})`
            : expanded
              ? (isFront
                ? "translate3d(0px,-62px,40px) rotateY(0deg) scale(1)"
                : `translate3d(${depth * (dims.stepX + 26)}px, ${behind * 9}px, ${-behind * dims.stepZ - 90}px) rotateY(${depth * -STEP_ROT}deg) scale(${0.92 - behind * 0.03})`)
              : `translate3d(${depth * dims.stepX}px, ${behind * 9}px, ${-behind * dims.stepZ}px) rotateY(${depth * -STEP_ROT}deg) scale(${1 - behind * 0.03})`;

          return (
            <article
              key={item.symbol}
              role="button"
              tabIndex={isFront ? 0 : -1}
              aria-current={isFront}
              aria-expanded={isFront ? expanded : undefined}
              aria-label={isFront ? `${item.symbol}: ${item.change.why}. Open details` : `Bring ${item.symbol} to the front`}
              onClick={() => (isFront ? setExpanded((o) => !o) : (setActive(index), setExpanded(true)))}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); isFront ? setExpanded((o) => !o) : setActive(index); } }}
              className="absolute left-0 top-0 block cursor-pointer rounded-2xl p-px text-left"
              style={{
                width: dims.cardW, marginLeft: -dims.cardW / 2, marginTop: dims.cardTop,
                zIndex: 100 - behind,
                opacity: behind > 3 ? 0 : expanded && !isFront ? dim * 0.35 : dim,
                pointerEvents: behind > 3 ? "none" : "auto",
                transformStyle: "preserve-3d", transform,
                transition: "transform .5s cubic-bezier(.22,1.4,.36,1), opacity .35s ease",
                background: `linear-gradient(150deg, rgba(0,190,140,${rim}), var(--line-2) 45%, var(--line) 100%)`,
                boxShadow: isFront
                  ? `0 42px 70px -28px var(--shadow-deck), 0 0 60px -18px rgba(0,190,140,${rim * 0.4})`
                  : "0 30px 54px -30px var(--shadow-deck)",
                filter: isFront ? "none" : `saturate(${1 - behind * 0.18}) blur(${behind * 0.6}px)`,
              }}
            >
              <div className="relative overflow-hidden rounded-[15px]" style={{ padding: expanded ? 20 : 13, minHeight: dims.cardH, background: "linear-gradient(168deg, var(--surface-2), var(--surface))", transition: "padding .3s ease, min-height .5s cubic-bezier(.22,1.4,.36,1)" }}>
                <span aria-hidden="true" className="pointer-events-none absolute inset-0" style={{ background: "linear-gradient(135deg, rgba(255,255,255,.03), transparent 42%)" }} />
                <span aria-hidden="true" className="pointer-events-none absolute -right-10 -top-12 h-32 w-32 rounded-full" style={{ filter: "blur(28px)", background: `rgba(0,190,140,${(4 + magnitude * 12) / 100})` }} />

                {!expanded ? (
                  // Compact rest state: identity + price + σ only. The full
                  // reasoning, chips, and sparkline are the reward for
                  // clicking the front card open — not shown at rest, which
                  // is what actually lets the card be small at rest.
                  <div className="relative flex h-full flex-col justify-between">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center justify-center w-7 h-7 rounded-lg text-[11px] font-semibold" style={{ background: "linear-gradient(145deg, var(--surface-3), var(--surface))", border: "1px solid var(--line-2)" }}>{item.symbol[0]}</span>
                      <span className="rounded-full bg-[var(--amber)]/15 px-1.5 py-0.5 text-[8.5px] font-bold uppercase text-[var(--amber)]">{isTop ? "#1" : `#${index + 1}`}</span>
                    </div>
                    <h3 className="m-0 mt-1.5 truncate text-[13px] font-semibold tracking-tight">{item.symbol}</h3>
                    <div className="mt-1.5 flex items-end justify-between gap-1.5">
                      <span className="numbers text-[13px] font-semibold">₹{Number(item.quote.price).toFixed(0)}</span>
                      <span
                        className="rounded-full px-1.5 py-0.5 text-[9.5px] font-semibold whitespace-nowrap"
                        title={zScore === null ? undefined : `${Math.abs(zScore).toFixed(1)}σ from ${item.symbol}'s own normal move`}
                        style={zScore === null ? { color: "var(--muted)", background: "var(--surface-3)" } : { color: positive ? "var(--green)" : "var(--red)", background: positive ? "rgba(46,204,143,.13)" : "rgba(255,107,91,.13)" }}
                      >
                        {zScore === null ? "New" : `${positive ? "▲" : "▼"} ${moveLabel(zScore)}`}
                      </span>
                    </div>
                  </div>
                ) : (
                <div className="relative">
                  <div className="flex items-start justify-between mb-3.5">
                    <span className="flex items-center justify-center w-10 h-10 rounded-xl text-[15px] font-semibold" style={{ background: "linear-gradient(145deg, var(--surface-3), var(--surface))", border: "1px solid var(--line-2)", boxShadow: "inset 0 1px 0 rgba(255,255,255,.07)" }}>
                      {item.symbol[0]}
                    </span>
                    <span className="flex flex-col items-end gap-1.5">
                      {isTop ? (
                        <span className="rounded-full bg-[var(--amber)]/15 px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-[var(--amber)]" title={topMover?.displaced ? `Displaced ${topMover.displaced} as your top mover` : "Your new top mover"}>
                          {topMover?.displaced ? `#1 — was ${topMover.displaced}` : "#1 mover"}
                        </span>
                      ) : (
                        <span className="rounded-full bg-[var(--amber)]/15 px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-[var(--amber)]">#{index + 1}</span>
                      )}
                      {item.change.sensitivity !== "normal" ? (
                        <span className="rounded-full border border-[var(--line-2)] px-2 py-0.5 text-[9.5px] uppercase text-[var(--muted)]">{item.change.sensitivity}</span>
                      ) : null}
                    </span>
                  </div>

                  <h3 className="m-0 text-[17px] font-semibold tracking-tight">{item.symbol}</h3>
                  <p className="mt-0.5 mb-0 truncate text-[11.5px] text-[var(--muted)]">{item.name}</p>

                  {isFront ? (
                    <p className="mt-3 mb-0 line-clamp-4 text-[13px] leading-relaxed text-[var(--ink-2)]" style={{ minHeight: "3.5em" }} title={item.change.why}>{item.change.why}</p>
                  ) : (
                    <p className="mt-3 mb-0 truncate text-[13px] text-[var(--muted)]" style={{ minHeight: "3.5em" }}>{item.change.pctSincePrev ? `${item.change.pctSincePrev}% since you last looked` : "New since last look"}</p>
                  )}

                  <div className="mt-4 flex items-end justify-between gap-2">
                    <span className="numbers text-[19px] font-semibold tracking-tight">₹{Number(item.quote.price).toFixed(2)}</span>
                    <span className="flex flex-wrap justify-end items-center gap-1.5">
                      <span
                        className="rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap"
                        title={zScore === null ? undefined : `${Math.abs(zScore).toFixed(1)} standard deviations from ${item.symbol}'s own normal move${sectorAdjusted ? ", sector-adjusted" : ""}`}
                        style={zScore === null
                          ? { color: "var(--muted)", background: "var(--surface-3)" }
                          : { color: positive ? "var(--green)" : "var(--red)", background: positive ? "rgba(46,204,143,.13)" : "rgba(255,107,91,.13)" }}
                      >
                        {zScore === null ? "New" : `${positive ? "▲" : "▼"} ${moveLabel(zScore)}`}
                      </span>
                      {zScore !== null ? <span className="numbers text-[9.5px] text-[var(--muted)]">{Math.abs(zScore) > 9 ? ">9" : Math.abs(zScore).toFixed(1)}σ</span> : null}
                      {isFront && rawDiffers ? <span className="numbers text-[9.5px] text-[var(--muted)]" title="Raw z-score, before subtracting what the sector did">{Math.abs(zRaw!) > 9 ? ">9" : Math.abs(zRaw!).toFixed(1)}σ raw</span> : null}
                      {isFront && sectorAdjusted ? <span className="rounded-full border border-[var(--line-2)] px-1.5 py-0.5 text-[9.5px] text-[var(--muted)]" title="Adjusted for what the sector/index did over the same window">sector-adj</span> : null}
                      {isFront ? item.change.events.slice(0, 1).map((ev) => (
                        <span key={ev} className="rounded-full border border-[var(--line-2)] px-1.5 py-0.5 text-[9.5px] text-[var(--muted)]">{EVENT_LABELS[ev]}</span>
                      )) : null}
                    </span>
                  </div>

                  {isFront ? <ExpandedDetail item={item} points={sparklines[item.symbol]} /> : null}
                </div>
                )}
              </div>
            </article>
          );
        })}
      </div>

      {items.length > 1 && !expanded ? (
        // The peeking edge of the next card is a subtle affordance on its
        // own — an explicit arrow makes "there's more here" undeniable
        // rather than something a user has to notice on their own.
        <button
          type="button"
          onClick={() => { setActive((a) => Math.min(items.length - 1, a + 1)); setExpanded(true); }}
          disabled={active >= items.length - 1}
          aria-label="Next"
          className="absolute right-3 top-1/2 z-20 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-[var(--muted)] transition-colors hover:text-[var(--ink)] disabled:opacity-0"
          style={{ background: "var(--surface-3)", border: "1px solid var(--line-2)" }}
        >
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      ) : null}

      {items.length > 1 ? (
        <div className="absolute bottom-3.5 left-1/2 z-20 flex -translate-x-1/2 gap-1.5">
          {items.map((item, index) => (
            <button
              key={item.symbol}
              aria-label={`Show ${item.symbol}`}
              onClick={() => { setActive(index); setExpanded(true); }}
              className="h-1.5 rounded-full transition-all"
              style={{ width: index === active ? 20 : 6, background: index === active ? "var(--amber)" : "var(--line-2)" }}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Everything here is already-loaded data — expanding reveals, never refetches. */
function ExpandedDetail({ item, points }: { item: ChangeItem; points: SparklinePoint[] | undefined }) {
  const q = item.quote;
  const dir = !item.change.pctSincePrev ? "flat" : item.change.pctSincePrev.startsWith("-") ? "down" : "up";
  const rows: [string, string][] = [
    ["Day range", q.dayLow && q.dayHigh ? `${Number(q.dayLow).toFixed(0)} – ${Number(q.dayHigh).toFixed(0)}` : "—"],
    ["52-week range", q.weekLow && q.weekHigh ? `${Number(q.weekLow).toFixed(0)} – ${Number(q.weekHigh).toFixed(0)}` : "—"],
    ["Volume", q.volume >= 1e5 ? `${(q.volume / 1e5).toFixed(1)}L` : q.volume.toLocaleString()],
    ["Confidence", item.change.confidence === "low" ? "Low — thin history" : "High"],
  ];
  return (
    <div className="rise mt-3.5 border-t border-[var(--line)] pt-3.5">
      <div className="flex items-center justify-between gap-3">
        <Sparkline points={points} direction={dir} scale={1.55} />
        <span className="numbers text-[11.5px] font-semibold" style={{ color: dir === "down" ? "var(--red)" : dir === "up" ? "var(--green)" : "var(--muted)" }}>
          {item.change.pctSincePrev ? `${item.change.pctSincePrev}%` : "—"}
        </span>
      </div>
      <dl className="mt-3 flex flex-col gap-1.5 text-[11px]">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-2">
            <dt className="text-[var(--muted)]">{label}</dt>
            <dd className="numbers m-0 font-medium text-[var(--ink-2)]">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {item.change.events.map((ev) => (
          <span key={ev} className="rounded-full border border-[var(--line-2)] px-1.5 py-0.5 text-[9.5px] text-[var(--muted)]">{EVENT_LABELS[ev]}</span>
        ))}
        <span className="ml-auto text-[9.5px] text-[var(--muted)]">
          {q.stale ? `${q.ageSeconds}s old · ` : ""}as of {new Date(q.asOf).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
        </span>
      </div>
    </div>
  );
}
