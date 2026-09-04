import type { ChangeItem } from "@/lib/api";

const eventLabels: Record<string, string> = { DAY_HIGH_BREACHED: "day high", DAY_LOW_BREACHED: "day low", VOLUME_SPIKE: "volume spike", GAP: "gap", CORRECTED: "corrected" };

export function ChangeCard({ item, isTopMover, displaced }: { item: ChangeItem; isTopMover?: boolean; displaced?: string | null }) {
  const isPositive = item.change.zScore !== null && item.change.zScore > 0;
  const { sectorAdjusted, zScore, zRaw } = item.change;
  // Only worth showing both numbers when they actually differ meaningfully —
  // otherwise one number reads cleaner and "3.4σ raw" next to "3.4σ" is noise.
  const rawDiffers = sectorAdjusted && zScore !== null && zRaw !== null && Math.abs(Math.abs(zRaw) - Math.abs(zScore)) >= 0.3;

  return (
    <article className="card-enter flex-none w-[240px] bg-[var(--surface)] border border-[var(--line)] rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow cursor-pointer">
      <div className="flex flex-col h-full">
        <div className="flex items-start justify-between mb-4">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-gray-50 to-gray-100 text-[var(--ink-dark)] font-medium flex items-center justify-center text-lg border border-[var(--line)]">
            {item.symbol[0]}
          </div>
          <div className="flex flex-col items-end gap-1">
            {isTopMover ? (
              <span className="bg-[var(--accent)]/10 text-[var(--accent)] px-1.5 py-0.5 text-[10px] font-medium rounded" title={displaced ? `Displaced ${displaced} as your top mover` : "Your new top mover"}>
                {displaced ? `#1 — was ${displaced}` : "#1 mover"}
              </span>
            ) : null}
            {item.change.sensitivity !== "normal" ? <span className="bg-[var(--ground)] border border-[var(--line)] px-1.5 py-0.5 text-[10px] text-[var(--muted)] rounded">{item.change.sensitivity}</span> : null}
          </div>
        </div>
        <h3 className="text-[15px] font-medium text-[var(--ink-dark)] mb-1">{item.symbol}</h3>
        <p className="text-xs text-[var(--muted)] mb-3 line-clamp-1">{item.name}</p>
        <p className="text-sm text-[var(--ink-dark)] mb-5 leading-relaxed line-clamp-3 flex-1" title={item.change.why}>{item.change.why}</p>

        <div className="mt-auto">
          <div className="numbers text-[16px] font-medium text-[var(--ink-dark)]">₹{Number(item.quote.price).toFixed(2)}</div>
          <div className="flex flex-wrap gap-2 items-center mt-1.5">
            <span className={`numbers text-xs font-medium ${zScore === null ? "text-[var(--muted)]" : isPositive ? "text-[var(--accent)]" : "text-[var(--red)]"}`}>
              {zScore === null ? "New" : `${isPositive ? "+" : ""}${zScore.toFixed(1)}σ`}
            </span>
            {rawDiffers ? (
              <span className="numbers text-[10px] text-[var(--muted)]" title="Raw z-score, before subtracting what the sector did">{zRaw!.toFixed(1)}σ raw</span>
            ) : null}
            {sectorAdjusted ? (
              <span className="text-[10px] text-[var(--muted)] bg-[var(--ground)] px-1.5 py-0.5 rounded" title="Adjusted for what the sector/index did over the same window">sector-adj</span>
            ) : null}
            {item.change.events.map((event) => <span key={event} className="text-[10px] text-[var(--muted)] bg-[var(--ground)] px-1.5 py-0.5 rounded">{eventLabels[event]}</span>)}
          </div>
        </div>
      </div>
    </article>
  );
}
