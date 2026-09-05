# Deploying Pulse (production)

The live deployment runs on:

- **Frontend** → Vercel (static/serverless Next.js) at `pulse-groww.vercel.app`.
- **Backend** → Railway (always-on container, serverless mode OFF) built from
  `backend/Dockerfile`.
- **Database** → Neon (managed Postgres; the connection string is set as the
  Railway `DATABASE_URL` variable). Migrations run automatically on boot.

## Backend (Railway)

The backend is a long-running Express process with a stateful market
ingestor (a `setInterval` poll loop) — a persistent service, not
serverless. The one setting that matters for reliability: **Serverless is
disabled** on the service (Settings → Deploy → Enable Serverless = off), so
it never scales to zero and never cold-starts. That requires a paid plan;
the free tier forces serverless on.

Railway variables:

- `DATABASE_URL` — the Neon connection string
- `SIM_ADMIN` — `true` (exposes `POST /api/_sim/faults` for the live
  resilience demo; it's a demo control surface, not user data)
- `CORS_ORIGINS` — `https://pulse-groww.vercel.app`

Railway injects `PORT` itself; the app binds it via `config.port`.

Redeploy with `railway up` from `backend/`, or push to the connected repo.

## Frontend (Vercel)

Environment variables (Production):

- `NEXT_PUBLIC_API_URL` — the Railway backend URL
- `NEXT_PUBLIC_USE_MOCK` — `false` (true switches to the zero-backend mock
  layer used for local dev / e2e)
- `NEXT_PUBLIC_SIM_ADMIN` — `true` (shows the fault-injection dev panel)

Redeploy: `vercel --prod` from `frontend/`.

## Portable alternative

`backend/Dockerfile` + `backend/fly.toml` also deploy the same backend to
Fly.io (`fly deploy` from `backend/`) — kept as a portable fallback. The
`min_machines_running = 1` / `auto_stop_machines = "off"` settings there are
the Fly equivalent of disabling Railway's serverless mode.
