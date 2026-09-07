import { createHash } from "node:crypto";
import { Router } from "express";
import type { Pool } from "pg";
import { z } from "zod";
import { config } from "../config.js";
import { buildDigest, computeChanges, DEFAULT_MULTIPLIER, type Change, type EngineItem, type EngineResult, type SnapshotPayload } from "../changes/engine.js";
import { loadStats } from "../changes/stats.js";
import { applyPersonalization, type AttentionMemory } from "../changes/personalization.js";
import { decideSignificance, type SignificanceRow } from "../changes/significance.js";
import { AppError } from "../middleware/errorHandler.js";
import { feedStatus } from "./health.js";
import { formatQuote, type Quote, type QuoteRow } from "./quotes.js";
import type { Ingestor } from "../market/ingestor.js";
import { MARKET_INDEX_SYMBOL } from "../market/indexSymbol.js";

const Query = z.object({ limit: z.coerce.number().int().min(1).max(500).default(20) });

interface ItemRow extends QuoteRow {
  name: string;
  sensitivity: "quiet" | "normal" | "loud";
}

export function changesRouter(pool: Pool, ingestor: Ingestor) {
  const r = Router();

  r.get("/api/watchlists/:id/changes", async (req, res, next) => {
    try {
      const { limit } = Query.parse(req.query);
      const wl = await pool.query("SELECT id FROM watchlists WHERE id = $1 AND user_id = $2", [req.params.id, req.userId]);
      if (wl.rowCount === 0) throw new AppError(404, "NOT_FOUND", "Watchlist not found");

      const [items, indexQuote, cp] = await Promise.all([
        pool.query<ItemRow>(
          `SELECT wi.symbol, wi.sensitivity, s.name,
                  q.price, q.prev_close, q.day_high, q.day_low, q.week_high, q.week_low, q.volume,
                  q.as_of, q.received_at, q.corrected, q.source
             FROM watchlist_items wi
             JOIN symbols s ON s.symbol = wi.symbol
        LEFT JOIN quotes q ON q.symbol = wi.symbol
            WHERE wi.watchlist_id = $1`,
          [req.params.id],
        ),
        // The index's current price — one point lookup by primary key, not
        // a scan, so it doesn't change the scale story in RESILIENCE.md.
        pool.query<{ price: string }>("SELECT price FROM quotes WHERE symbol = $1", [MARKET_INDEX_SYMBOL]),
        pool.query<{ taken_at: Date; payload: SnapshotPayload; top_symbol: string | null; index_price: string | null }>(
          `SELECT c.taken_at, s.payload, s.top_symbol, s.index_price
             FROM checkpoints c JOIN snapshots s ON s.id = c.snapshot_id
            WHERE c.user_id = $1 AND c.watchlist_id = $2`,
          [req.userId, req.params.id],
        ),
      ]);

      const baseline = cp.rows[0] ?? null;
      const now = new Date();
      const elapsedMs = baseline ? now.getTime() - new Date(baseline.taken_at).getTime() : null;

      const symbols = items.rows.map((i) => i.symbol);
      const stats = await loadStats(pool, symbols);

      // What the market itself did since the checkpoint, computed exactly
      // the same way any stock's move is: (now − seen) / seen. null when
      // there's nothing to compare from yet, or the index has no current
      // quote right now (e.g. mid-outage) — engine.ts degrades honestly in
      // either case rather than pretending an adjustment happened.
      const currentIndexPrice = indexQuote.rows[0] ? Number(indexQuote.rows[0].price) : null;
      const seenIndexPrice = baseline?.index_price != null ? Number(baseline.index_price) : null;
      const indexReturn =
        currentIndexPrice !== null && seenIndexPrice !== null && seenIndexPrice > 0
          ? (currentIndexPrice - seenIndexPrice) / seenIndexPrice
          : null;

      const engineItems: EngineItem[] = items.rows.map((row) => ({
        symbol: row.symbol,
        name: row.name,
        sensitivity: row.sensitivity,
        quote: row.as_of
          ? {
              price: String(row.price), prevClose: row.prev_close, dayHigh: row.day_high, dayLow: row.day_low,
              volume: Number(row.volume), asOf: new Date(row.as_of).toISOString(), corrected: row.corrected,
            }
          : null,
      }));

      const results = computeChanges(baseline?.payload ?? null, elapsedMs, engineItems, stats, {
        tickMs: config.tickMs,
        zThreshold: config.zThreshold,
        historyWindow: config.historyWindow,
        absThresholdPct: config.absThresholdPct,
        volumeSpikeMultiple: config.volumeSpikeMultiple,
        gapPct: config.gapPct,
        sensitivityMultiplier: DEFAULT_MULTIPLIER,
        maxHorizonMs: config.maxHorizonMs,
      }, indexReturn);

      const quoteBySymbol = new Map(items.rows.filter((i) => i.as_of).map((i) => [i.symbol, formatQuote(i, now)]));

      // The second clock: independent of this (or any) user's visits, has
      // this symbol done something notable, and — the hard part — if the
      // tick that triggered its last event was later corrected below
      // threshold, that's surfaced as a visible retraction, never a silent
      // erase. See changes/significance.ts and DECISIONS.md.
      const { quietForMs, retractions } = await applySignificanceClock(
        pool, results, quoteBySymbol, now,
        baseline ? new Date(baseline.taken_at) : null,
      );

      // Personalization (see changes/personalization.ts): applied AFTER the
      // significance clock on purpose — that clock decides whether the
      // underlying market data crossed a threshold, which is global and
      // must never be influenced by one user's snooze/open history. What
      // gets adjusted here is purely this user's view of the (already
      // globally-decided) results: a snooze suppresses, an open-history
      // boosts, and the ranking is redone on top of that.
      const personalized = applyPersonalization(results, await loadAttentionMemory(pool, req.userId, symbols, now), now);

      // Watchlist-relative ranking, not just magnitude: `personalized` is
      // already re-ranked, so its first entry (if actually meaningful) IS
      // the current #1 mover. Compared against who held that spot as of
      // the last checkpoint, this is "you have a new top mover" rather
      // than just "here's a z-score" — a different and more useful claim
      // about attention, not magnitude.
      const currentTop = personalized[0] && personalized[0].change.kind !== "none" ? personalized[0].symbol : null;
      const topMover =
        currentTop && currentTop !== baseline?.top_symbol
          ? { symbol: currentTop, displaced: baseline?.top_symbol ?? null }
          : null;

      // The snapshot is exactly what this response shows. Re-use the latest
      // unpromoted snapshot if nothing changed, so idle polling doesn't write.
      const payload: SnapshotPayload = {};
      for (const row of items.rows) {
        if (!row.as_of) continue;
        payload[row.symbol] = {
          price: String(row.price), asOf: new Date(row.as_of).toISOString(),
          volume: Number(row.volume), dayHigh: row.day_high, dayLow: row.day_low,
        };
      }
      const asOfMax = items.rows.reduce<Date | null>((m, i) => (i.as_of && (!m || i.as_of > m) ? new Date(i.as_of) : m), null);
      const baselineKind = baseline ? "checkpoint" : "first-visit";

      // Resolve the snapshot id read-only FIRST. When nothing has changed
      // the id is reused anyway, so the ETag is knowable without writing —
      // and a conditional request whose whole purpose is "tell me if there's
      // nothing new" should not perform an INSERT and a retention DELETE
      // before answering "nothing new". Only mint (write) once we know the
      // client actually needs a body.
      const reusableId = await reusableSnapshotId(pool, req.userId, req.params.id, payload);
      const etagFor = (id: string) => `"${id}:${asOfMax?.toISOString() ?? "none"}"`;
      if (reusableId && req.header("if-none-match") === etagFor(reusableId)) {
        // A 304 still carries its validator: caches that refresh freshness
        // from the response rely on it being present, not just on the 200.
        res.setHeader("ETag", etagFor(reusableId));
        return res.status(304).end();
      }

      const snapshotId = reusableId ?? await mintSnapshot(pool, req.userId, req.params.id, payload, currentTop, currentIndexPrice);
      const etag = etagFor(snapshotId);

      const summary = {
        meaningful: personalized.filter((x) => x.change.kind === "move" || x.change.kind === "event").length,
        total: personalized.length,
        stale: [...quoteBySymbol.values()].filter((q) => q.stale).length,
        newSinceLast: personalized.filter((x) => x.change.kind === "new").length,
      };

      res.setHeader("ETag", etag);
      res.json({
        snapshotId,
        baseline: { takenAt: baseline ? new Date(baseline.taken_at).toISOString() : null, kind: baselineKind, awaySeconds: elapsedMs === null ? null : Math.round(elapsedMs / 1000) },
        asOf: asOfMax?.toISOString() ?? null,
        feed: (({ status, lagSeconds }) => ({ status, lagSeconds }))(feedStatus(ingestor.provider.lastTickAt(), now)),
        digest: buildDigest(personalized, baselineKind, elapsedMs),
        summary,
        // A product decision, not a UI afterthought: how many ranked cards
        // deserve first-glance attention before the rest belong in the full
        // list instead. `items` is already sorted by the engine's own
        // attention ranking, so the client just takes the top N of it.
        attentionBudget: config.attentionBudget,
        topMover,
        // A retraction is a first-class, visible item — never a silent
        // delete of something already shown. See changes/significance.ts.
        retractions,
        items: personalized.slice(0, limit).map((x) => {
          const quote = quoteBySymbol.get(x.symbol) ?? null;
          return { symbol: x.symbol, name: x.name, quote, stale: quote ? quote.stale : true, change: withQuietNote(x.change, quietForMs.get(x.symbol)) };
        }),
      });
    } catch (err) {
      next(err);
    }
  });

  return r;
}

// Read-only half of the mint: the id this response WOULD use if nothing has
// changed since the last snapshot, or null if a new one must be written.
// Split out so a conditional request can be answered without writing.
//
// Scaling fix: dedupe on a 40-byte hash, not a full 18KB jsonb equality
// scan. Under concurrent polling most requests in the same tick window
// see an identical latest snapshot and skip the write entirely — the
// 500-symbol/50-user write storm that scale-check.ts found collapses to
// one write per actual data change instead of one per request.
async function reusableSnapshotId(
  pool: Pool, userId: string, watchlistId: string, payload: SnapshotPayload,
): Promise<string | null> {
  const hash = payloadHash(payload);
  const latest = await pool.query<{ id: string; payload_hash: string | null }>(
    `SELECT id, payload_hash FROM snapshots
      WHERE user_id = $1 AND watchlist_id = $2 ORDER BY taken_at DESC LIMIT 1`,
    [userId, watchlistId],
  );
  return latest.rows[0]?.payload_hash === hash ? latest.rows[0].id : null;
}

async function mintSnapshot(
  pool: Pool, userId: string, watchlistId: string, payload: SnapshotPayload,
  topSymbol: string | null, indexPrice: number | null,
): Promise<string> {
  const json = JSON.stringify(payload);
  const hash = createHash("sha1").update(json).digest("hex");
  const ins = await pool.query<{ id: string }>(
    "INSERT INTO snapshots (user_id, watchlist_id, payload, payload_hash, top_symbol, index_price) VALUES ($1, $2, $3::jsonb, $4, $5, $6) RETURNING id",
    [userId, watchlistId, json, hash, topSymbol, indexPrice],
  );
  // Bounded retention (#2 gap): keep the newest 50 unpromoted snapshots per
  // list; anything older and not referenced by a checkpoint is disposable.
  await pool.query(
    `DELETE FROM snapshots s WHERE s.user_id = $1 AND s.watchlist_id = $2
       AND NOT EXISTS (SELECT 1 FROM checkpoints c WHERE c.snapshot_id = s.id)
       AND NOT EXISTS (SELECT 1 FROM checkpoint_history h WHERE h.snapshot_id = s.id)
       AND s.id NOT IN (
         SELECT id FROM snapshots WHERE user_id = $1 AND watchlist_id = $2 ORDER BY taken_at DESC LIMIT 50
       )`,
    [userId, watchlistId],
  ).catch(() => {});
  return ins.rows[0].id;
}

export function payloadHash(payload: SnapshotPayload) {
  return createHash("sha1").update(JSON.stringify(payload)).digest("hex");
}

interface Retraction { symbol: string; name: string; previousZ: number | null }

// Global per-symbol state (not per-user — see significance.ts): batch-load
// prior state for every symbol in this response, decide per symbol, batch-
// write the results. One extra query plus at most one write per symbol
// that actually changed state this poll — most polls touch zero rows here.
//
// Deciding is global; REPORTING is per-user. The decision latch
// (`symbol_significance`) can only fire once per real-world event, so if the
// response were built from the decision alone, only whichever user happened
// to poll first would ever see a retraction or a "quiet for N" annotation —
// everyone else would watch the card silently disappear. So each decision is
// also appended to `symbol_significance_events`, and what this user sees is
// projected from that log against THEIR checkpoint (`sinceTakenAt`).
async function applySignificanceClock(
  pool: Pool,
  results: EngineResult[],
  quoteBySymbol: Map<string, Quote>,
  now: Date,
  sinceTakenAt: Date | null,
): Promise<{ quietForMs: Map<string, number | null>; retractions: Retraction[] }> {
  const quietForMs = new Map<string, number | null>();
  const retractions: Retraction[] = [];
  const symbols = results.map((r) => r.symbol);
  if (symbols.length === 0) return { quietForMs, retractions };

  const { rows } = await pool.query<{
    symbol: string; last_event_at: Date | null; last_event_as_of: Date | null;
    last_event_z: string | null; retracted_at: Date | null;
  }>(
    "SELECT symbol, last_event_at, last_event_as_of, last_event_z, retracted_at FROM symbol_significance WHERE symbol = ANY($1)",
    [symbols],
  );
  const priorBySymbol = new Map<string, SignificanceRow>(rows.map((r) => [r.symbol, {
    lastEventAt: r.last_event_at, lastEventAsOf: r.last_event_as_of,
    lastEventZ: r.last_event_z === null ? null : Number(r.last_event_z), retractedAt: r.retracted_at,
  }]));

  const writes: Promise<unknown>[] = [];
  for (const result of results) {
    const quote = quoteBySymbol.get(result.symbol);
    if (!quote) continue;
    const decision = decideSignificance(
      priorBySymbol.get(result.symbol) ?? null,
      { kind: result.change.kind, zScore: result.change.zScore },
      { asOf: new Date(quote.asOf), corrected: quote.corrected },
      now,
    );
    if (decision.action === "new-event") {
      writes.push(pool.query(
        `INSERT INTO symbol_significance (symbol, last_event_at, last_event_as_of, last_event_z, retracted_at)
         VALUES ($1, $2, $3, $4, NULL)
         ON CONFLICT (symbol) DO UPDATE SET
           last_event_at = EXCLUDED.last_event_at, last_event_as_of = EXCLUDED.last_event_as_of,
           last_event_z = EXCLUDED.last_event_z, retracted_at = NULL`,
        [result.symbol, now, new Date(quote.asOf), result.change.zScore],
      ));
      writes.push(pool.query(
        `INSERT INTO symbol_significance_events (symbol, event_as_of, event_at, z, quiet_for_ms)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (symbol, event_as_of) DO NOTHING`,
        [result.symbol, new Date(quote.asOf), now, result.change.zScore, decision.quietForMs],
      ));
    } else if (decision.action === "retract") {
      writes.push(pool.query("UPDATE symbol_significance SET retracted_at = $2 WHERE symbol = $1", [result.symbol, now]));
      writes.push(pool.query(
        `UPDATE symbol_significance_events SET retracted_at = $3
          WHERE symbol = $1 AND event_as_of = $2 AND retracted_at IS NULL`,
        [result.symbol, new Date(quote.asOf), now],
      ));
    }
  }
  await Promise.all(writes);

  // Project the log onto THIS user. A first visit has no checkpoint, so
  // nothing was ever shown to retract or to have been quiet before.
  if (!sinceTakenAt) return { quietForMs, retractions };

  const [retracted, recent] = await Promise.all([
    pool.query<{ symbol: string; z: string | null }>(
      `SELECT symbol, z FROM symbol_significance_events
        WHERE symbol = ANY($1) AND retracted_at IS NOT NULL AND retracted_at > $2`,
      [symbols, sinceTakenAt],
    ),
    pool.query<{ symbol: string; quiet_for_ms: string | null }>(
      `SELECT DISTINCT ON (symbol) symbol, quiet_for_ms
         FROM symbol_significance_events
        WHERE symbol = ANY($1) AND event_at > $2
        ORDER BY symbol, event_at DESC`,
      [symbols, sinceTakenAt],
    ),
  ]);

  const nameBySymbol = new Map(results.map((r) => [r.symbol, r.name]));
  for (const row of retracted.rows) {
    retractions.push({
      symbol: row.symbol,
      name: nameBySymbol.get(row.symbol) ?? row.symbol,
      previousZ: row.z === null ? null : Number(row.z),
    });
  }
  for (const row of recent.rows) {
    quietForMs.set(row.symbol, row.quiet_for_ms === null ? null : Number(row.quiet_for_ms));
  }
  return { quietForMs, retractions };
}

function withQuietNote(change: Change, quietForMs: number | null | undefined): Change {
  if (quietForMs === undefined) return change;
  const note = quietForMs === null
    ? " First recorded significant move for this symbol."
    : ` Quiet for ${humanizeDuration(quietForMs)} before this.`;
  return { ...change, quietForMs, why: change.why + note };
}

function humanizeDuration(ms: number): string {
  const days = Math.floor(ms / 86_400_000);
  if (days >= 1) return `${days} day${days === 1 ? "" : "s"}`;
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 1) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const minutes = Math.max(1, Math.floor(ms / 60_000));
  return `${minutes} min${minutes === 1 ? "" : "s"}`;
}

// Two small, targeted queries rather than one join: snoozes are usually
// empty (most users have snoozed nothing) and opens is a GROUP BY — forcing
// them into one query would mean carrying every open row's actual date
// through a join for symbols that never even appear in attention_snoozes.
// Both are per-request-symbol-list, not full-table, so this stays cheap
// regardless of how large attention_opens grows over time (see
// ingestor.ts's prune job for how that's bounded).
async function loadAttentionMemory(
  pool: Pool, userId: string, symbols: string[], now: Date,
): Promise<Map<string, AttentionMemory>> {
  const memory = new Map<string, AttentionMemory>();
  if (symbols.length === 0) return memory;

  const [snoozes, opens] = await Promise.all([
    pool.query<{ symbol: string; snoozed_until: Date }>(
      "SELECT symbol, snoozed_until FROM attention_snoozes WHERE user_id = $1 AND symbol = ANY($2) AND snoozed_until > $3",
      [userId, symbols, now],
    ),
    pool.query<{ symbol: string; c: number }>(
      `SELECT symbol, count(*)::int c FROM attention_opens
        WHERE user_id = $1 AND symbol = ANY($2) AND opened_at > $3
        GROUP BY symbol`,
      [userId, symbols, new Date(now.getTime() - 30 * 86_400_000)],
    ),
  ]);

  const get = (symbol: string): AttentionMemory => memory.get(symbol) ?? { snoozedUntil: null, opensLast30d: 0 };
  for (const row of snoozes.rows) memory.set(row.symbol, { ...get(row.symbol), snoozedUntil: row.snoozed_until });
  for (const row of opens.rows) memory.set(row.symbol, { ...get(row.symbol), opensLast30d: row.c });
  return memory;
}
