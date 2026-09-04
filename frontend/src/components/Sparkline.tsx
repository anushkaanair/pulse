import type { SparklinePoint } from "@/lib/api";

// Recent price history as a plain line, no axes, no fill — the shape
// matters, not the exact values. Fewer than 2 points has no shape to draw,
// so it renders nothing rather than a flat or fabricated line.
export function Sparkline({ points, direction, scale = 1 }: { points: SparklinePoint[] | undefined; direction: "up" | "down" | "flat"; scale?: number }) {
  if (!points || points.length < 2) return <span className="inline-block" style={{ width: 48 * scale, height: 20 * scale }} aria-hidden="true" />;
  const prices = points.map((p) => Number(p.price));
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = max - min || 1;
  const w = 48, h = 20, step = w / (prices.length - 1);
  const d = prices.map((p, i) => `${i === 0 ? "M" : "L"} ${(i * step).toFixed(1)} ${(h - ((p - min) / span) * h).toFixed(1)}`).join(" ");
  const color = direction === "up" ? "var(--green)" : direction === "down" ? "var(--red)" : "var(--muted)";
  return (
    <svg width={w * scale} height={h * scale} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" className="inline-block align-middle">
      <path d={d} fill="none" stroke={color} strokeOpacity={0.75} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
