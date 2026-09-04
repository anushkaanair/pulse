import type { FeedStatus } from "@/lib/api";

export function FeedStatusBar({ status, lagSeconds }: { status: FeedStatus; lagSeconds: number | null }) {
  if (status === "live") return null;
  const age = lagSeconds === null ? "an unknown time" : lagSeconds >= 60 ? `${Math.floor(lagSeconds / 60)}m` : `${lagSeconds}s`;
  return <div role="status" className="border-y border-[var(--line)] bg-black/3 px-4 py-2 text-xs text-[var(--muted)]">Data may be delayed — last update {age} ago.</div>;
}
