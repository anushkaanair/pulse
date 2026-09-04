"use client";

import Link from "next/link";
import { useState } from "react";
import { api, type FaultConfig } from "@/lib/api";

const enabled = process.env.NEXT_PUBLIC_SIM_ADMIN === "true";

export default function FaultsPage() {
  const [active, setActive] = useState<FaultConfig>({});
  if (!enabled) return <main className="mx-auto max-w-[880px] px-4 py-12 text-sm text-[var(--muted)]">Simulation controls are disabled.</main>;
  const update = async (config: FaultConfig) => setActive((await api.setFaults(config)).active);
  return <main className="mx-auto min-h-screen max-w-[880px] px-4 py-12"><Link href="/" className="text-sm underline underline-offset-4">Back to watchlists</Link><p className="mt-8 text-xs tracking-[0.16em] text-[var(--amber)] uppercase">Demo controls</p><h1 className="mt-2 text-[28px] font-medium">Market feed faults</h1><p className="mt-2 max-w-lg text-sm text-[var(--muted)]">Use these controls to demonstrate that delayed data stays visible and is never presented as fresh.</p><div className="mt-8 grid max-w-md gap-3">{(["outage", "outOfOrderPct", "duplicatePct", "correctionPct"] as const).map((key) => key === "outage" ? <label key={key} className="flex items-center justify-between border border-[var(--line)] p-3 text-sm">Feed outage<input type="checkbox" checked={Boolean(active.outage)} onChange={(event) => void update({ outage: event.target.checked })} /></label> : <label key={key} className="flex items-center justify-between border border-[var(--line)] p-3 text-sm"><span>{key.replace("Pct", " %")}</span><input className="numbers w-20 bg-transparent text-right outline-none" type="number" min="0" max="100" value={active[key] ?? 0} onChange={(event) => void update({ [key]: Number(event.target.value) })} /></label>)}</div></main>;
}
