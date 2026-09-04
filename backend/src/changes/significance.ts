// The second clock. `/changes` answers "what's different since your last
// checkpoint" — a visit-scoped diff. This answers a different question,
// independent of any visit: "when did this symbol last do something
// notable, regardless of who was watching." A stock the user checked
// yesterday but that did nothing then can still be "quiet for 3 weeks,
// just woke up" today — a lens the checkpoint clock alone can't produce.
//
// Pure and unit-tested like engine.ts, on purpose: this is the hardest,
// most failure-prone part of the two-clock idea (retraction semantics),
// so it gets the same rigor as the centerpiece, not less.

export interface SignificanceRow {
  lastEventAt: Date | null;
  lastEventAsOf: Date | null;
  lastEventZ: number | null;
  retractedAt: Date | null;
}

export type SignificanceDecision =
  | { action: "none" }
  // A genuinely NEW significant crossing (a tick this symbol hasn't
  // already been flagged for). quietForMs is how long it's been since the
  // symbol's previous event, if any — null for its first-ever event.
  | { action: "new-event"; quietForMs: number | null }
  // The tick that triggered the last recorded event was later corrected,
  // and the corrected value no longer clears the bar. This is a
  // RETRACTION, not a silent delete — see decideSignificance below and
  // DECISIONS.md: "a surfaced change is corrected, never silently
  // deleted" is a named invariant, not a suggestion.
  | { action: "retract"; previousZ: number | null };

export function decideSignificance(
  prior: SignificanceRow | null,
  current: { kind: "move" | "event" | "new" | "none"; zScore: number | null },
  quote: { asOf: Date; corrected: boolean } | null,
  now: Date,
): SignificanceDecision {
  if (!quote) return { action: "none" };

  // Retraction: the CURRENT computation, for the exact same tick that
  // triggered the last recorded event, no longer says "move" — and that
  // tick has since been corrected. Guarded by retractedAt so a symbol
  // isn't retracted twice for the same event, and by requiring the tick
  // to genuinely be a correction (not just "this poll happens to disagree"
  // — the underlying quote itself must have been revised).
  if (
    prior?.lastEventAsOf && !prior.retractedAt &&
    quote.corrected &&
    quote.asOf.getTime() === prior.lastEventAsOf.getTime() &&
    current.kind !== "move"
  ) {
    return { action: "retract", previousZ: prior.lastEventZ };
  }

  if (current.kind !== "move") return { action: "none" };

  // Not a new crossing if this is the same tick already on record — a
  // stock doesn't get a fresh "just woke up" announcement on every poll
  // while it's still actively moving on the same underlying print.
  const isNewCrossing = !prior?.lastEventAsOf || prior.lastEventAsOf.getTime() !== quote.asOf.getTime();
  if (!isNewCrossing) return { action: "none" };

  const quietForMs = prior?.lastEventAt ? now.getTime() - prior.lastEventAt.getTime() : null;
  return { action: "new-event", quietForMs };
}
