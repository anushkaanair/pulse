import type { Quote } from "@/lib/api";

export function StaleBadge({ quote }: { quote: Quote }) {
  if (!quote.stale) return null;
  const age = quote.ageSeconds >= 60 ? `${Math.floor(quote.ageSeconds / 60)}m old` : `${quote.ageSeconds}s old`;
  return <span title={`As of ${new Date(quote.asOf).toLocaleString()}`} className="inline-flex items-center gap-1 text-xs text-[var(--muted)]"><span className="h-1.5 w-1.5 rounded-full bg-current opacity-60" />{age}</span>;
}
