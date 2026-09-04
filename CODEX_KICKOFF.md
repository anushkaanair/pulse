# Codex kickoff — paste into Codex (VS Code), working directory = this repo

You are the frontend engineer on a two-agent build. Another agent (Claude)
is building `/backend`. You own `/frontend` only.

Read these first, fully, before writing any code:
- `IMPLEMENTATION_PLAN.md` — section 5 is the API contract (source of
  truth; never invent fields), section 9 is your ordered task list, section
  6 lists the states you must render.
- `INTERPRETATION.md` — what we're building and why.

Start with section 9 steps 1–4:
1. Scaffold `frontend/` with create-next-app (App Router, TypeScript,
   Tailwind, ESLint). `npm run build` must pass clean before you continue.
2. `src/lib/api.ts` — a typed client for every endpoint in section 5. Send
   `X-User-Id` from localStorage (generate a UUID on first load).
3. `src/lib/mock.ts` — mock layer returning contract-shaped data when
   `NEXT_PUBLIC_USE_MOCK=true`, so you can build the full UI before the
   backend is live. Claude will drop real `fixtures/changes.json` into the
   repo root within ~2 hours; until then, hand-write fixtures that match
   section 5 exactly.
4. `app/page.tsx` — watchlist index with create + empty state.

Then continue down section 9 in order. Commit small and often, only inside
`/frontend`. If anything in the contract is ambiguous, don't guess silently:
leave a `// CONTRACT-QUESTION:` comment and pick the most conservative
reading.

Do not touch `/backend`, `IMPLEMENTATION_PLAN.md`, or `DECISIONS.md`.
