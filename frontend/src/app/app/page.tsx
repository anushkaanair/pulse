"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useEffect, useState } from "react";
import { MarketRail } from "@/components/MarketRail";
import { api, ApiRequestError, setUserId, switchUser, type WatchlistSummary } from "@/lib/api";

function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof ApiRequestError ? `${error.response.error} (${error.response.code})` : "Could not load watchlists.";
  return <p className="mt-4 text-sm text-[var(--red)]">{message}</p>;
}

export default function WatchlistsPage() {
  // useSearchParams needs a Suspense boundary at the page level (Next.js
  // build requirement — this page is entirely client-rendered anyway, so
  // the fallback below is never actually visible in practice).
  return (
    <Suspense fallback={null}>
      <WatchlistsPageInner />
    </Suspense>
  );
}

function WatchlistsPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [lists, setLists] = useState<WatchlistSummary[]>([]);
  const [previews, setPreviews] = useState<Record<string, { meaningful: number; movers: { symbol: string; pct: string; down: boolean }[] }>>({});
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<unknown>();
  // Gates rendering until the homepage-entry check below resolves, so a
  // direct/bookmarked hit on /app never flashes the dashboard before the
  // redirect fires.
  const [entered, setEntered] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const fetched = await api.watchlists();
      setLists(fetched); setError(undefined);
      // Per-list "what changed" preview so a card carries real signal at a
      // glance, not just a name — this is the product's whole point. A
      // failed preview must never break the list, so each is isolated.
      fetched.forEach(async (l) => {
        try {
          const { data } = await api.changes(l.id, 20);
          if (!data) return;
          const movers = data.items.filter((i) => i.change.pctSincePrev !== null)
            .sort((a, b) => Math.abs(Number(b.change.pctSincePrev)) - Math.abs(Number(a.change.pctSincePrev)))
            .slice(0, 3)
            .map((i) => ({ symbol: i.symbol, pct: i.change.pctSincePrev!, down: i.change.pctSincePrev!.startsWith("-") }));
          setPreviews((p) => ({ ...p, [l.id]: { meaningful: data.summary.meaningful, movers } }));
        } catch { /* preview is best-effort */ }
      });
    }
    catch (cause) { setError(cause); }
    finally { setLoading(false); }
  };
  useEffect(() => {
    // ?as=<id> impersonates a known user id — a one-click way to open a
    // seeded demo/reviewer account, instead of hand-editing localStorage
    // via devtools (Chrome's paste guard makes that needlessly fiddly for
    // what should be a one-line dev convenience). Strips the param from
    // the URL immediately so it isn't accidentally re-applied or shared.
    // It also intentionally bypasses the homepage-entry check below — a
    // shared reviewer link should open straight into the dashboard.
    const as = searchParams.get("as");
    if (as) {
      setUserId(as); router.replace("/app"); setEntered(true);
      // Persist the flag too — router.replace strips the param, which
      // re-runs this effect on the next render with `as` gone, and the
      // homepage-entry check below would otherwise fire on that pass and
      // bounce a fresh reviewer link straight back to "/".
      try { sessionStorage.setItem("pulse-entered", "1"); } catch { /* private mode etc. */ }
      void load(); return;
    }

    // A direct or bookmarked hit on /app, without ever having gone through
    // "/" first (in this browser tab), bounces back to the homepage — so
    // "Get started" stays the one real front door into the product.
    let sawHomepage = false;
    try { sawHomepage = sessionStorage.getItem("pulse-entered") === "1"; } catch { sawHomepage = true; }
    if (!sawHomepage) { router.replace("/"); return; }
    setEntered(true);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    try { const list = await api.createWatchlist(name.trim()); setLists((old) => [{ id: list.id, name: list.name, version: list.version, itemCount: 0, updatedAt: new Date().toISOString() }, ...old]); setName(""); }
    catch (cause) { setError(cause); }
    finally { setCreating(false); }
  }

  const totalTracked = lists.reduce((n, l) => n + l.itemCount, 0);

  if (!entered) return null;

  return (
    <>
    <MarketRail />
    <main className="mx-auto max-w-[1180px] px-4 pt-9 pb-12">
      <header className="rise flex flex-wrap items-start justify-between gap-6">
        <div>
          <p className="m-0 text-[10.5px] uppercase tracking-[.18em]" style={{ color: "var(--amber)" }}>Market watchlist</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">What deserves attention</h1>
          <p className="mt-2.5 max-w-[560px] text-sm leading-relaxed text-[var(--ink-2)]">
            Not another price table. We remember exactly what you saw last time, then weigh every move against that stock&apos;s own normal swings and its sector&apos;s — so a quiet stock twitching gets flagged, and a volatile one doing the same doesn&apos;t.
          </p>
        </div>
        <div className="flex items-center gap-4 pt-1">
          {lists.length > 0 ? (
            <span className="text-xs text-[var(--muted)]">
              <span className="numbers font-semibold text-[var(--ink)]">{lists.length}</span> {lists.length === 1 ? "list" : "lists"} · <span className="numbers font-semibold text-[var(--ink)]">{totalTracked}</span> stocks
            </span>
          ) : null}
          <button onClick={() => { switchUser(); void load(); }} className="text-xs text-[var(--muted)] underline underline-offset-4 hover:text-[var(--ink)]">Switch user</button>
        </div>
      </header>

      <section className="mt-8 grid gap-6" style={{ gridTemplateColumns: "minmax(0,1fr) 300px" }}>
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Your watchlists</h2>

          {loading ? <p className="mt-5 text-sm text-[var(--muted)]">Loading watchlists…</p> : null}

          {!loading && lists.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-[var(--line)] p-14 text-center" style={{ background: "linear-gradient(180deg, var(--surface-2), var(--surface))" }}>
              <p className="m-0 text-[15px] font-medium">No watchlist yet.</p>
              <p className="mx-auto mt-1.5 max-w-[320px] text-sm leading-relaxed text-[var(--muted)]">Create one and add the stocks you actually check in on. Your first visit becomes the baseline.</p>
            </div>
          ) : null}

          {!loading && lists.length > 0 ? (
            <ul className="mt-4 grid gap-3 p-0 list-none" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))" }}>
              {lists.map((list, i) => {
                const pv = previews[list.id];
                return (
                <li key={list.id} className="rise" style={{ animationDelay: `${i * 55}ms` }}>
                  <Link href={`/w/${list.id}`} className="flex h-full w-full flex-col rounded-2xl border border-[var(--line)] p-4 text-left transition-colors hover:border-[var(--line-2)]" style={{ background: "linear-gradient(180deg, var(--surface-2), var(--surface))" }}>
                    <span className="flex w-full items-start justify-between gap-3">
                      <span className="min-w-0">
                        <span className="block text-[15px] font-semibold tracking-tight">{list.name}</span>
                        <span className="mt-0.5 block text-[11.5px] text-[var(--muted)]">{list.itemCount} {list.itemCount === 1 ? "stock" : "stocks"} · updated {new Date(list.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                      </span>
                      {pv ? (
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${pv.meaningful > 0 ? "bg-[var(--amber)]/15 text-[var(--amber)]" : "bg-[var(--green)]/12 text-[var(--green)]"}`}>
                          {pv.meaningful > 0 ? `${pv.meaningful} worth a look` : "Caught up"}
                        </span>
                      ) : <span aria-hidden="true" className="text-[var(--muted)]">→</span>}
                    </span>
                    <span className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-[var(--line)] pt-3">
                      {pv && pv.movers.length > 0 ? pv.movers.map((m) => (
                        <span key={m.symbol} className="numbers rounded-md bg-[var(--surface-3)] px-1.5 py-0.5 text-[10.5px]">
                          <span className="text-[var(--ink-2)]">{m.symbol}</span>{" "}
                          <span style={{ color: m.down ? "var(--red)" : "var(--green)" }}>{m.pct}%</span>
                        </span>
                      )) : (
                        <span className="text-[11px] text-[var(--muted)]">{list.itemCount === 0 ? "No stocks yet" : pv ? "Nothing moved since your baseline" : "Loading movement…"}</span>
                      )}
                    </span>
                  </Link>
                </li>
                );
              })}
            </ul>
          ) : null}
          <ErrorText error={error} />
        </div>

        <aside className="flex flex-col gap-4">
          <form onSubmit={create} className="h-fit rounded-2xl border border-[var(--line)] p-5" style={{ background: "linear-gradient(180deg, var(--surface-2), var(--surface))" }}>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">New watchlist</h2>
            <label htmlFor="watchlist-name" className="sr-only">Watchlist name</label>
            <input
              id="watchlist-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Long term"
              className="mt-4 w-full rounded-xl border border-[var(--line-2)] bg-[var(--ground-2)] px-3.5 py-2.5 text-sm outline-none transition-colors placeholder:text-[var(--muted)] focus:border-[var(--amber)]"
            />
            <button disabled={creating || !name.trim()} className="mt-3.5 w-full rounded-xl py-2.5 text-[14px] font-semibold text-[#0b0d0e] disabled:opacity-30 transition-opacity" style={{ background: "linear-gradient(140deg, var(--amber-2), var(--amber))" }}>
              {creating ? "Creating…" : "Create watchlist"}
            </button>
            <p className="mt-2.5 mb-0 text-[11px] leading-relaxed text-[var(--muted)]">Your first visit to a new list becomes its baseline — nothing is reported as a change until then.</p>
          </form>
        </aside>
      </section>
    </main>
    </>
  );
}
