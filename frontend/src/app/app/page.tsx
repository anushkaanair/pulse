"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { api, setUserId, withRetry } from "@/lib/api";

export default function WatchlistsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-[var(--muted)]">Loading...</div>}>
      <WatchlistsRedirector />
    </Suspense>
  );
}

function WatchlistsRedirector() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // The initial resolve can genuinely fail (backend waking up, a transient
  // 5xx, a dropped connection). Without a visible failure + retry, this page
  // just spins forever — the worst possible first impression. `failed`
  // drives an honest error state; bumping `retryKey` re-runs the effect.
  const [failed, setFailed] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    const as = searchParams.get("as");
    if (as) {
      setUserId(as);
      try { sessionStorage.setItem("pulse-entered", "1"); } catch {}
      router.replace("/app");
      return;
    }

    let sawHomepage = false;
    try { sawHomepage = sessionStorage.getItem("pulse-entered") === "1"; } catch { sawHomepage = true; }
    if (!sawHomepage) {
      router.replace("/");
      return;
    }

    let cancelled = false;
    async function redirect() {
      try {
        // Retry the read of the list set — the one call standing between a
        // returning user and their dashboard.
        const lists = await withRetry(() => api.watchlists());
        if (cancelled) return;
        if (lists.length > 0) {
          router.replace(`/w/${lists[0].id}`);
        } else {
          // First-ever visit: no list yet. createWatchlist is a mutation, so
          // it is NOT wrapped in withRetry — a silent double-create would
          // leave two "My Watchlist"s. One attempt; on failure, offer retry.
          const newList = await api.createWatchlist("My Watchlist");
          if (!cancelled) router.replace(`/w/${newList.id}`);
        }
      } catch (err) {
        if (!cancelled) {
          console.error("Failed to open your watchlist:", err);
          setFailed(true);
        }
      }
    }

    setFailed(false);
    void redirect();
    return () => { cancelled = true; };
  }, [router, searchParams, retryKey]);

  if (failed) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-[var(--ground)] px-6 text-center">
        <p className="text-sm text-[var(--ink-2)]">Couldn&apos;t reach the market service just now.</p>
        <button
          onClick={() => { setFailed(false); setRetryKey((k) => k + 1); }}
          className="rounded-full bg-[var(--accent)] px-5 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-screen items-center justify-center bg-[var(--ground)]">
      <div className="dot-live h-3 w-3 rounded-full bg-[var(--accent)] text-[var(--accent)]"></div>
    </div>
  );
}
