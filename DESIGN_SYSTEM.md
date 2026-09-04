# Frontend Design System — Smart Market Watchlist

For Codex. This has the same weight as the API contract — don't treat visual
design as a final coat of paint. The product's whole thesis is "tell me what
deserves attention, honestly" — the UI has to *feel* like calm, trustworthy
judgment, not a stock-ticker toy. That feeling is a design decision, not a CSS
afterthought.

## The design thesis

Fintech UI defaults to one of two failure modes: (a) generic SaaS-dashboard —
Inter font, indigo-to-violet gradient, rounded cards, could be any app; or
(b) gamified trading-app — flashing numbers, aggressive red/green, urgency
everywhere. Both are wrong for this product. The thesis here is **a calm
instrument, not a feed** — closer to a well-designed weather app or a flight
status board than a trading terminal. Confidence comes from restraint:
color and motion are reserved for things that actually matter, which is
literally the product's own logic (`kind="none"` is a real, quiet state).

## Typography

- **Data (prices, %, volume):** a monospaced or tabular-figure numeric face
  so columns of numbers align — `font-variant-numeric: tabular-nums` at
  minimum, or a real mono like `"JetBrains Mono"` / `ui-monospace` for
  prices specifically. Numbers that jitter horizontally as they update look
  cheap; this is a five-minute fix that reads as care.
- **Everything else (labels, `why` strings, nav):** one humanist sans —
  system font stack (`-apple-system, "Segoe UI", ...`) or a single Google
  Font loaded once (e.g. Inter is fine *here*, it's not the whole identity).
- Two type families max. No display/decorative font anywhere.
- Scale: 12 / 14 / 16 / 20 / 28px. Body text is 14px, not 16 — this is a
  dense information product, not a blog.

## Color

Do not use a generic indigo/violet SaaS gradient anywhere. Palette:

- **Ground:** near-white `#FAFAF9` (light) / near-black `#0B0D0E` (dark) —
  warm-neutral, not pure white/black.
- **Ink:** `#14171A` on light, `#EDEEF0` on dark. Secondary text at ~60%
  opacity of ink, not a separate gray.
- **Signal green / red:** reserved *only* for actual price direction on a
  quote row. Desaturated compared to typical fintech red/green —
  `#1B8A5A` / `#C4432F` — so they read as information, not alarm.
- **Attention accent (the one differentiator):** a single warm amber
  `#B8862B` used *only* for the "meaningful change" surface — the
  z-score badge, the ranked-card border, the "X things changed" count. This
  is what visually says "this is the smart part of the app," distinct from
  plain up/down color. Nothing else on the page uses this color.
- **Stale/degraded:** desaturate toward gray + a small clock icon. Never
  hide staleness by omission — make it visually present but calm, not a
  red error banner (it isn't an error, it's honest latency).
- Support both light and dark via CSS variables / Tailwind `dark:` — cheap
  with Tailwind, reads as thoroughness.

## Spacing & layout

- 4px base unit; use 4/8/12/16/24/32/48 only. No arbitrary values.
- Page max-width ~880px, centered — this is a focused tool, not a wide
  dashboard trying to fill a monitor.
- Generous vertical rhythm between the two zones (32–48px gap) — they are
  visually and conceptually separate questions ("what changed" vs "what's
  everything doing").

## The two zones (from IMPLEMENTATION_PLAN.md §9 step 5)

**Zone 1 — "Since you last looked"** (top, most visual weight)
- Horizontal-scrolling or stacked rank-ordered cards, highest `attention`
  first. Each card: symbol, one-line `why` string (this is the product —
  make it typographically prominent, not a caption), the z-score/event
  badge in the amber accent, a "Mark as seen" affordance per-card *or* one
  global action — pick one, document the choice in DECISIONS.md.
- `kind="none"` items don't appear as empty cards — they simply aren't
  shown here (they're still visible in the full list below). When
  `summary.meaningful === 0`, this zone shows one quiet line, not a big
  empty-state graphic: *"Nothing meaningful changed since 9:15 AM."* —
  factual, not celebratory, not sad. This is a state worth designing
  properly, since 500 other submissions will make it an afterthought.
- `confidence="low"` items get a subtle dotted underline + tooltip
  ("not enough history yet"), not a warning icon — it's a caveat, not a
  fault.

**Zone 2 — full list** (below, lower visual weight, denser)
- Compact rows, not cards: symbol, price (tabular mono), day change %,
  stale badge if applicable, remove action on hover. This is the "boring"
  view and should look boring on purpose — the contrast with Zone 1's
  prominence is what makes Zone 1 read as smart.

## Component specs

- **`ChangeCard`** — border-left 3px in the amber accent (intensity
  proportional to `attention`, capped), symbol + name, the `why` string at
  16px medium weight, small badge row for `events`, muted timestamp.
- **`StaleBadge`** — gray dot + "Xm old" text, not a red pill. Tooltip
  shows exact `asOf`.
- **`FeedStatusBar`** — only renders when `feed.status !== "live"`. A
  slim bar, not a modal or toast — persistent but not alarming. Copy:
  *"Data may be delayed — last update Xm ago."*
- **Conflict modal** (409 from bulk edit) — show *their* version's items vs
  *your* pending change as two simple lists with a clear "keep mine /
  keep theirs / merge" — not a diff-tool UI, this should take five seconds
  to resolve.

## Motion — restrained, purposeful only

- New `ChangeCard` entering the ranked list: fade + 4px slide, 200ms.
- Price digit updates: no flashing background flash-of-color per tick
  (that's the gamified-trading-app failure mode) — a very subtle 400ms
  color pulse on the digit only, on real value change.
- Nothing auto-plays, nothing loops, no skeleton shimmer longer than
  necessary. Loading states are brief and quiet.

## Copy tone

Factual, first-person-plural-free, no exclamation points, no "🎉". The
`why` strings from the backend are already written in this voice
(`"Moved −3.09%, unusual for TCS (2.8σ). Broke below the day's low."`) —
match it everywhere: empty states, error states, tooltips. This product's
personality is "a colleague who checked so you don't have to," not a chatbot.

## What "visually great" means here, concretely

A judge should be able to look at the screen for three seconds and correctly
guess what the app does, without reading anything — because Zone 1 is
visually the loudest thing on the page and everything else recedes. That's
the whole design brief. Everything above serves that one sentence.
