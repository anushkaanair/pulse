import type { WatchlistItem } from "@/lib/api";

export function ConflictModal({ theirs, mine, onKeepMine, onKeepTheirs, onMerge }: { theirs: WatchlistItem[]; mine: string[]; onKeepMine: () => void; onKeepTheirs: () => void; onMerge: () => void }) {
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="conflict-title" className="fixed inset-0 z-40 grid place-items-center bg-black/60 p-4 backdrop-blur-sm">
      <section className="w-full max-w-lg rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] p-6 shadow-2xl">
        <p className="text-xs tracking-[0.16em] text-[var(--amber)] uppercase">Another edit arrived</p>
        <h2 id="conflict-title" className="mt-2 text-xl font-medium">Choose which list to keep</h2>
        <div className="mt-5 grid grid-cols-2 gap-5 text-sm">
          <div>
            <p className="font-medium">Their version</p>
            <ul className="mt-2 space-y-1 text-[var(--muted)]">{theirs.map((item) => <li key={item.symbol}>{item.symbol}</li>)}</ul>
          </div>
          <div>
            <p className="font-medium">Your pending edit</p>
            <ul className="mt-2 space-y-1 text-[var(--muted)]">{mine.map((symbol) => <li key={symbol}>{symbol}</li>)}</ul>
          </div>
        </div>
        <div className="mt-6 flex flex-wrap gap-2">
          <button onClick={onKeepMine} className="rounded-lg px-3.5 py-2 text-sm font-medium text-[#0b0d0e]" style={{ background: "linear-gradient(140deg, var(--amber-2), var(--amber))" }}>Keep mine</button>
          <button onClick={onMerge} className="rounded-lg border border-[var(--line-2)] px-3.5 py-2 text-sm hover:bg-[var(--surface-3)]">Merge</button>
          <button onClick={onKeepTheirs} className="px-3 py-2 text-sm text-[var(--muted)] underline underline-offset-4 hover:text-[var(--ink)]">Keep theirs</button>
        </div>
      </section>
    </div>
  );
}
