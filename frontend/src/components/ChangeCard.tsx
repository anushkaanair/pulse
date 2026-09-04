import type { ChangeItem } from "@/lib/api";

const eventLabels: Record<string, string> = { DAY_HIGH_BREACHED: "day high", DAY_LOW_BREACHED: "day low", VOLUME_SPIKE: "volume spike", GAP: "gap", CORRECTED: "corrected" };

export function ChangeCard({ item }: { item: ChangeItem }) {
  const strength = Math.min(1, item.change.attention / 4);
  return <article className="border-l-[3px] border-[var(--amber)] bg-black/[0.025] p-4" style={{ borderLeftColor: `color-mix(in srgb, var(--amber) ${Math.round(35 + strength * 65)}%, transparent)` }}>
    <div className="flex items-start justify-between gap-3"><div><div className="flex items-center gap-2"><h3 className="text-sm font-medium">{item.symbol}</h3>{item.change.sensitivity !== "normal" ? <span className="border border-[var(--line)] px-1.5 py-0.5 text-[10px] text-[var(--muted)]">{item.change.sensitivity}</span> : null}</div><p className="mt-0.5 text-xs text-[var(--muted)]">{item.name}</p></div><span className="numbers text-sm">{item.quote.price}</span></div>
    <p className="mt-4 text-base font-medium leading-6">{item.change.why}</p>
    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs"><span className="numbers border border-[var(--amber)] px-1.5 py-0.5 text-[var(--amber)]">{item.change.zScore === null ? "new" : `${Math.abs(item.change.zScore).toFixed(1)}σ`}</span>{item.change.events.map((event) => <span key={event} className="text-[var(--muted)]">{eventLabels[event]}</span>)}{item.change.confidence === "low" ? <span title="Not enough history yet" className="border-b border-dotted border-current text-[var(--muted)]">limited history</span> : null}</div>
  </article>;
}
