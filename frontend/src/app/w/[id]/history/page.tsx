"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api, ApiRequestError, type TimelineDiffResponse, type TimelineVisit } from "@/lib/api";

function relative(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.round(ms / 60_000);
  if (m < 1) return "moments ago";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleDateString([], { weekday: "long", hour: "2-digit", minute: "2-digit" });
}

export default function HistoryPage() {
  const { id } = useParams<{ id: string }>();
  const [visits, setVisits] = useState<TimelineVisit[]>();
  const [selected, setSelected] = useState<string>();
  const [diff, setDiff] = useState<TimelineDiffResponse>();
  const [error, setError] = useState<unknown>();

  useEffect(() => {
    void api.timeline(id).then((response) => {
      setVisits(response.visits);
      if (response.visits.length) setSelected(response.visits[0].snapshotId);
    }).catch(setError);
  }, [id]);

  useEffect(() => {
    if (!selected) return;
    void api.timelineDiff(id, selected).then(setDiff).catch(setError);
  }, [id, selected]);

  if (error) {
    const message = error instanceof ApiRequestError ? `${error.response.error} (${error.response.code})` : "Could not load history.";
    return <main className="mx-auto max-w-[880px] px-4 py-12"><Link href={`/w/${id}`} className="text-sm underline underline-offset-4 hover:text-[var(--ink)]">Back</Link><p className="mt-8 text-sm text-[var(--red)]">{message}</p></main>;
  }
  if (!visits) return <main className="mx-auto max-w-[880px] px-4 py-12 text-sm text-[var(--muted)]">Loading history…</main>;

  return (
    <main className="min-h-screen">
      <div className="mx-auto max-w-[880px] px-4 py-8 sm:px-8">
        <Link href={`/w/${id}`} className="text-xs text-[var(--muted)] underline underline-offset-4 hover:text-[var(--ink)]">Watchlist</Link>
        <h1 className="mt-2 text-[28px] font-semibold tracking-tight">History</h1>
        <p className="mt-2 max-w-md text-sm text-[var(--muted)]">A plain comparison between two of your past visits — not a significance judgment, just what the price was and what it became.</p>

        {visits.length === 0 ? (
          <p className="mt-8 rounded-2xl border border-[var(--line)] p-6 text-sm text-[var(--muted)]" style={{ background: "linear-gradient(180deg, var(--surface-2), var(--surface))" }}>No visits recorded yet — this fills in once you&apos;ve marked the watchlist as seen more than once.</p>
        ) : (
          <div className="mt-8 grid gap-8 md:grid-cols-[200px_1fr]">
            <ul className="space-y-1 list-none p-0">
              {visits.map((visit) => (
                <li key={visit.snapshotId}>
                  <button
                    onClick={() => setSelected(visit.snapshotId)}
                    className="w-full rounded-lg border-l-2 px-3 py-2 text-left text-sm transition-colors"
                    style={selected === visit.snapshotId ? { borderColor: "var(--amber)", color: "var(--ink)", background: "var(--surface-2)" } : { borderColor: "var(--line)", color: "var(--muted)" }}
                  >
                    {relative(visit.takenAt)}
                  </button>
                </li>
              ))}
            </ul>

            <div>
              {!diff ? (
                <p className="text-sm text-[var(--muted)]">Loading comparison…</p>
              ) : diff.items.length === 0 ? (
                <p className="text-sm text-[var(--muted)]">Nothing to compare — this was your first visit.</p>
              ) : (
                <>
                  <p className="text-xs text-[var(--muted)]">
                    {diff.comparedTo ? `Compared to ${relative(diff.comparedTo)}` : "Your first visit — no earlier comparison."}
                  </p>
                  <ul className="mt-3 divide-y divide-[var(--line)] rounded-2xl border border-[var(--line)] overflow-hidden" style={{ background: "linear-gradient(180deg, var(--surface-2), var(--surface))" }}>
                    {diff.items.map((row) => (
                      <li key={row.symbol} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm">
                        <div className="min-w-28 flex-1">
                          <span className="font-medium">{row.symbol}</span>
                          <span className="ml-2 text-xs text-[var(--muted)]">{row.name}</span>
                        </div>
                        {row.status === "added" ? (
                          <span className="rounded-full border border-[var(--line-2)] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--muted)]">+ added</span>
                        ) : row.status === "removed" ? (
                          <span className="rounded-full border border-[var(--line-2)] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--muted)]">− removed</span>
                        ) : (
                          <div className="numbers flex items-center gap-2 text-right">
                            <span className="text-[var(--muted)]">{row.priceBefore}</span>
                            <span className="text-[var(--muted)]">→</span>
                            <span>{row.priceAfter}</span>
                            {row.pct ? <span style={{ color: row.pct.startsWith("-") ? "var(--red)" : "var(--green)" }}>{row.pct}%</span> : null}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
