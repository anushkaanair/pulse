import type { FeedStatus } from "@/lib/api";

export function FeedStatusBar({ status, lagSeconds }: { status: FeedStatus; lagSeconds: number | null }) {
  if (status === "live") return null;
  const age = lagSeconds === null ? "an unknown time" : lagSeconds >= 60 ? `${Math.floor(lagSeconds / 60)}m` : `${lagSeconds}s`;
  return (
    <div role="status" className="flex justify-center gap-2 border-b border-[var(--amber)]/25 bg-[var(--amber)]/10 px-4 py-2 text-xs text-[var(--amber-2)]">
      Data may be delayed — last update {age} ago.
    </div>
  );
}
