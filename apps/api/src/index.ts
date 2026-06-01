import app from "./app";
import { config } from "./config";
import { registerShutdownHandlers } from "./shutdown";
import { startWorker } from "./jobs/scanWorker";
import { logger } from "./logger";

const server = app.listen(config.port, () => {
  logger.info(`RepoRank API running on port ${config.port}`);
  startWorker();
});

registerShutdownHandlers(server);
