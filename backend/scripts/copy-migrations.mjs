// tsc only emits compiled .js for .ts files — the .sql migration files
// under src/db/migrations never make it into dist/, so a production build
// (tsc + node dist/index.js, as opposed to local `npm run dev`'s tsx-on-src)
// boots and immediately fails: migrate() scandir's a directory that was
// never copied. Found live on the first real deploy (Render) — local dev
// and `npm test` both run straight off src/, so this had no way to surface
// until something actually ran the built output.
import { cpSync, mkdirSync } from "node:fs";

mkdirSync("dist/db/migrations", { recursive: true });
cpSync("src/db/migrations", "dist/db/migrations", { recursive: true });
