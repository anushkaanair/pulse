// The other half of "meaningful" that raw z-score math can't see: what a
// user actually clicks on versus what they were merely shown, and what
// they've explicitly told the ranking to stop pushing at them. Pure and
// unit-tested like engine.ts and significance.ts — routes/changes.ts does
// nothing but load the two small per-user tables and hand them here.
import { round2, rankResults, type EngineResult } from "./engine.js";

export interface AttentionMemory {
  // Set only while a user-initiated snooze is still in the future.
  snoozedUntil: Date | null;
  // How many times the user has actually opened this symbol's card in the
  // last 30 days (see attention_opens) — a real engagement signal, not a
  // proxy like "was it ranked highly." A symbol with a real move but a
  // history of being opened whenever it's shown gets a modest boost; one
  // with no open history is left exactly as the engine scored it — this
  // never invents interest that hasn't been observed.
  opensLast30d: number;
}

// Capped, not compounding without bound: 5 opens is already a strong,
// unambiguous "I always check this one" signal. Beyond that, additional
// opens shouldn't let personalization overwhelm the underlying z-score —
// the boost is a tiebreaker on top of real significance, never a
// replacement for it.
const MAX_BOOST_OPENS = 5;
const BOOST_PER_OPEN = 0.06; // 5 opens → +30% attention, capped

export function applyPersonalization(
  results: EngineResult[],
  memory: Map<string, AttentionMemory>,
  now: Date,
): EngineResult[] {
  const adjusted = results.map((result) => {
    const mem = memory.get(result.symbol);
    if (!mem) return result;

    // A snooze is a real suppression, not a soft de-prioritization — the
    // point of muting a stock is that it stops competing for attention at
    // all, the same way sensitivity="quiet" already lowers the bar rather
    // than half-lowering it. kind is forced to "none" (drops it out of
    // `summary.meaningful` and the digest, exactly like a genuinely quiet
    // stock) and attention to 0 so a later re-rank puts it last.
    if (mem.snoozedUntil && mem.snoozedUntil.getTime() > now.getTime()) {
      return {
        ...result,
        change: {
          ...result.change,
          kind: "none" as const,
          attention: 0,
          snoozedUntil: mem.snoozedUntil.toISOString(),
          why: `Snoozed until ${mem.snoozedUntil.toLocaleString("en-IN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" })}. ${result.change.why}`,
        },
      };
    }

    if (mem.opensLast30d > 0) {
      const boost = 1 + Math.min(mem.opensLast30d, MAX_BOOST_OPENS) * BOOST_PER_OPEN;
      return { ...result, change: { ...result.change, attention: round2(result.change.attention * boost) } };
    }

    return result;
  });

  // Re-rank: a snooze can only ever move a result down (attention forced to
  // 0), but a boost can move one up past a neighbor the engine ranked
  // slightly higher — the personalized order isn't just the engine's order
  // with some entries removed.
  return rankResults(adjusted);
}
