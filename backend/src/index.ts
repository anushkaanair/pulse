import { createApp } from "./app.js";
import { config } from "./config.js";
import { migrate } from "./db/migrate.js";
import { pool } from "./db/pool.js";
import { logger } from "./logger.js";
import { Ingestor } from "./market/ingestor.js";
import { SimulatedProvider } from "./market/simulatedProvider.js";

async function main() {
  await migrate(); // fresh clone → `npm run dev` just works

  const provider = new SimulatedProvider({ seed: config.simSeed, tickMs: config.tickMs });
  const ingestor = new Ingestor(pool, provider);
  await ingestor.start();

  const app = createApp(pool, ingestor);
  const server = app.listen(config.port, () => {
    logger.info({ port: config.port, provider: provider.name, simAdmin: config.simAdmin }, "backend listening");
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "shutting down");
    server.close();
    await ingestor.stop();
    await pool.end();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  logger.error({ err }, "fatal");
  process.exit(1);
});
