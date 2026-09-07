import { describe, expect, it } from "vitest";
import { applyPersonalization, type AttentionMemory } from "../changes/personalization.js";
import type { EngineResult } from "../changes/engine.js";

const NOW = new Date("2026-09-04T00:00:00.000Z");

function result(symbol: string, kind: EngineResult["change"]["kind"], attention: number): EngineResult {
  return {
    symbol,
    name: symbol,
    change: {
      kind, pctSincePrev: null, zScore: null, zRaw: null, events: [], confidence: "high",
      attention, sensitivity: "normal", why: "why", sectorAdjusted: false,
    },
  };
}

describe("applyPersonalization", () => {
  it("no memory for a symbol: passes it through completely unchanged", () => {
    const r = result("TCS", "move", 3);
    const out = applyPersonalization([r], new Map(), NOW);
    expect(out[0]).toEqual(r);
  });

  it("active snooze: forces kind to none and attention to 0, regardless of how real the move is", () => {
    const r = result("TCS", "move", 5);
    const memory = new Map<string, AttentionMemory>([["TCS", { snoozedUntil: new Date(NOW.getTime() + 3600_000), opensLast30d: 0 }]]);
    const out = applyPersonalization([r], memory, NOW);
    expect(out[0].change.kind).toBe("none");
    expect(out[0].change.attention).toBe(0);
    expect(out[0].change.snoozedUntil).toBeTruthy();
  });

  it("a snooze that already expired: no suppression at all", () => {
    const r = result("TCS", "move", 5);
    const memory = new Map<string, AttentionMemory>([["TCS", { snoozedUntil: new Date(NOW.getTime() - 3600_000), opensLast30d: 0 }]]);
    const out = applyPersonalization([r], memory, NOW);
    expect(out[0].change.kind).toBe("move");
    expect(out[0].change.attention).toBe(5);
    expect(out[0].change.snoozedUntil).toBeUndefined();
  });

  it("open history boosts attention proportionally, capped at 5 opens (+30%)", () => {
    const r2 = result("SUZLON", "move", 10);
    const memory2 = new Map<string, AttentionMemory>([["SUZLON", { snoozedUntil: null, opensLast30d: 2 }]]);
    const out2 = applyPersonalization([r2], memory2, NOW);
    expect(out2[0].change.attention).toBe(11.2); // 10 * 1.12

    const rCap = result("SUZLON", "move", 10);
    const memoryCap = new Map<string, AttentionMemory>([["SUZLON", { snoozedUntil: null, opensLast30d: 50 }]]);
    const outCap = applyPersonalization([rCap], memoryCap, NOW);
    expect(outCap[0].change.attention).toBe(13); // capped at 5 opens: 10 * 1.30
  });

  it("re-ranks after boosting: a frequently-opened symbol can overtake a higher-raw-attention neighbor", () => {
    const tcs = result("TCS", "move", 10); // no history
    const suzlon = result("SUZLON", "move", 9); // opened often
    const memory = new Map<string, AttentionMemory>([["SUZLON", { snoozedUntil: null, opensLast30d: 5 }]]);
    const out = applyPersonalization([tcs, suzlon], memory, NOW);
    // SUZLON: 9 * 1.30 = 11.7, now ranks above TCS's untouched 10.
    expect(out.map((r) => r.symbol)).toEqual(["SUZLON", "TCS"]);
  });

  it("a snoozed symbol sorts below every other item, even one with only token attention", () => {
    const active = result("TCS", "none", 0.1); // a real "nothing meaningful," not forced
    const snoozed = result("SUZLON", "move", 8);
    const memory = new Map<string, AttentionMemory>([["SUZLON", { snoozedUntil: new Date(NOW.getTime() + 1000), opensLast30d: 0 }]]);
    const out = applyPersonalization([snoozed, active], memory, NOW);
    // Both end up kind:"none", but the snooze forces attention to a hard 0 —
    // strictly below TCS's real (if tiny) 0.1, so it ranks last of the two.
    expect(out.map((r) => r.symbol)).toEqual(["TCS", "SUZLON"]);
  });
});
