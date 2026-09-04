import Link from "next/link";

// Deliberately minimal: an app name and nothing else. Earlier draft cloned
// Groww's own chrome (nav labels, a "Search Groww..." box, a ticker tape of
// four indices all showing the same hardcoded numbers) — decorative, all
// non-functional, and the fake ticker actively worked against this app's
// own thesis (never show stale/fake data as real). Cut rather than faked.
export function Header() {
  return (
    <div className="sticky top-0 z-30 border-b border-[var(--line)] bg-[var(--ground)]/80 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-4 h-12 flex items-center gap-2.5">
        <Link href="/" className="flex items-center gap-2">
          <span
            className="flex items-center justify-center w-6 h-6 rounded-lg"
            style={{ background: "linear-gradient(140deg, var(--amber-2), var(--amber) 45%, var(--amber-dim))", boxShadow: "0 3px 10px -3px rgba(240,180,41,.6), inset 0 1px 0 rgba(255,255,255,.35)" }}
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M2 11.5 5.5 7l3 2.5L14 4" stroke="#1a1206" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="font-semibold text-[13.5px] tracking-tight text-[var(--ink)]">Watchlist</span>
        </Link>
      </div>
    </div>
  );
}
