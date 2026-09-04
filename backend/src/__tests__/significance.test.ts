import { describe, expect, it } from "vitest";
import { decideSignificance, type SignificanceRow } from "../changes/significance.js";

const T0 = new Date("2026-09-01T00:00:00.000Z");
const T1 = new Date("2026-09-01T00:00:01.000Z");
const NOW = new Date("2026-09-04T00:00:00.000Z"); // 3 days after T0

function row(overrides: Partial<SignificanceRow> = {}): SignificanceRow {
  return { lastEventAt: null, lastEventAsOf: null, lastEventZ: null, retractedAt: null, ...overrides };
}

describe("decideSignificance", () => {
  it("no prior record, a move: a new event with quietForMs=null (first ever)", () => {
    const d = decideSignificance(null, { kind: "move", zScore: 3 }, { asOf: T0, corrected: false }, NOW);
    expect(d).toEqual({ action: "new-event", quietForMs: null });
  });

  it("prior record exists, symbol quiet for 3 days, now moves on a NEW tick: quietForMs is that gap", () => {
    const prior = row({ lastEventAt: T0, lastEventAsOf: T0, lastEventZ: 2.5 });
    const d = decideSignificance(prior, { kind: "move", zScore: 3 }, { asOf: T1, corrected: false }, NOW);
    expect(d.action).toBe("new-event");
    expect((d as any).quietForMs).toBe(NOW.getTime() - T0.getTime());
  });

  it("same tick already on record: no repeat announcement while still actively moving", () => {
    const prior = row({ lastEventAt: T0, lastEventAsOf: T0, lastEventZ: 2.5 });
    const d = decideSignificance(prior, { kind: "move", zScore: 2.6 }, { asOf: T0, corrected: false }, NOW);
    expect(d).toEqual({ action: "none" });
  });

  it("kind is not 'move': nothing to do, no matter what prior state says", () => {
    const d1 = decideSignificance(null, { kind: "none", zScore: 0.1 }, { asOf: T0, corrected: false }, NOW);
    expect(d1).toEqual({ action: "none" });
    const d2 = decideSignificance(row({ lastEventAsOf: T1 }), { kind: "event", zScore: 0.5 }, { asOf: T0, corrected: false }, NOW);
    expect(d2).toEqual({ action: "none" });
  });

  it("no quote: nothing to do", () => {
    const d = decideSignificance(null, { kind: "move", zScore: 3 }, null, NOW);
    expect(d).toEqual({ action: "none" });
  });

  it("retraction: the exact triggering tick was corrected and no longer clears the bar", () => {
    const prior = row({ lastEventAt: T0, lastEventAsOf: T0, lastEventZ: 4.2 });
    const d = decideSignificance(prior, { kind: "none", zScore: 0.3 }, { asOf: T0, corrected: true }, NOW);
    expect(d).toEqual({ action: "retract", previousZ: 4.2 });
  });

  it("NOT a retraction: corrected, but a DIFFERENT tick than the one that triggered the event", () => {
    const prior = row({ lastEventAt: T0, lastEventAsOf: T0, lastEventZ: 4.2 });
    const d = decideSignificance(prior, { kind: "none", zScore: 0.3 }, { asOf: T1, corrected: true }, NOW);
    expect(d).toEqual({ action: "none" });
  });

  it("NOT a retraction: the corrected tick still clears the bar (still a genuine move)", () => {
    const prior = row({ lastEventAt: T0, lastEventAsOf: T0, lastEventZ: 4.2 });
    const d = decideSignificance(prior, { kind: "move", zScore: 3.8 }, { asOf: T0, corrected: true }, NOW);
    // Still "move" on the same tick — not a new event (already on record) and not a retraction.
    expect(d).toEqual({ action: "none" });
  });

  it("a symbol already retracted is never retracted twice for the same event", () => {
    const prior = row({ lastEventAt: T0, lastEventAsOf: T0, lastEventZ: 4.2, retractedAt: T1 });
    const d = decideSignificance(prior, { kind: "none", zScore: 0.3 }, { asOf: T0, corrected: true }, NOW);
    expect(d).toEqual({ action: "none" });
  });

  it("uncorrected data at the same tick that's now below threshold is NOT a retraction (no correction happened)", () => {
    // Guards against misreading "the engine disagrees with itself" (e.g. a
    // sensitivity change) as a feed correction — only a genuine `corrected`
    // tick can retract.
    const prior = row({ lastEventAt: T0, lastEventAsOf: T0, lastEventZ: 4.2 });
    const d = decideSignificance(prior, { kind: "none", zScore: 0.3 }, { asOf: T0, corrected: false }, NOW);
    expect(d).toEqual({ action: "none" });
  });
});
