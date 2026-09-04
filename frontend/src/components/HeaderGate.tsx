"use client";

import { usePathname } from "next/navigation";
import { Header } from "@/components/Header";

// The public landing page ("/") has its own nav (Groww-style marketing
// header); the logged-in app pages share this Header + theme toggle.
export function HeaderGate() {
  const pathname = usePathname();
  if (pathname === "/") return null;
  return <Header />;
}
