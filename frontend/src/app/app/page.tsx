"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
import { api, setUserId } from "@/lib/api";

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

  useEffect(() => {
    const as = searchParams.get("as");
    if (as) {
      setUserId(as);
      try { sessionStorage.setItem("pulse-entered", "1"); } catch {}
      // Clear the 'as' parameter from URL
      router.replace("/app");
      return; // The re-render will handle the actual redirect
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
        const lists = await api.watchlists();
        if (cancelled) return;
        
        if (lists.length > 0) {
          // Go to the first list
          router.replace(`/w/${lists[0].id}`);
        } else {
          // Create a default list and go to it
          const newList = await api.createWatchlist("My Watchlist");
          if (!cancelled) router.replace(`/w/${newList.id}`);
        }
      } catch (err) {
        console.error("Failed to redirect to watchlist:", err);
      }
    }
    
    void redirect();
    
    return () => { cancelled = true; };
  }, [router, searchParams]);

  return (
    <div className="flex h-screen items-center justify-center bg-[var(--ground)]">
      <div className="dot-live h-3 w-3 rounded-full bg-[var(--accent)] text-[var(--accent)]"></div>
    </div>
  );
}
