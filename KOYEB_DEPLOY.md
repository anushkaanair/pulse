# Deploying the backend to Koyeb + Neon (always-on, ~$5.50/mo)

Koyeb has no git-committed blueprint like Render's `render.yaml` — it's
configured once in their dashboard. This is the exact sequence; the
`Dockerfile` and `.dockerignore` in `backend/` are already prepared and
tested (built + booted locally against Postgres before this was written).

## 1. Database: Neon (free, doesn't expire, fast resume)

1. Sign up at [neon.tech](https://neon.tech) (GitHub sign-in is fastest).
2. Create a project → note the **connection string** it gives you
   (`postgres://...`). Use the **pooled** connection string if offered —
   it handles the same concurrent-request load pattern this backend's
   pool.ts already tunes for.
3. Send me that connection string and I'll run `npm run migrate` against
   it once, so the schema exists before the backend ever boots. (Or run
   it yourself: `DATABASE_URL="<your string>" npm run migrate` from
   `backend/`.)

## 2. Backend: Koyeb

1. Sign up at [koyeb.com](https://koyeb.com), connect your GitHub account.
2. **Create Service** → **GitHub** → select `anushkaanair/pulse`.
3. Builder: choose **Dockerfile**. Set the **Dockerfile location** and
   **work directory** to `backend` (the repo root has both `backend/` and
   `frontend/` — point Koyeb at `backend/Dockerfile`).
4. **Instance type**: pick a paid type (e.g. **Small**, ~$5.50/mo) — the
   free instance forces scale-to-zero after 1 hour idle and can't be
   changed, which is exactly the risk we're avoiding.
5. **Scaling**: set min instances to **1** and disable/raise the idle
   timeout so it never scales to zero. (Paid instance types support this;
   the free tier doesn't — that's the whole point of paying here.)
6. **Ports**: expose port **4000**, health check path **`/health`**.
7. **Environment variables**:
   - `DATABASE_URL` = the Neon connection string from step 1
   - `SIM_ADMIN` = `true`
   - `CORS_ORIGINS` = `https://pulse-groww.vercel.app`
8. Deploy. Koyeb gives you a URL like `https://<name>.koyeb.app` —
   send that to me and I'll point the frontend at it, redeploy, and run
   the same end-to-end verification pass (health, ticker, search,
   add-stock, real change computation) done for the Render attempt.

## Why not a committed config file, like Render's

Koyeb's git-based deploys are configured through the dashboard (or their
CLI with explicit flags), not a YAML file read from the repo — there's no
`koyeb.yaml` blueprint format to commit. The Dockerfile is the portable
part; the settings above are the one-time dashboard setup.
