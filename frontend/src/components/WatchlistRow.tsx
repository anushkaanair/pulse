import type { CSSProperties } from "react";
import { RangeBar } from "@/components/RangeBar";
import { Sparkline } from "@/components/Sparkline";
import { StaleBadge } from "@/components/StaleBadge";
import type { ChangeItem, Sensitivity, SparklinePoint, WatchlistItem } from "@/lib/api";

function compactVolume(v: number) {
  if (v >= 1e7) return `${(v / 1e7).toFixed(1)}Cr`;
  if (v >= 1e5) return `${(v / 1e5).toFixed(1)}L`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return String(v);
}

// The single dense row used in both the plain <ul> (small lists) and the
// virtualized list (>100 items) — same markup either way, so the two code
// paths can never visually drift apart. Renders as a real <li> (was
// silently downgraded to a <div> in an earlier pass, which broke the
// list's accessibility role and the e2e assertions that key off it) —
// the virtualized path needs to attach its own ref/style/index onto this
// same <li>, so those are accepted as optional passthrough props rather
// than wrapping WatchlistRow in an extra element (which would nest a
// <div> between <ul> and <li> and be just as invalid).
export function WatchlistRow({
  item, change, sparkline, onSensitivity, onRemove, innerRef, style, dataIndex, className,
}: {
  item: WatchlistItem;
  change: ChangeItem["change"] | undefined;
  sparkline: SparklinePoint[] | undefined;
  onSensitivity: (choice: Sensitivity) => void;
  onRemove: () => void;
  innerRef?: (el: HTMLLIElement | null) => void;
  style?: CSSProperties;
  dataIndex?: number;
  className?: string;
}) {
  const direction = !change?.pctSincePrev ? "flat" : change.pctSincePrev.startsWith("-") ? "down" : "up";
  return (
    <li
      ref={innerRef}
      style={style}
      data-index={dataIndex}
      className={`grid grid-cols-[1fr_auto] gap-x-4 gap-y-3 py-3 md:flex md:items-center md:gap-x-4 md:gap-y-0 hover:bg-[var(--ground)] transition-colors rounded-lg md:rounded-none px-2 md:px-0 list-none${className ? ` ${className}` : ""}`}
    >
      {/* 1. Symbol & Name */}
      <div className="flex items-center gap-3 md:min-w-28 md:flex-1">
        <div className="w-8 h-8 rounded-md bg-gradient-to-br from-gray-50 to-gray-100 text-[var(--ink-dark)] font-medium flex items-center justify-center text-sm border border-[var(--line)] hidden md:flex flex-shrink-0">
          {item.symbol[0]}
        </div>
        <div className="flex flex-col min-w-0">
          <span className="text-[14px] font-medium text-[var(--ink-dark)] truncate">{item.name || item.symbol}</span>
          <span className="text-xs text-[var(--muted)] truncate">{item.symbol}</span>
        </div>
      </div>

      {/* 2. Price & Change */}
      <div className="text-right md:min-w-24 flex flex-col items-end justify-center">
        <span className="numbers text-[14px] font-medium text-[var(--ink-dark)]">{item.quote ? `₹${Number(item.quote.price).toFixed(2)}` : "—"}</span>
        {change?.pctSincePrev ? (
          <span className={`numbers text-[11px] font-medium ${change.pctSincePrev.startsWith("-") ? "text-[var(--red)]" : "text-[var(--accent)]"}`}>{change.pctSincePrev}%</span>
        ) : null}
      </div>

      {/* 3. Metrics (Volume, Range, Sparkline) - full width on mobile */}
      <div className="col-span-2 flex items-center justify-between gap-4 md:contents">
        <div className="md:w-16 md:text-right hidden md:block">
           {item.quote ? <span className="numbers text-[13px] text-[var(--ink-dark)]" title="1D volume">{compactVolume(item.quote.volume)}</span> : <span className="text-xs text-[var(--muted)]">—</span>}
        </div>
        <div className="flex-1 max-w-[120px] hidden md:block">
           <RangeBar low={item.quote?.weekLow ?? null} high={item.quote?.weekHigh ?? null} price={item.quote?.price} />
        </div>
        <div className="w-16 hidden md:block">
           <Sparkline points={sparkline} direction={direction} />
        </div>
      </div>

      {/* 4. Actions (Stale, Sensitivity, Remove) - full width on mobile */}
      <div className="col-span-2 flex items-center justify-between gap-4 border-t border-[var(--line)] pt-3 md:contents md:border-t-0 md:pt-0">
        <div className="md:w-[150px] flex items-center justify-end gap-2">
          {item.quote ? <StaleBadge quote={item.quote} /> : null}
          <div className="flex bg-[var(--ground)] rounded text-[10px] border border-[var(--line)] overflow-hidden">
            {(["quiet", "normal", "loud"] as Sensitivity[]).map((choice) => (
              <button
                key={choice}
                onClick={() => onSensitivity(choice)}
                className={`px-1.5 py-0.5 ${item.sensitivity === choice ? "bg-[var(--muted)] text-white" : "text-[var(--muted)] hover:bg-[var(--line)]"} transition-colors`}
                title={`Sensitivity: ${choice}`}
              >
                {choice[0].toUpperCase()}
              </button>
            ))}
          </div>
          <button onClick={onRemove} className="text-xs text-[var(--muted)] hover:text-[var(--red)] p-1 rounded hover:bg-red-50 transition-colors" title="Remove">
             <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        </div>
      </div>
    </li>
  );
}
