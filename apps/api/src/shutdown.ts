import { prisma } from "./db/client";
import { scanQueue } from "./jobs/queue";
import { logger } from "./logger";

export function registerShutdownHandlers(server: import("http").Server) {
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down gracefully...`);
    server.close();
    await scanQueue.close();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
