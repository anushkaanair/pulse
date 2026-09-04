import type { ChangeItem } from "@/lib/api";

export function MarketTrends({ items }: { items: ChangeItem[] }) {
  const moved = items.filter((i) => i.change.pctSincePrev !== null)
    .sort((a, b) => Math.abs(Number(b.change.pctSincePrev)) - Math.abs(Number(a.change.pctSincePrev)));
  if (moved.length === 0) return null;
  const gainers = moved.filter((i) => !i.change.pctSincePrev!.startsWith("-")).slice(0, 3);
  const losers = moved.filter((i) => i.change.pctSincePrev!.startsWith("-")).slice(0, 3);
  const adv = items.filter((i) => i.change.pctSincePrev && !i.change.pctSincePrev.startsWith("-")).length;
  const dec = items.filter((i) => i.change.pctSincePrev?.startsWith("-")).length;
  const total = adv + dec || 1;

  const List = ({ label, rows, tone }: { label: string; rows: ChangeItem[]; tone: string }) => rows.length === 0 ? null : (
    <div className="mt-4 border-t border-[var(--line)] pt-3.5">
      <p className="m-0 text-[10.5px] uppercase tracking-[.08em] text-[var(--muted)]">{label}</p>
      <dl className="mt-2 flex flex-col gap-1.5">
        {rows.map((i) => (
          <div key={i.symbol} className="flex items-center justify-between gap-2 text-[12.5px]">
            <dt className="font-medium text-[var(--ink-2)]">{i.symbol}</dt>
            <dd className="numbers m-0 font-semibold" style={{ color: tone }}>{i.change.pctSincePrev}%</dd>
          </div>
        ))}
      </dl>
    </div>
  );

  return (
    <div className="rounded-2xl border border-[var(--line)] bg-gradient-to-b from-[var(--surface-2)] to-[var(--surface)] p-5">
      <h3 className="m-0 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Your market</h3>
      <div className="mt-3.5">
        <div className="flex h-1.5 overflow-hidden rounded-full bg-[var(--line)]">
          <span style={{ width: `${(adv / total) * 100}%`, background: "var(--green)" }} />
          <span style={{ width: `${(dec / total) * 100}%`, background: "var(--red)" }} />
        </div>
        <div className="mt-2 flex justify-between text-[11px]">
          <span style={{ color: "var(--green)" }}>{adv} advancing</span>
          <span style={{ color: "var(--red)" }}>{dec} declining</span>
        </div>
      </div>
      <List label="Top gainers" rows={gainers} tone="var(--green)" />
      <List label="Top decliners" rows={losers} tone="var(--red)" />
    </div>
  );
}
