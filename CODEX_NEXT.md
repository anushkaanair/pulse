# Next brief for Codex — sparkline, visit timeline, UI polish

Paste this in once Codex's usage resets. Read `IMPLEMENTATION_PLAN.md` §5
(two new endpoint blocks: sparklines, timeline) and `DESIGN_SYSTEM.md`
("New: sparkline" and "New: visit timeline" sections) in full before
building either.

## 1. Sparkline (small, do this first)

Add a tiny inline trend line to each row in the full list (Zone 2), between
the price and the stale badge. Fetch via `GET /watchlists/:id/sparklines`
(one batched call for the whole list, not per-symbol). Render as a plain
inline SVG `<path>`, ~48×20px, no axes/grid/labels/tooltip, stroke color
matching that row's own price-direction color at 70% opacity. If a symbol
has fewer than 2 points, render nothing — not a flat line.

## 2. Visit timeline (bigger)

New route `app/w/[id]/history/page.tsx`, linked from a small "History" text
link near the watchlist title on the main page.

- Left/top: list of past visits from `GET /watchlists/:id/timeline`
  (`visits: [{snapshotId, takenAt}]`), newest first, relative time labels.
  Clicking one loads its diff.
- Right/below: the diff for the selected visit, via
  `GET /watchlists/:id/timeline/:snapshotId/diff` (defaults to comparing
  against the previous visit if you don't pass `?against=`). Shows
  `priceBefore → priceAfter`, `pct`, sorted by magnitude already from the
  API.
- **Important, from the design doc:** this view does NOT use the amber
  "meaningful" accent, z-score badges, or `why` sentences — those belong to
  the statistical engine on the main screen, and this is a plain historical
  comparison. Green/red for direction only. Using amber here would visually
  claim a kind of significance judgment this endpoint doesn't make — see
  `DECISIONS.md` for why the math is intentionally different.
- `status: "added"` rows: show a small "+ added" tag instead of a
  before-price. `"removed"` rows: "− removed" tag, gray out the after-price
  column (it's `null`).
- Add both to the mock layer matching the real shapes before wiring live.

## 3. UI polish pass (do after 1 and 2 are working, this is open-ended)

Now that both minimums and the extras are functionally done, spend
remaining time making it feel like a considered, finished product rather
than a working prototype:

- **Micro-interactions:** hover/focus states everywhere they're missing,
  a subtle transition on the sensitivity toggle, the new-card fade+slide
  from `DESIGN_SYSTEM.md` if it isn't already in (check `ChangeCard`
  mounting).
- **Empty/loading states:** make sure every one of them has real, specific
  copy — no generic "Loading..." where a more considered line fits (the
  index page and history page especially, since they're newer).
- **Responsive check:** actually resize down to mobile width and fix
  anything that breaks or feels cramped — the two-zone layout especially.
- **Dark mode check:** toggle OS dark mode, confirm every screen (including
  the new history page and fault-injection page) still reads correctly
  against `--ground`/`--ink` swapping.
- **Typography rhythm:** look for any place spacing feels arbitrary rather
  than on the 4/8/12/16/24/32/48 scale from the design doc, and fix it.

Don't add anything not in this brief without flagging it first — this is a
polish pass on what exists, not a new feature round.
