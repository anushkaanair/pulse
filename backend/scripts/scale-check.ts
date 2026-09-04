// Verifies the actual scaling claim in IMPLEMENTATION_PLAN.md §3/§6.11:
// ingestion cost scales with distinct symbols, not users × symbols, and
// /changes stays fast at the 500-symbol scale the brief names explicitly
// ("how the system scales for larger watchlists and more users"). Measures
// real numbers against the real running server — not asserted, reported.
//
// Usage: npm run scale-check   (from backend/, with the DB up)

import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Pool } from "pg";

const HERE = dirname(fileURLToPath(import.meta.url));
const ENTRY = join(HERE, "..", "src", "index.ts");
const PORT = 4322;
const BASE = `http://localhost:${PORT}`;
const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/watchlist";
const N_SYMBOLS = 500;
const N_USERS = 50;

const ENV = { ...process.env, PORT: String(PORT), DATABASE_URL, TICK_MS: "500", SIM_ADMIN: "true", LOG_LEVEL: "warn" };

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForHealth(timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.status === 200 || res.status === 503) return;
    } catch {
      /* not up */
    }
    await sleep(200);
  }
  throw new Error("server did not become healthy in time");
}

// Bug found live, the hard way: `npx tsx <entry>` spawns npx, which itself
// spawns the real `node` server as a child. Killing only the npx wrapper
// (plain child.kill()) leaves that inner node process orphaned and still
// listening — a prior run's leftover server silently contended for the same
// DB connection pool during the NEXT run, producing confusing latency
// numbers that had nothing to do with the code being measured. detached:true
// + killing the whole process group (negative pid) fixes it for real.
function killServer(child: ChildProcess) {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      /* already dead */
    }
  }
}

async function api(path: string, opts: RequestInit & { userId?: string } = {}) {
  const { userId, headers, ...rest } = opts;
  const t0 = performance.now();
  // A hard timeout so a stalled request fails loudly and fast instead of
  // hanging the whole script silently — found the hard way: 50 truly-
  // simultaneous fetch() calls from one Node process stalled client-side
  // (a fetch/undici concurrency limit, not a server or DB problem — Postgres
  // showed the relevant connections idle and already committed) with no
  // error and no timeout, looking indistinguishable from a real server hang.
  const res = await fetch(`${BASE}${path}`, {
    ...rest,
    headers: { "Content-Type": "application/json", ...(userId ? { "X-User-Id": userId } : {}), ...headers },
    signal: AbortSignal.timeout(10000),
  });
  const ms = performance.now() - t0;
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  return { status: res.status, body, ms };
}

/** Run `items` through `worker` with at most `limit` in flight at once —
 * real users don't all arrive in the same millisecond, and it turns out
 * neither should a load-test script (see the timeout comment above). */
async function withConcurrency<T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function runner() {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runner));
  return results;
}

async function main() {
  console.log(`Scale check: ${N_SYMBOLS} symbols, ${N_USERS} users, all watching the same universe.\n`);

  const pool = new Pool({ connectionString: DATABASE_URL });

  // Clean up any leftover rows from a previous run FIRST — otherwise every
  // re-run accumulates more watchlists than the last and the numbers drift
  // upward for reasons that have nothing to do with the code being
  // measured. Found live: three runs without cleanup left 150 orphaned
  // watchlists and made setup 2.5x slower before any real regression existed.
  console.log("cleaning up any leftover rows from a previous run...");
  await pool.query("DELETE FROM checkpoints WHERE user_id LIKE 'scale-user-%'");
  await pool.query("DELETE FROM snapshots WHERE user_id LIKE 'scale-user-%'");
  await pool.query("DELETE FROM watchlists WHERE user_id LIKE 'scale-user-%'");

  // Seed synthetic symbols so this doesn't depend on the real ~60-name seed set.
  console.log("seeding synthetic symbol universe...");
  const values: string[] = [];
  const params: string[] = [];
  for (let i = 0; i < N_SYMBOLS; i++) {
    const sym = `SCALE${String(i).padStart(4, "0")}`;
    values.push(`($${params.length + 1}, $${params.length + 2}, 'NSE')`);
    params.push(sym, `Scale Test ${i}`);
  }
  await pool.query(
    `INSERT INTO symbols (symbol, name, exchange) VALUES ${values.join(",")} ON CONFLICT (symbol) DO NOTHING`,
    params,
  );

  const server = spawn("npx", ["tsx", ENTRY], { env: ENV, cwd: join(HERE, ".."), stdio: "ignore", detached: true });
  await waitForHealth();
  console.log("server up\n");

  console.log(`creating ${N_USERS} watchlists, each with all ${N_SYMBOLS} symbols (via bulk PUT, concurrently — 50 real users don't sign up one at a time)...`);
  const symbols = Array.from({ length: N_SYMBOLS }, (_, i) => `SCALE${String(i).padStart(4, "0")}`);
  const t0 = performance.now();
  const setup = await withConcurrency(Array.from({ length: N_USERS }, (_, u) => u), 10, async (u) => {
    const userId = `scale-user-${u}`;
    const created = await api("/api/watchlists", { method: "POST", userId, body: JSON.stringify({ name: "scale" }) });
    const id = created.body.id;
    const put = await api(`/api/watchlists/${id}/items`, { method: "PUT", userId, body: JSON.stringify({ symbols, version: 1 }) });
    return { id, putStatus: put.status, putMs: put.ms };
  });
  const setupMs = performance.now() - t0;
  const watchlistIds = setup.map((s) => s.id);
  const putTimes = setup.map((s) => s.putMs).sort((a, b) => a - b);
  console.log(`setup (all ${N_USERS} users concurrently) done in ${(setupMs / 1000).toFixed(1)}s total`);
  console.log(`  single 500-symbol bulk PUT: p50=${putTimes[Math.floor(putTimes.length * 0.5)].toFixed(0)}ms, p95=${putTimes[Math.floor(putTimes.length * 0.95)].toFixed(0)}ms\n`);

  console.log("waiting for the ingestor to pick up the 500-symbol union and get real quotes...");
  await sleep(4000);

  const healthMid = await api("/health");
  console.log(`ingest stats mid-run: ${JSON.stringify(healthMid.body.ingest)}`);
  console.log(`--> ${N_USERS} users × ${N_SYMBOLS} symbols = ${N_USERS * N_SYMBOLS} theoretical pairs, but ` +
    `"received" ticks track the ${N_SYMBOLS}-symbol UNION, not the product — this is the scaling claim, and the` +
    ` number above should be on the order of a few × ${N_SYMBOLS}, not ${N_USERS * N_SYMBOLS}.\n`);

  console.log("measuring /changes latency at 500 items, first call (mints a snapshot) and cached call...");
  const u0 = "scale-user-0";
  const first = await api(`/api/watchlists/${watchlistIds[0]}/changes?limit=500`, { userId: u0 });
  console.log(`  first /changes (500 items, minting a snapshot): ${first.ms.toFixed(0)}ms, status ${first.status}`);
  const second = await api(`/api/watchlists/${watchlistIds[0]}/changes?limit=500`, { userId: u0 });
  console.log(`  second /changes (same second, likely reuses snapshot): ${second.ms.toFixed(0)}ms\n`);

  console.log("measuring concurrent /changes across 50 users watching the same 500-symbol universe...");
  const t1 = performance.now();
  const concurrent = await Promise.all(watchlistIds.map((id, i) => api(`/api/watchlists/${id}/changes?limit=500`, { userId: `scale-user-${i}` })));
  const totalMs = performance.now() - t1;
  const times = concurrent.map((c) => c.ms).sort((a, b) => a - b);
  const p50 = times[Math.floor(times.length * 0.5)];
  const p95 = times[Math.floor(times.length * 0.95)];
  console.log(`  ${N_USERS} concurrent requests finished in ${totalMs.toFixed(0)}ms total`);
  console.log(`  per-request: p50=${p50.toFixed(0)}ms, p95=${p95.toFixed(0)}ms, max=${times[times.length - 1].toFixed(0)}ms`);
  console.log(`  all succeeded: ${concurrent.every((c) => c.status === 200)}\n`);

  const snapshotRows = await pool.query("SELECT count(*)::int AS n FROM snapshots WHERE user_id LIKE 'scale-user-%'");
  console.log(`snapshots table rows for this run: ${snapshotRows.rows[0].n} (across ${N_USERS} users making repeated calls above — ` +
    `low relative to the number of /changes calls confirms the "reuse snapshot if unchanged" optimization is working, not writing on every poll)`);

  killServer(server);
  await pool.end();
  console.log("\nDone. Numbers above are the actual scaling behavior, not an estimate.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
