import { describe, expect, it } from "vitest";
import { buildDigest, computeChanges, DEFAULT_MULTIPLIER, type EngineConfig, type EngineItem, type SnapshotPayload } from "../changes/engine.js";
import type { SymbolStats } from "../changes/stats.js";

const cfg: EngineConfig = {
  tickMs: 1000, zThreshold: 2, historyWindow: 50, absThresholdPct: 1.5,
  volumeSpikeMultiple: 2, gapPct: 2, sensitivityMultiplier: DEFAULT_MULTIPLIER,
};

// Defaults deliberately can't trigger DAY_HIGH/LOW_BREACHED or VOLUME_SPIKE
// by accident: dayHigh/dayLow are far outside any test's price moves, and
// item()/seen() volume match unless a test explicitly wants a spike. Tests
// that DO want an event override these fields directly — see the "events"
// test below.
function item(symbol: string, price: number, extra: Partial<EngineItem["quote"] & { sensitivity: EngineItem["sensitivity"] }> = {}): EngineItem {
  const { sensitivity = "normal", ...q } = extra;
  return {
    symbol, name: symbol, sensitivity,
    quote: { price: price.toFixed(4), prevClose: "100.0000", dayHigh: "200.0000", dayLow: "50.0000", volume: 1000, asOf: "2026-09-04T10:00:00.000Z", corrected: false, ...q },
  };
}
function seen(price: number, extra: Partial<SnapshotPayload[string]> = {}): SnapshotPayload[string] {
  return { price: price.toFixed(4), asOf: "2026-09-04T09:00:00.000Z", volume: 1000, dayHigh: "200.0000", dayLow: "50.0000", ...extra };
}
function stats(symbol: string, sigma: number | null, meanVolumePerTick = 10): Map<string, SymbolStats> {
  return new Map([[symbol, { symbol, sigma, sampleSize: 50, meanVolumePerTick }]]);
}

describe("computeChanges", () => {
  it("first visit: everything is 'none' with a baseline message", () => {
    const [r] = computeChanges(null, null, [item("TCS", 102)], stats("TCS", 0.001), cfg);
    expect(r.change.kind).toBe("none");
    expect(r.change.why).toMatch(/baseline/);
  });

  it("symbol added after checkpoint is 'new', never a fabricated move", () => {
    const [r] = computeChanges({}, 60_000, [item("TCS", 102)], stats("TCS", 0.001), cfg);
    expect(r.change.kind).toBe("new");
    expect(r.change.pctSincePrev).toBeNull();
  });

  it("same 2% move: meaningful after 1 minute, not after 5 days (√n scaling)", () => {
    const snap = { TCS: seen(100) };
    const st = stats("TCS", 0.001); // 0.1% per tick
    const soon = computeChanges(snap, 60_000, [item("TCS", 102)], st, cfg)[0];
    const later = computeChanges(snap, 5 * 24 * 3600_000, [item("TCS", 102)], st, cfg)[0];
    expect(soon.change.kind).toBe("move");
    expect(later.change.kind).toBe("none");
    expect(Math.abs(soon.change.zScore!)).toBeGreaterThan(Math.abs(later.change.zScore!));
  });

  it("same % move is noise for a volatile stock and news for a calm one", () => {
    const snap = { A: seen(100), B: seen(100) };
    const st = new Map([...stats("A", 0.0005), ...stats("B", 0.02)]);
    const [calm, wild] = computeChanges(snap, 5_000, [item("A", 101.5), item("B", 101.5)], st, cfg);
    expect(calm.symbol).toBe("A");
    expect(calm.change.kind).toBe("move");
    expect(wild.change.kind).toBe("none");
  });

  it("thin history → absolute threshold + low confidence", () => {
    const [r] = computeChanges({ X: seen(100) }, 5_000, [item("X", 102)], stats("X", null), cfg);
    expect(r.change.kind).toBe("move");
    expect(r.change.confidence).toBe("low");
    expect(r.change.zScore).toBeNull();
  });

  it("sensitivity: quiet suppresses, loud amplifies", () => {
    const st = stats("Q", 0.001); // 0.1%/tick, n=1 at elapsedMs=tickMs=1000 → z = pct/0.1
    // A 0.25% move is 2.5σ: clears normal's bar (2.0) but not quiet's (2.0×1.75=3.5).
    const quiet = computeChanges({ Q: seen(100) }, 1_000, [item("Q", 100.25, { sensitivity: "quiet" })], st, cfg)[0];
    const normal = computeChanges({ Q: seen(100) }, 1_000, [item("Q", 100.25)], st, cfg)[0];
    expect(quiet.change.kind).toBe("none");
    expect(normal.change.kind).toBe("move");

    // A 0.15% move is 1.5σ: clears loud's bar (2.0×0.6=1.2) but not normal's (2.0).
    const loud = computeChanges({ Q: seen(100) }, 1_000, [item("Q", 100.15, { sensitivity: "loud" })], st, cfg)[0];
    const normalSmall = computeChanges({ Q: seen(100) }, 1_000, [item("Q", 100.15)], st, cfg)[0];
    expect(loud.change.kind).toBe("move");
    expect(normalSmall.change.kind).toBe("none");
  });

  it("a trivial new high (drift, not a breakout) is NOT a meaningful event — regression for the checkpoint-then-immediate-poll bug", () => {
    // Same scenario that broke in the real server: fresh checkpoint at 100
    // with dayHigh 100, next tick nudges price+dayHigh to 100.13 (+0.13%,
    // 1.3σ at sigma=0.001) — below the 2σ move bar AND too small a breach
    // to count as a real "new high" event.
    const st = stats("S", 0.001);
    const [r] = computeChanges({ S: seen(100, { dayHigh: "100.0000" }) }, 1_000, [item("S", 100.13, { dayHigh: "100.13" })], st, cfg);
    expect(r.change.kind).toBe("none");
    expect(r.change.events).not.toContain("DAY_HIGH_BREACHED");
  });

  it("a genuine breakout above the old high IS a meaningful event", () => {
    const st = stats("S", 0.001);
    const [r] = computeChanges({ S: seen(100, { dayHigh: "100.0000" }) }, 1_000, [item("S", 100.5, { dayHigh: "100.5" })], st, cfg);
    expect(r.change.events).toContain("DAY_HIGH_BREACHED");
  });

  it("events fire independently of the move and are ranked above 'none'", () => {
    const snap = { E: seen(100, { dayHigh: "101.0000" }), N: seen(100) };
    const st = new Map([...stats("E", 0.01, 10), ...stats("N", 0.01, 10)]);
    const [first, second] = computeChanges(snap, 1_000, [
      item("N", 100.1),
      item("E", 100.1, { corrected: true, dayHigh: "105.0000", volume: 5000 }),
    ], st, cfg);
    expect(first.symbol).toBe("E");
    expect(first.change.kind).toBe("event");
    expect(first.change.events).toEqual(expect.arrayContaining(["CORRECTED", "DAY_HIGH_BREACHED", "VOLUME_SPIKE"]));
    expect(second.change.kind).toBe("none");
  });

  it("no quote yet → none, low confidence, no crash", () => {
    const [r] = computeChanges({ Z: seen(100) }, 1_000, [{ symbol: "Z", name: "Z", sensitivity: "normal", quote: null }], new Map(), cfg);
    expect(r.change.kind).toBe("none");
  });
});

describe("buildDigest", () => {
  it("summarises the top movers and counts the rest", () => {
    const snap = { A: seen(100), B: seen(100), C: seen(100) };
    const st = new Map([...stats("A", 0.001), ...stats("B", 0.001), ...stats("C", 0.001)]);
    const results = computeChanges(snap, 120_000, [item("A", 103), item("B", 100.01), item("C", 100.02)], st, cfg);
    const d = buildDigest(results, "checkpoint", 120_000);
    expect(d).toMatch(/^Since 2 min ago: 1 thing worth a look — A \+3\.00%/);
    expect(d).toMatch(/2 others: nothing meaningful\.$/);
  });
  it("says so when nothing changed", () => {
    expect(buildDigest([], "checkpoint", 3600_000)).toMatch(/nothing meaningful changed/);
  });
});
