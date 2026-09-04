import { Sparkline } from "@/components/Sparkline";
import { StaleBadge } from "@/components/StaleBadge";
import type { ChangeItem, Sensitivity, SparklinePoint, WatchlistItem } from "@/lib/api";

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
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3 py-3">
      <div className="min-w-28 flex-1">
        <span className="text-sm font-medium">{item.symbol}</span>
        <span className="ml-2 text-xs text-[var(--muted)]">{item.name}</span>
      </div>
      <div className="min-w-24 text-right">
        <span className="numbers text-sm">{item.quote?.price ?? "—"}</span>
        {change?.pctSincePrev ? (
          <span className={`numbers ml-2 text-xs ${change.pctSincePrev.startsWith("-") ? "text-[var(--red)]" : "text-[var(--green)]"}`}>{change.pctSincePrev}%</span>
        ) : null}
      </div>
      <Sparkline points={sparkline} direction={direction} />
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
      <button onClick={onRemove} className="text-xs text-[var(--muted)] underline underline-offset-4 hover:text-[var(--red)]">Remove</button>
    </div>
  );
}
