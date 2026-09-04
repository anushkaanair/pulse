import type { Quote } from "@/lib/api";

export function StaleBadge({ quote }: { quote: Quote }) {
  if (!quote.stale) return null;
  const age = quote.ageSeconds >= 60 ? `${Math.floor(quote.ageSeconds / 60)}m old` : `${quote.ageSeconds}s old`;
  return (
    <span title={`As of ${new Date(quote.asOf).toLocaleString()}`} className="inline-flex items-center gap-1 rounded-full bg-[var(--surface-3)] px-2 py-0.5 text-[10px] text-[var(--muted)]">
      <span className="h-1 w-1 rounded-full bg-current opacity-70" />{age}
    </span>
  );
}
