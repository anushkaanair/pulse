// 52-week low–high position bar. A thin track with a marker at where the
// current price sits in its yearly band — glanceable context the raw price
// can't give. Muted, not a signal color.
export function RangeBar({ low, high, price }: { low: string | null | undefined; high: string | null | undefined; price: string | undefined }) {
  if (!low || !high || price === undefined) return <span className="inline-block w-16" aria-hidden="true" />;
  const l = Number(low), h = Number(high), p = Number(price);
  const pct = h > l ? Math.max(0, Math.min(1, (p - l) / (h - l))) : 0.5;
  return (
    <span title={`52W ${low} – ${high}`} className="inline-flex items-center gap-1.5 w-full text-[9.5px] text-[var(--muted)]">
      <span>L</span>
      <span className="relative flex-1 h-[3px] rounded-full bg-[var(--line-2)]">
        <span className="absolute top-1/2 h-[9px] w-[2.5px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--ink-2)]" style={{ left: `${pct * 100}%` }} />
      </span>
      <span>H</span>
    </span>
  );
}
