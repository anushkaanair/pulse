// 52-week low–high position bar (Groww shows this as "52W perf"). A thin
// track with a marker at where the current price sits in its yearly band —
// glanceable context the raw price can't give. Muted, not a signal color.
export function RangeBar({ low, high, price }: { low: string | null; high: string | null; price: string | undefined }) {
  if (!low || !high || price === undefined) return <span className="inline-block w-16" aria-hidden="true" />;
  const l = Number(low), h = Number(high), p = Number(price);
  const pct = h > l ? Math.max(0, Math.min(1, (p - l) / (h - l))) : 0.5;
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-[var(--muted)]" title={`52W ${low} – ${high}`}>
      <span>L</span>
      <span className="relative inline-block h-[3px] w-16 rounded bg-[var(--line)]">
        <span className="absolute top-1/2 h-2 w-[2px] -translate-y-1/2 rounded bg-[var(--ink)]" style={{ left: `${pct * 100}%` }} />
      </span>
      <span>H</span>
    </span>
  );
}
