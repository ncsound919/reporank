import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { healthRoute } from "./routes/health";
import { llmCompleteRoute } from "./routes/llm-complete";

const app = new Hono();

app.route("/health", healthRoute);
app.route("/v1/llm", llmCompleteRoute);

app.notFound((c) => c.json({ status: "error", error: "not found" }, 404));

const port = Number(process.env.PORT || 3002);
serve({ fetch: app.fetch, port }, (info) => {
  process.stdout.write(`Mutly HTTP server listening on http://localhost:${info.port}`);
  process.stdout.write(`Endpoints:`);
  process.stdout.write(`  GET  /health`);
  process.stdout.write(`  POST /v1/llm/complete`);
});

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
