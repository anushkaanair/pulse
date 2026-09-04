"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

// Deliberately minimal: app name, brand mark, and a light/dark toggle.
// The toggle writes data-theme on <html> and persists it; default is the
// system preference (no attribute), so first paint follows the OS.
export function Header() {
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);

  useEffect(() => {
    const saved = (typeof localStorage !== "undefined" && localStorage.getItem("smw-theme")) as "light" | "dark" | null;
    if (saved) { document.documentElement.setAttribute("data-theme", saved); setTheme(saved); }
    else { document.documentElement.setAttribute("data-theme", "light"); setTheme("light"); }
  }, []);

  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("smw-theme", next); } catch { /* private mode */ }
    setTheme(next);
  };

  return (
    <div className="sticky top-0 z-30 border-b border-[var(--line)] bg-[var(--ground)]/80 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-4 h-10 flex items-center gap-2.5">
        <Link href="/" className="flex items-center gap-2">
          <span
            className="flex items-center justify-center w-6 h-6 rounded-lg"
            style={{ background: "var(--accent)", boxShadow: "0 3px 10px -3px color-mix(in srgb, var(--accent) 60%, transparent), inset 0 1px 0 rgba(255,255,255,.35)" }}
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M2 11.5 5.5 7l3 2.5L14 4" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="font-semibold text-[13.5px] tracking-tight text-[var(--ink)]">Pulse</span>
        </Link>
        <button
          onClick={toggle}
          aria-label="Toggle light/dark theme"
          title="Toggle theme"
          className="ml-auto flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--line)] text-[var(--muted)] hover:text-[var(--ink)] hover:border-[var(--line-2)]"
        >
          {theme === "dark" ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z"/></svg>
          )}
        </button>
      </div>
    </div>
  );
}
