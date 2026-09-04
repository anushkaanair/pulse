import type { CSSProperties } from "react";
import { RangeBar } from "@/components/RangeBar";
import { Sparkline } from "@/components/Sparkline";
import { StaleBadge } from "@/components/StaleBadge";
import type { ChangeItem, Sensitivity, SparklinePoint, WatchlistItem } from "@/lib/api";

const SENSITIVITY_HINT: Record<Sensitivity, string> = {
  quiet: "Quiet — only surface this stock's biggest, rarest moves",
  normal: "Normal — surface moves that are genuinely unusual for this stock",
  loud: "Loud — surface smaller moves too, so nothing slips by",
};

function compactVolume(v: number) {
  if (v >= 1e7) return `${(v / 1e7).toFixed(1)}Cr`;
  if (v >= 1e5) return `${(v / 1e5).toFixed(1)}L`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return String(v);
}

// The single dense row used in both the plain <ul> (small lists) and the
// virtualized list (>100 items) — same markup either way, so the two code
// paths can never visually drift apart. Renders as a real <li> — the
// virtualized path needs to attach its own ref/style/index onto this same
// <li>, so those are accepted as optional passthrough props rather than
// wrapping WatchlistRow in an extra element (which would nest a <div>
// between <ul> and <li> and be just as invalid).
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
  const down = change?.pctSincePrev?.startsWith("-");
  return (
    <li
      ref={innerRef}
      style={style}
      data-index={dataIndex}
      className={`grid grid-cols-[1fr_auto] gap-x-4 gap-y-3 py-2.5 md:flex md:items-center md:gap-x-4 md:gap-y-0 hover:bg-[var(--surface-3)] transition-colors rounded-lg md:rounded-none px-2 md:px-0 list-none${className ? ` ${className}` : ""}`}
    >
      {/* 1. Symbol & Name */}
      <div className="flex items-center gap-3 md:min-w-28 md:flex-1">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center text-[13px] font-semibold text-[var(--ink-2)] border border-[var(--line-2)] hidden md:flex flex-shrink-0" style={{ background: "linear-gradient(145deg, var(--surface-3), var(--surface))" }}>
          {item.symbol[0]}
        </div>
        <div className="flex flex-col min-w-0">
          <span className="text-[14px] font-medium text-[var(--ink)] truncate">{item.name || item.symbol}</span>
          <span className="text-[11.5px] text-[var(--muted)] truncate">{item.symbol}</span>
        </div>
      </div>

      {/* 2. Price & Change */}
      <div className="text-right md:min-w-24 flex flex-col items-end justify-center">
        <span className="numbers text-[14px] font-semibold text-[var(--ink)]">{item.quote ? `₹${Number(item.quote.price).toFixed(2)}` : "—"}</span>
        {change?.pctSincePrev ? (
          <span className="numbers text-[11px] font-medium" style={{ color: down ? "var(--red)" : "var(--green)" }}>{change.pctSincePrev}%</span>
        ) : null}
      </div>

      {/* 3. Metrics (Volume, Range, Sparkline) - full width on mobile */}
      <div className="col-span-2 flex items-center justify-between gap-4 md:contents">
        <div className="md:w-16 md:text-right hidden md:block">
           {item.quote ? <span className="numbers text-[12.5px] text-[var(--ink-2)]" title="1D volume">{compactVolume(item.quote.volume)}</span> : <span className="text-xs text-[var(--muted)]">—</span>}
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
          <div className="flex rounded-lg overflow-hidden border border-[var(--line)] bg-[var(--ground-2)] text-[10px]">
            {(["quiet", "normal", "loud"] as Sensitivity[]).map((choice) => (
              <button
                key={choice}
                onClick={() => onSensitivity(choice)}
                className="px-1.5 py-0.5 font-medium transition-colors"
                style={item.sensitivity === choice ? { background: "var(--line-2)", color: "var(--ink)" } : { color: "var(--muted)" }}
                title={SENSITIVITY_HINT[choice]}
                aria-label={SENSITIVITY_HINT[choice]}
                aria-pressed={item.sensitivity === choice}
              >
                {choice[0].toUpperCase()}
              </button>
            ))}
          </div>
          <button onClick={onRemove} className="text-[var(--muted)] hover:text-[var(--red)] p-1.5 rounded-md hover:bg-[var(--surface-3)] transition-colors" title={`Remove ${item.symbol}`} aria-label={`Remove ${item.symbol}`}>
             <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        </div>
      </div>
    </li>
  );
}
