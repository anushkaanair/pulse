import { describe, expect, it } from "vitest";
import { buildDigest, computeChanges, DEFAULT_MULTIPLIER, type EngineConfig, type EngineItem, type SnapshotPayload } from "../changes/engine.js";
import type { SymbolStats } from "../changes/stats.js";

const ONE_SESSION_MS = 6.25 * 3_600_000; // production default
const cfg: EngineConfig = {
  tickMs: 1000, zThreshold: 2, historyWindow: 50, absThresholdPct: 1.5,
  volumeSpikeMultiple: 2, gapPct: 2, sensitivityMultiplier: DEFAULT_MULTIPLIER,
  maxHorizonMs: ONE_SESSION_MS,
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
function stats(
  symbol: string, sigma: number | null, meanVolumePerTick = 10,
  beta: number | null = null, idioSigma: number | null = null,
): Map<string, SymbolStats> {
  return new Map([[symbol, { symbol, sigma, sampleSize: 50, meanVolumePerTick, beta, idioSigma }]]);
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

  // The horizon cap (see changeFor()'s comment). σ is fit on 50 ticks;
  // extrapolating it across days by √n produced a bar no real move could
  // clear, so a genuinely large move after a long absence was reported as
  // "nothing meaningful changed" — the catch-up screen telling you less the
  // longer you were away.
  describe("away-horizon cap", () => {
    // ~2%/day daily vol expressed per tick, the same realistic scale the
    // digest tests use.
    const REALISTIC = 0.00013;

    it("an 8% move over a long weekend is meaningful — uncapped √n scaling buried it", () => {
      const snap = { TCS: seen(100) };
      const st = stats("TCS", REALISTIC);
      const [r] = computeChanges(snap, 3 * 86_400_000, [item("TCS", 108)], st, cfg);
      expect(r.change.kind).toBe("move");
    });

    it("the bar still grows with absence up to the cap", () => {
      const snap = { TCS: seen(100) };
      const st = stats("TCS", REALISTIC);
      const oneMin = computeChanges(snap, 60_000, [item("TCS", 108)], st, cfg)[0];
      const oneHour = computeChanges(snap, 3_600_000, [item("TCS", 108)], st, cfg)[0];
      expect(Math.abs(oneMin.change.zScore!)).toBeGreaterThan(Math.abs(oneHour.change.zScore!));
    });

    it("past the cap the bar stops growing: 3 days and 3 weeks score identically", () => {
      const snap = { TCS: seen(100) };
      const st = stats("TCS", REALISTIC);
      const days = computeChanges(snap, 3 * 86_400_000, [item("TCS", 108)], st, cfg)[0];
      const weeks = computeChanges(snap, 21 * 86_400_000, [item("TCS", 108)], st, cfg)[0];
      expect(days.change.zScore).toBe(weeks.change.zScore);
    });

    it("a raised cap restores the stricter long-absence bar, so this stays a tunable product call", () => {
      const snap = { TCS: seen(100) };
      const st = stats("TCS", REALISTIC);
      const strict = { ...cfg, maxHorizonMs: 30 * 86_400_000 };
      const [r] = computeChanges(snap, 3 * 86_400_000, [item("TCS", 108)], st, strict);
      expect(r.change.kind).toBe("none");
    });
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

describe("beta-adjusted / residual significance", () => {
  it("a move fully explained by the sector (beta≈1) is NOT meaningful, even though the raw move is large", () => {
    // Stock down 3%, beta=1, index also down 3% over the same window →
    // idiosyncratic residual ≈ 0. Raw sigma would flag this as a huge move;
    // the sector-adjusted path correctly shouldn't.
    const st = stats("S", 0.001, 10, 1.0, 0.0005); // idioSigma tiny — even a small residual would show up
    const [r] = computeChanges({ S: seen(100) }, 1_000, [item("S", 97)], st, cfg, -0.03);
    expect(r.change.sectorAdjusted).toBe(true);
    expect(r.change.kind).toBe("none");
    expect(Math.abs(r.change.zScore!)).toBeLessThan(1);
  });

  it("the SAME raw move is meaningful when the sector didn't move — idiosyncratic, not beta", () => {
    const st = stats("S", 0.001, 10, 1.0, 0.0005);
    const [r] = computeChanges({ S: seen(100) }, 1_000, [item("S", 97)], st, cfg, 0); // index flat
    expect(r.change.sectorAdjusted).toBe(true);
    expect(r.change.kind).toBe("move");
  });

  it("a move partly explained by a lower-beta stock still flags the idiosyncratic remainder", () => {
    // beta=0.5: half the market's -3% (i.e. -1.5%) is "expected"; this
    // stock is down 4%, so ~2.5% is genuinely its own move.
    const st = stats("S", 0.001, 10, 0.5, 0.0005);
    const [r] = computeChanges({ S: seen(100) }, 1_000, [item("S", 96)], st, cfg, -0.03);
    expect(r.change.sectorAdjusted).toBe(true);
    expect(r.change.kind).toBe("move");
    expect(r.change.zScore!).toBeLessThan(0); // still down, just less dramatically than raw −4%
  });

  it("no beta estimate yet (thin history) falls back to plain per-stock z, unadjusted", () => {
    const st = stats("S", 0.001); // beta/idioSigma default null
    const [r] = computeChanges({ S: seen(100) }, 1_000, [item("S", 97)], st, cfg, -0.03);
    expect(r.change.sectorAdjusted).toBe(false);
    // Raw z from st.sigma=0.001 on a 3% move is enormous — this IS meaningful
    // by the fallback path, which is the whole point: no beta yet ≠ no signal.
    expect(r.change.kind).toBe("move");
  });

  it("beta known but the index itself has no return right now → falls back honestly, says so", () => {
    const st = stats("S", 0.001, 10, 1.0, 0.0005);
    const [r] = computeChanges({ S: seen(100) }, 1_000, [item("S", 97)], st, cfg, null); // index unavailable
    expect(r.change.sectorAdjusted).toBe(false);
    expect(r.change.why).toMatch(/sector data delayed/i);
  });

  it("a big raw move that's mostly sector still gets a plain-language explanation, not silence", () => {
    const st = stats("S", 0.001, 10, 1.0, 0.02); // idioSigma large enough that the residual doesn't clear the bar
    const [r] = computeChanges({ S: seen(100) }, 1_000, [item("S", 97)], st, cfg, -0.03);
    expect(r.change.kind).toBe("none");
    expect(r.change.why).toMatch(/tracks the sector/i);
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
  // sigma scaled realistically (per-tick, ~2%/day daily vol — see
  // simulatedProvider.ts's own sigmaDaily/sqrt(ticksPerDay) derivation) so
  // the isSignificant() n-scaling (sigma * sqrt(elapsed ticks)) produces a
  // sane real-world bar: single-digit % over minutes, ~15%+ over 3 days.
  const REALISTIC_SIGMA = 0.00013;
  it("leads with the count, not the list, after a multi-day gap with a real backlog", () => {
    const snap = { A: seen(100), B: seen(100), C: seen(100), D: seen(100) };
    const st = new Map([...stats("A", REALISTIC_SIGMA), ...stats("B", REALISTIC_SIGMA), ...stats("C", REALISTIC_SIGMA), ...stats("D", REALISTIC_SIGMA)]);
    const results = computeChanges(snap, 3 * 86_400_000, [item("A", 122), item("B", 80), item("C", 125), item("D", 78)], st, cfg);
    const d = buildDigest(results, "checkpoint", 3 * 86_400_000);
    expect(d).toMatch(/^3 days ago — 4 changes while you were away\. Top 3: /);
  });
  it("keeps the short-gap list-first phrasing for a same-day reopen even with several changes", () => {
    const snap = { A: seen(100), B: seen(100), C: seen(100), D: seen(100) };
    const st = new Map([...stats("A", REALISTIC_SIGMA), ...stats("B", REALISTIC_SIGMA), ...stats("C", REALISTIC_SIGMA), ...stats("D", REALISTIC_SIGMA)]);
    const results = computeChanges(snap, 600_000, [item("A", 103), item("B", 97), item("C", 104), item("D", 96)], st, cfg);
    const d = buildDigest(results, "checkpoint", 600_000);
    expect(d).toMatch(/^Since 10 min ago: 4 things worth a look — /);
  });
});
