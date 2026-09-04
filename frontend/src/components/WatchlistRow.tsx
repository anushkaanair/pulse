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
// paths can never visually drift apart.
export function WatchlistRow({
  item, change, sparkline, onSensitivity, onRemove,
}: {
  item: WatchlistItem;
  change: ChangeItem["change"] | undefined;
  sparkline: SparklinePoint[] | undefined;
  onSensitivity: (choice: Sensitivity) => void;
  onRemove: () => void;
}) {
  const direction = !change?.pctSincePrev ? "flat" : change.pctSincePrev.startsWith("-") ? "down" : "up";
  return (
    <div className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-3 py-3 md:flex md:items-center md:gap-x-4 md:gap-y-0">
      {/* 1. Symbol & Name */}
      <div className="flex flex-col md:min-w-28 md:flex-1">
        <span className="text-sm font-medium">{item.symbol}</span>
        <span className="text-xs text-[var(--muted)] truncate">{item.name}</span>
      </div>

      {/* 2. Price & Change */}
      <div className="text-right md:min-w-24">
        <span className="numbers text-sm">{item.quote?.price ?? "—"}</span>
        {change?.pctSincePrev ? (
          <span className={`numbers ml-2 text-xs ${change.pctSincePrev.startsWith("-") ? "text-[var(--red)]" : "text-[var(--green)]"}`}>{change.pctSincePrev}%</span>
        ) : null}
      </div>

      {/* 3. Metrics (Volume, Range, Sparkline) - full width on mobile */}
      <div className="col-span-2 flex items-center justify-between gap-4 md:contents">
        {item.quote ? <span className="numbers text-xs text-[var(--muted)] md:w-16 md:text-right" title="1D volume">Vol {compactVolume(item.quote.volume)}</span> : null}
        <span className="flex-1 md:flex-none"><RangeBar low={item.quote?.weekLow ?? null} high={item.quote?.weekHigh ?? null} price={item.quote?.price} /></span>
        <Sparkline points={sparkline} direction={direction} />
      </div>

      {/* 4. Actions (Stale, Sensitivity, Remove) - full width on mobile */}
      <div className="col-span-2 flex items-center justify-between gap-4 border-t border-[var(--line)] pt-3 md:contents md:border-t-0 md:pt-0">
        <div className="flex items-center gap-3">
          {item.quote ? <StaleBadge quote={item.quote} /> : <span className="text-xs text-[var(--muted)]">No quote</span>}
          <div className="flex border border-[var(--line)] text-xs">
            {(["quiet", "normal", "loud"] as Sensitivity[]).map((choice) => (
              <button
                key={choice}
                onClick={() => onSensitivity(choice)}
                className={`px-2 py-1 ${item.sensitivity === choice ? "bg-black/10 text-[var(--ink)]" : "text-[var(--muted)] hover:text-[var(--ink)]"}`}
              >
                {choice}
              </button>
            ))}
          </div>
        </div>
        <button onClick={onRemove} className="text-xs text-[var(--muted)] underline underline-offset-4 hover:text-[var(--red)] md:ml-2">Remove</button>
      </div>
    </div>
  );
}
