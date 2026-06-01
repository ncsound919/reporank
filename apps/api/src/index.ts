import app from "./app";
import { config } from "./config";
import { registerShutdownHandlers } from "./shutdown";
import { startWorker } from "./jobs/scanWorker";

const server = app.listen(config.port, () => {
  console.log(`RepoRank API running on port ${config.port}`);
  startWorker();
});

registerShutdownHandlers(server);
