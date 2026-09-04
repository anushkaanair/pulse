# UI Review & Redesign Plan

Reviewed live in Chrome (`/?as=demo`, 15-symbol seeded list) from three
lenses: **customer**, **fintech Product Chief**, and **senior Groww eng /
hackathon judge**. Findings are measured, not impressionistic — pixel/DOM
values captured from the running app.

---

## 0. The headline decision: theme

**Current:** single dark theme, **amber/gold** accent (`--amber #f0b429`).
**Wanted:** Groww brand — **green + blue**, with a **dark** and a **light**
theme (dual).

**Groww palette (from the logo):**
| Token | Light | Dark |
|---|---|---|
| `--accent` (primary, green) | `#00b386` | `#00d09c` |
| `--accent-2` (secondary, blue) | `#5367ff` | `#7c8cff` |
| `--ground` (page bg) | `#f7f8fa` | `#0a0a0b` |
| `--surface` (cards) | `#ffffff` | `#141519` |
| `--ink` (text) | `#1a1d29` | `#f2f4f8` |
| `--muted` | `#6b7280` | `#8b90a0` |
| `--line` | `#e6e8ec` | `#24262e` |
| `--green`/`--red` (P&L) | `#00b386` / `#eb5b3c` | `#00d09c` / `#ff6b5b` |

Rule: **green = primary/brand/CTA, blue = secondary accent & links**, red
kept only for negative P&L. Amber is retired everywhere.

---

## 1. Critical (fix first — visible on every load)

| # | Where | Issue | Fix |
|---|---|---|---|
| C1 | Global | Amber theme ≠ brand; **no light theme** | Retoken to green/blue; add `[data-theme]` + `prefers-color-scheme` light palette; theme toggle in header |
| C2 | Index header | Stat numbers (`1` watchlists / `15` symbols) sit on the **same top line as "Switch user" and clip** | Move stats into their own row under the H1, or drop them from the header entirely (they're low-value) |
| C3 | AttentionDeck | Front card is **334px tall inside a 322px stage → bottom overflows/clips** by ~48px | Raise stage to ~360px (desktop) or trim card padding + clamp `why` to 3 lines |
| C4 | AttentionDeck | Deck anchored `left:30%` → on wide screens the **right ~45% is dead black space** | Center the stack (or fill right column with the expanded-detail panel inline), reduce stage width |

---

## 2. High (spacing / density — "too big / too much space")

| # | Where | Issue | Fix |
|---|---|---|---|
| H1 | Index empty-ish state | One watchlist card sits in a huge box with the old min-height; **excessive whitespace** | Let card grid size to content; drop fixed min-height |
| H2 | Deck section | ~322px tall band even with 1–2 cards → **lots of vertical air** before the list | Make stage height adapt to card count; collapse when only 1 card |
| H3 | Sidebar | 4 stacked cards (Summary / Market / History link / Tools) with generous padding push the fold | Merge Summary + Market into one card; tighten `p-5`→`p-4`, gaps `gap-4`→`gap-3` |
| H4 | Full list rows | `py-3.5` + 36px avatars → rows taller than Groww's dense tables | `py-2.5`, 28px avatars, smaller type — fit ~2 more rows per screen |
| H5 | Typography scale | H1 30px + big section H2s eat vertical space | H1 → 24px, section headers → 13px; Groww is compact |

---

## 3. Medium (polish / trust)

| # | Where | Issue | Fix |
|---|---|---|---|
| M1 | Header | Logo mark is amber gradient | Swap to green→blue gradient matching brand |
| M2 | Deck σ badges | `239.9σ` style extreme values look fake/alarming | Cap display at e.g. `>9σ`; these come from forced-correction demo data — fine, but cap for realism |
| M3 | "Reading a change" sidebar (index) | Good copy but shows `2.8σ` in amber | Recolor to accent; keep — it's a nice judge-facing explainer |
| M4 | Focus states | Single amber ring | Recolor to blue; verify visible in both themes |
| M5 | Mark-as-seen button | Full amber fill dominates sidebar | Green fill (brand CTA) |

---

## 4. Lens notes

**As a customer:** "Looks premium and unusual (the 3D deck is a wow), but
the gold feels like a crypto app, not my broker. On first load the top-right
numbers look broken (cut off). Too much empty black between the cards and my
actual stock list — I scroll past nothing."

**As Product Chief (fintech):** Information hierarchy is right (attention →
list → context) and the honesty features (stale, retraction, sector-adj) are
genuinely differentiated. But **density is below fintech bar** — Groww/Zerodha
fit 2× the rows per screen. The empty vertical space signals "prototype." Ship
blockers: brand mismatch (C1), header clip (C2). Everything else is tuning.

**As senior eng / judge:** Engineering depth is not in question (the backend
+ torture test carry it). The UI risk is **it reads as AI-generated flashy**
(gold glass, big glow) rather than restrained-instrument. Aligning to real
Groww brand + tightening density flips that perception. The 3D deck stays —
it's the originality hook — just brand-correct and not clipping.

---

## 5. Implementation plan (ordered, each independently shippable)

1. **Theme retoken + dual theme** (C1, M1, M3, M4, M5)
   - Rewrite `globals.css`: green/blue tokens, add light `:root` + dark under
     `@media (prefers-color-scheme: dark)` + `[data-theme]` overrides.
   - Add a header theme toggle (persist in `localStorage`, default = system).
   - Replace every `--amber*` usage (Header logo, deck badges/glow, sort
     pills, Mark-as-seen, sidebar σ, focus ring). ~8 files.
2. **Header fix** (C2) — restructure stats row; verify no clip at any width.
3. **Deck sizing** (C3, C4, H2, M2) — stage height by card count, center
   anchor on wide screens, clamp `why`, cap σ display, kill bottom clip.
4. **Density pass** (H1, H3, H4, H5) — tighten paddings/gaps/type, merge
   sidebar cards, shrink rows.
5. **Re-verify**: `npm run build` clean, 6/6 e2e still green (all restyle,
   no semantic/hook changes), screenshot desktop + mobile + **both themes**.

**Scope guard:** all of the above is CSS/token/layout — zero API, engine, or
`mock.ts` changes, so the e2e suite and every backend guarantee are untouched.
