"use client";

import { usePathname } from "next/navigation";
import { Header } from "@/components/Header";
import { ProductTour } from "@/components/ProductTour";

// The public landing page ("/") has its own nav (Groww-style marketing
// header); the logged-in app pages share this Header + theme toggle.
// ProductTour is mounted alongside it (not inside any single route) so it
// survives client-side navigation across /w/[id] → /history → /paper —
// it no-ops on its own when the current path isn't a watchlist page.
export function HeaderGate() {
  const pathname = usePathname();
  if (pathname === "/") return null;
  return (
    <>
      <Header />
      <ProductTour />
    </>
  );
}
