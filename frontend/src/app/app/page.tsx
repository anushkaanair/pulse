"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useEffect, useState } from "react";
import { MarketRail } from "@/components/MarketRail";
import { api, ApiRequestError, setUserId, type ChangeItem, type WatchlistSummary } from "@/lib/api";

function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof ApiRequestError ? `${error.response.error} (${error.response.code})` : "Could not load watchlists.";
  return <p className="mt-4 text-sm text-[var(--red)]">{message}</p>;
}

// "Created 3 days ago" / "Last visited 40m ago" — the exact clock the
// engine's own "since you last looked" depends on, so it's worth getting
// right here rather than reusing a vague "updated" label for three
// different meanings (item edit, last visit, live data) at once.
function relativeTime(iso: string | null): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.round(ms / 60000);
  if (m < 1) return "moments ago";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

interface Preview { meaningful: number; movers: { symbol: string; pct: string; down: boolean }[]; lastVisitedAt: string | null; firstVisit: boolean }

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
  const [archived, setArchived] = useState<WatchlistSummary[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [previews, setPreviews] = useState<Record<string, Preview>>({});
  const [tickerItems, setTickerItems] = useState<ChangeItem[]>([]);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<unknown>();
  const [entered, setEntered] = useState(false);

  // Per-card "⋯" menu + its rename/delete actions.
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<WatchlistSummary | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<WatchlistSummary | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string>();

  const load = async () => {
    setLoading(true);
    try {
      const [fetched, archivedFetched] = await Promise.all([api.watchlists(), api.watchlists(true)]);
      setLists(fetched); setArchived(archivedFetched.filter((l) => l.archivedAt)); setError(undefined);
      // Per-list "what changed" preview so a card carries real signal at a
      // glance, not just a name — this is the product's whole point. A
      // failed preview must never break the list, so each is isolated.
      // The aggregated `tickerItems` feed the global market rail below —
      // real tracked stocks across every list, not an empty/default prop.
      // The updater below derives "already have this symbol" from `cur`
      // (previous state) itself rather than an outer mutable Set — React
      // invokes state-updater functions twice in dev Strict Mode to catch
      // exactly this kind of impurity, and a Set mutated as a side effect
      // inside the updater silently ends up empty on the second (real)
      // invocation, which was found live: the ticker stayed on "No stocks
      // tracked yet" even with real tracked stocks.
      fetched.forEach(async (l) => {
        try {
          const { data } = await api.changes(l.id, 20);
          if (!data) return;
          const movers = data.items.filter((i) => i.change.pctSincePrev !== null)
            .sort((a, b) => Math.abs(Number(b.change.pctSincePrev)) - Math.abs(Number(a.change.pctSincePrev)))
            .slice(0, 3)
            .map((i) => ({ symbol: i.symbol, pct: i.change.pctSincePrev!, down: i.change.pctSincePrev!.startsWith("-") }));
          setPreviews((p) => ({ ...p, [l.id]: { meaningful: data.summary.meaningful, movers, lastVisitedAt: data.baseline.takenAt, firstVisit: data.baseline.kind === "first-visit" } }));
          setTickerItems((cur) => {
            const existing = new Set(cur.map((i) => i.symbol));
            const fresh = data.items.filter((i) => i.quote && !existing.has(i.symbol));
            return fresh.length ? [...cur, ...fresh] : cur;
          });
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
    setCreating(true); setError(undefined);
    try { const list = await api.createWatchlist(name.trim()); setLists((old) => [...old, { id: list.id, name: list.name, version: list.version, itemCount: 0, updatedAt: new Date().toISOString(), createdAt: new Date().toISOString(), archivedAt: null }]); setName(""); }
    catch (cause) { setError(cause); }
    finally { setCreating(false); }
  }

  const openRename = (list: WatchlistSummary) => { setMenuFor(null); setActionError(undefined); setRenameTarget(list); setRenameValue(list.name); };
  const submitRename = async () => {
    if (!renameTarget || !renameValue.trim()) return;
    setActionBusy(true); setActionError(undefined);
    try { const updated = await api.renameWatchlist(renameTarget.id, renameValue.trim()); setLists((old) => old.map((l) => l.id === updated.id ? { ...l, name: updated.name } : l)); setRenameTarget(null); }
    catch (cause) { setActionError(cause instanceof ApiRequestError ? cause.response.error : "Could not rename this watchlist."); }
    finally { setActionBusy(false); }
  };
  const toggleArchive = async (list: WatchlistSummary, next: boolean) => {
    setMenuFor(null); setActionBusy(true);
    try {
      await api.setArchived(list.id, next);
      if (next) { setLists((old) => old.filter((l) => l.id !== list.id)); setArchived((old) => [...old, { ...list, archivedAt: new Date().toISOString() }]); }
      else { setArchived((old) => old.filter((l) => l.id !== list.id)); setLists((old) => [...old, { ...list, archivedAt: null }]); }
    } catch (cause) { setError(cause); }
    finally { setActionBusy(false); }
  };
  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setActionBusy(true); setActionError(undefined);
    try {
      await api.deleteWatchlist(deleteTarget.id);
      setLists((old) => old.filter((l) => l.id !== deleteTarget.id));
      setArchived((old) => old.filter((l) => l.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (cause) { setActionError(cause instanceof ApiRequestError ? cause.response.error : "Could not delete this watchlist."); }
    finally { setActionBusy(false); }
  };

  const totalTracked = lists.reduce((n, l) => n + l.itemCount, 0);
  const worthALookCount = lists.filter((l) => (previews[l.id]?.meaningful ?? 0) > 0).length;

  if (!entered) return null;

  return (
    <>
    <MarketRail items={tickerItems} />
    <main className="mx-auto max-w-[1180px] px-4 pt-9 pb-12">
      <header className="rise flex flex-wrap items-start justify-between gap-6">
        <div>
          <p className="m-0 text-[10.5px] uppercase tracking-[.18em]" style={{ color: "var(--amber)" }}>Market watchlist</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">What deserves attention</h1>
          <p className="mt-2.5 max-w-[560px] text-sm leading-relaxed text-[var(--ink-2)]">
            Not another price table. We remember exactly what you saw last time, then weigh every move against that stock&apos;s own normal swings and its sector&apos;s — so a quiet stock twitching gets flagged, and a volatile one doing the same doesn&apos;t.
          </p>
          {!loading && lists.length > 0 ? (
            <p className="mt-3 mb-0 text-sm font-medium">
              <span style={{ color: worthALookCount > 0 ? "var(--urgent)" : "var(--green)" }}>{worthALookCount} of {lists.length} {lists.length === 1 ? "list" : "lists"}</span>{" "}
              <span className="text-[var(--muted)]">worth a look</span>
            </p>
          ) : null}
        </div>
        {lists.length > 0 ? (
          <span className="pt-1 text-xs text-[var(--muted)]">
            <span className="numbers font-semibold text-[var(--ink)]">{lists.length}</span> {lists.length === 1 ? "list" : "lists"} · <span className="numbers font-semibold text-[var(--ink)]">{totalTracked}</span> stocks
          </span>
        ) : null}
      </header>

      <section className="mt-8 grid gap-6" style={{ gridTemplateColumns: "minmax(0,1fr) 300px" }}>
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Your watchlists</h2>

          {loading ? <p className="mt-5 text-sm text-[var(--muted)]">Loading watchlists…</p> : null}

          {!loading && lists.length === 0 && archived.length === 0 ? (
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
                <li key={list.id} className="rise relative flex h-full flex-col rounded-2xl border border-[var(--line)] p-4 transition-colors hover:border-[var(--line-2)]" style={{ background: "linear-gradient(180deg, var(--surface-2), var(--surface))", animationDelay: `${i * 55}ms` }}>
                  <Link href={`/w/${list.id}`} className="block">
                    <span className="flex w-full items-start justify-between gap-3">
                      <span className="min-w-0">
                        <span className="block truncate pr-5 text-[15px] font-semibold tracking-tight">{list.name}</span>
                        <span className="mt-0.5 block text-[11.5px] text-[var(--muted)]">
                          {list.itemCount} {list.itemCount === 1 ? "stock" : "stocks"} · Created {relativeTime(list.createdAt)}
                        </span>
                        <span className="mt-0.5 block text-[11.5px] text-[var(--muted)]">
                          {pv ? (pv.firstVisit ? "Not visited yet" : `Last visited ${relativeTime(pv.lastVisitedAt)}`) : "…"}
                        </span>
                      </span>
                      {pv ? (
                        <span
                          className="shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold"
                          style={pv.meaningful > 0 ? { background: "color-mix(in srgb, var(--urgent) 15%, transparent)", color: "var(--urgent)" } : { background: "color-mix(in srgb, var(--green) 12%, transparent)", color: "var(--green)" }}
                        >
                          {pv.meaningful > 0 ? `${pv.meaningful} worth a look` : "Caught up"}
                        </span>
                      ) : <span aria-hidden="true" className="text-[var(--muted)]">→</span>}
                    </span>
                  </Link>

                  {/* Deep-linking chips: siblings of the card's main Link,
                      not nested inside it — an <a> inside an <a> is invalid
                      HTML and would break click targeting. */}
                  <span className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-[var(--line)] pt-3">
                    {pv && pv.movers.length > 0 ? pv.movers.map((m) => (
                      <Link
                        key={m.symbol} href={`/w/${list.id}?symbol=${m.symbol}`}
                        className="numbers rounded-md bg-[var(--surface-3)] px-1.5 py-0.5 text-[10.5px] transition-colors hover:bg-[var(--line-2)]"
                        title={`Jump to ${m.symbol} in ${list.name}`}
                      >
                        <span className="text-[var(--ink-2)]">{m.symbol}</span>{" "}
                        <span style={{ color: m.down ? "var(--red)" : "var(--green)" }}>{m.pct}%</span>
                      </Link>
                    )) : list.itemCount === 0 ? (
                      <Link href={`/w/${list.id}`} className="text-[11px] font-medium underline underline-offset-2" style={{ color: "var(--amber)" }}>
                        No stocks yet — add your first →
                      </Link>
                    ) : (
                      <span className="text-[11px] text-[var(--muted)]">{pv ? "Nothing moved since your baseline" : "Loading movement…"}</span>
                    )}
                  </span>

                  <div className="absolute right-3 top-3">
                    <button
                      type="button" aria-label={`Options for ${list.name}`}
                      onClick={() => setMenuFor((cur) => cur === list.id ? null : list.id)}
                      className="flex h-6 w-6 items-center justify-center rounded-full text-[var(--muted)] transition-colors hover:bg-[var(--surface-3)] hover:text-[var(--ink)]"
                    >
                      <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><circle cx="3" cy="8" r="1.5" /><circle cx="8" cy="8" r="1.5" /><circle cx="13" cy="8" r="1.5" /></svg>
                    </button>
                    {menuFor === list.id ? (
                      <>
                        <div className="fixed inset-0 z-30" onClick={() => setMenuFor(null)} />
                        <div className="absolute right-0 top-7 z-40 w-36 overflow-hidden rounded-xl border border-[var(--line)] py-1 shadow-lg" style={{ background: "var(--surface)" }}>
                          <button onClick={() => openRename(list)} className="block w-full px-3 py-2 text-left text-xs hover:bg-[var(--surface-3)]">Rename</button>
                          <button onClick={() => void toggleArchive(list, true)} className="block w-full px-3 py-2 text-left text-xs hover:bg-[var(--surface-3)]">Archive</button>
                          <button onClick={() => { setMenuFor(null); setActionError(undefined); setDeleteTarget(list); }} className="block w-full px-3 py-2 text-left text-xs text-[var(--red)] hover:bg-[var(--surface-3)]">Delete</button>
                        </div>
                      </>
                    ) : null}
                  </div>
                </li>
                );
              })}
            </ul>
          ) : null}

          {archived.length > 0 ? (
            <div className="mt-4">
              <button onClick={() => setShowArchived((v) => !v)} className="text-xs text-[var(--muted)] underline underline-offset-4 hover:text-[var(--ink)]">
                {showArchived ? "Hide" : "Show"} {archived.length} archived
              </button>
              {showArchived ? (
                <ul className="mt-3 grid gap-2 p-0 list-none" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))" }}>
                  {archived.map((list) => (
                    <li key={list.id} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--line)] px-3.5 py-2.5 opacity-70">
                      <span className="min-w-0 truncate text-[13px]">{list.name}</span>
                      <span className="flex shrink-0 items-center gap-2">
                        <button onClick={() => void toggleArchive(list, false)} className="text-[11px] font-medium underline underline-offset-2" style={{ color: "var(--amber)" }}>Unarchive</button>
                        <button onClick={() => { setActionError(undefined); setDeleteTarget(list); }} className="text-[11px] font-medium text-[var(--red)] underline underline-offset-2">Delete</button>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
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

    {renameTarget ? (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(10,10,12,.55)" }} onClick={() => !actionBusy && setRenameTarget(null)}>
        <div role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()} className="w-full max-w-[360px] rounded-2xl border border-[var(--line)] p-6" style={{ background: "var(--surface)" }}>
          <h2 className="m-0 text-[17px] font-semibold tracking-tight">Rename watchlist</h2>
          <input
            autoFocus value={renameValue} maxLength={64} onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && renameValue.trim() && !actionBusy) void submitRename(); }}
            className="mt-4 w-full rounded-xl border border-[var(--line-2)] bg-[var(--ground-2)] px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-[var(--amber)]"
          />
          {actionError ? <p className="mt-2 mb-0 text-xs text-[var(--red)]">{actionError}</p> : null}
          <div className="mt-4 flex gap-2">
            <button onClick={() => setRenameTarget(null)} className="flex-1 rounded-xl border border-[var(--line-2)] py-2.5 text-[13px] font-medium">Cancel</button>
            <button onClick={() => void submitRename()} disabled={!renameValue.trim() || actionBusy} className="flex-1 rounded-xl py-2.5 text-[13px] font-semibold text-[#0b0d0e] disabled:opacity-30" style={{ background: "linear-gradient(140deg, var(--amber-2), var(--amber))" }}>
              {actionBusy ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    ) : null}

    {deleteTarget ? (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(10,10,12,.55)" }} onClick={() => !actionBusy && setDeleteTarget(null)}>
        <div role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()} className="w-full max-w-[360px] rounded-2xl border border-[var(--line)] p-6" style={{ background: "var(--surface)" }}>
          <h2 className="m-0 text-[17px] font-semibold tracking-tight">Delete &quot;{deleteTarget.name}&quot;?</h2>
          <p className="mt-2 mb-0 text-sm text-[var(--muted)]">This permanently removes the list and its visit history. This can&apos;t be undone.</p>
          {actionError ? <p className="mt-2 mb-0 text-xs text-[var(--red)]">{actionError}</p> : null}
          <div className="mt-4 flex gap-2">
            <button onClick={() => setDeleteTarget(null)} className="flex-1 rounded-xl border border-[var(--line-2)] py-2.5 text-[13px] font-medium">Cancel</button>
            <button onClick={() => void confirmDelete()} disabled={actionBusy} className="flex-1 rounded-xl py-2.5 text-[13px] font-semibold text-white disabled:opacity-40" style={{ background: "var(--red)" }}>
              {actionBusy ? "Deleting…" : "Delete"}
            </button>
          </div>
        </div>
      </div>
    ) : null}
    </>
  );
}
