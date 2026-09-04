import Link from "next/link";

// Deliberately minimal: an app name and nothing else. Earlier draft cloned
// Groww's own chrome (nav labels, a "Search Groww..." box, a ticker tape of
// four indices all showing the same hardcoded numbers) — decorative, all
// non-functional, and the fake ticker actively worked against this app's
// own thesis (never show stale/fake data as real). Cut rather than faked.
export function Header() {
  return (
    <div className="bg-[var(--surface)] border-b border-[var(--line)]">
      <div className="max-w-7xl mx-auto px-4 h-16 flex items-center gap-3">
        <Link href="/" className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-[var(--accent)] to-blue-500" />
          <span className="font-semibold text-lg tracking-tight text-[var(--ink-dark)]">Watchlist</span>
        </Link>
      </div>
    </div>
  );
}
