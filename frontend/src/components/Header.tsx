import Link from "next/link";

export function Header() {
  return (
    <div className="bg-white border-b border-[var(--line)]">
      {/* Top Nav */}
      <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-[var(--groww)] to-blue-500"></div>
            <span className="font-semibold text-lg tracking-tight">Stocks</span>
          </Link>
          <nav className="hidden md:flex gap-6 text-sm font-medium text-[var(--muted)]">
            <Link href="/" className="text-[var(--ink)]">Explore</Link>
            <Link href="/" className="hover:text-[var(--ink)]">F&O</Link>
            <Link href="/" className="hover:text-[var(--ink)]">Mutual Funds</Link>
          </nav>
        </div>
        
        <div className="flex-1 max-w-lg px-8 hidden md:block">
          <div className="relative">
            <span className="absolute left-3 top-2.5 text-[var(--muted)]">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
            </span>
            <input 
              type="text" 
              placeholder="Search Groww..." 
              className="w-full bg-[var(--ground)] border border-transparent focus:border-[var(--groww)] focus:bg-white rounded-md py-2 pl-10 pr-4 text-sm outline-none transition-colors"
            />
          </div>
        </div>

        <div className="flex items-center gap-4 text-[var(--muted)]">
          <button className="p-2 hover:bg-[var(--ground)] rounded-full">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
          </button>
          <div className="w-8 h-8 rounded-full bg-[var(--line)]"></div>
        </div>
      </div>

      {/* Secondary Nav */}
      <div className="max-w-7xl mx-auto px-4 h-12 flex items-center gap-8 text-sm font-medium text-[var(--muted)] border-t border-[var(--line)]">
        <Link href="/" className="hover:text-[var(--ink)]">Explore</Link>
        <Link href="/" className="hover:text-[var(--ink)]">Holdings</Link>
        <Link href="/" className="hover:text-[var(--ink)]">Positions</Link>
        <Link href="/" className="hover:text-[var(--ink)]">Orders</Link>
        <Link href="/" className="text-[var(--groww)] border-b-2 border-[var(--groww)] h-full flex items-center">Watchlist</Link>
      </div>

      {/* Ticker Tape */}
      <div className="border-t border-[var(--line)] bg-[var(--surface)] text-xs h-10 flex items-center overflow-x-auto whitespace-nowrap px-4 hide-scrollbar">
        <div className="max-w-7xl mx-auto flex gap-6 w-full">
          {["NIFTY", "SENSEX", "BANKNIFTY", "FINNIFTY"].map((idx) => (
            <div key={idx} className="flex gap-2 items-center">
              <span className="font-medium text-[var(--muted)]">{idx}</span>
              <span className="numbers">24,120.30</span>
              <span className="numbers text-[var(--green)]">40.10 (0.17%)</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
