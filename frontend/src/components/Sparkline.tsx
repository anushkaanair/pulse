import type { SparklinePoint } from "@/lib/api";

// A trend line, deliberately not a chart: no axes, no grid, no labels, no
// hover tooltip — glanceable, not interactive. That restraint is what keeps
// this from reopening the "no historical charts" scope cut in spirit.
export function Sparkline({ points, direction }: { points: SparklinePoint[] | undefined; direction: "up" | "down" | "flat" }) {
  if (!points || points.length < 2) return <span className="inline-block h-5 w-12" aria-hidden="true" />;

  const prices = points.map((p) => Number(p.price));
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = max - min || 1;
  const width = 48;
  const height = 20;
  const step = width / (prices.length - 1);
  const path = prices
    .map((price, i) => `${i === 0 ? "M" : "L"} ${(i * step).toFixed(1)} ${(height - ((price - min) / span) * height).toFixed(1)}`)
    .join(" ");

  const color = direction === "up" ? "var(--green)" : direction === "down" ? "var(--red)" : "var(--muted)";

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="inline-block align-middle" aria-hidden="true">
      <path d={path} fill="none" stroke={color} strokeOpacity={0.7} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
