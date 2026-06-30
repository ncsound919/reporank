import "express-async-errors";
import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import helmet from "helmet";
import { errorHandler } from "./middleware/errorHandler";
import { apiRateLimit } from "./middleware/tenant";
import authRoutes from "./routes/auth";
import scanRoutes from "./routes/scans";
import billingRoutes from "./routes/billing";
import orgRoutes from "./routes/orgs";
import badgeRoutes from "./routes/badges";
import compareRoutes from "./routes/compare";
import agentRoutes from "./routes/agents";
import prRoutes from "./routes/prs";
import educationRoutes from "./routes/education";
import trustRoutes from "./routes/trust";
import projectRoutes from "./routes/projects";
import milestoneRoutes from "./routes/milestones";
import driftRoutes from "./routes/drift";
import gateRoutes from "./routes/gates";
import changeControlRoutes from "./routes/changeControl";
import intentRoutes from "./routes/intent";
import dashboardRoutes from "./routes/dashboards";
import timeseriesRoutes from "./routes/timeseries";
import scopeComplianceRoutes from "./routes/scopeCompliance";
import webhookRoutes from "./routes/webhooks";
import internalRoutes from "./routes/internal";

type RawBodyRequest = Request & {
  rawBody?: Buffer;
};

const app: express.Express = express();
const appUrl = process.env.APP_URL || "http://localhost:5173";

app.disable("x-powered-by");

app.use(helmet());
app.use(
  cors({
    origin: appUrl,
    credentials: true,
  }),
);

// Badge endpoint has its own relaxed rate limit and is cached — mount before global rate limiter
app.use("/api/v1/badges", badgeRoutes);

app.use(apiRateLimit);

// Stripe webhook needs raw body for signature verification — mount BEFORE express.json()
app.use(
  "/api/v1/billing/webhook",
  express.raw({
    type: "application/json",
    limit: "2mb",
  }),
);

// Generic webhook raw body capture — mount BEFORE express.json()
app.use(
  "/webhooks",
  express.raw({
    type: "*/*",
    limit: "2mb",
  }),
  (req: Request, _res: Response, next: NextFunction) => {
    const rawReq = req as RawBodyRequest;

    if (Buffer.isBuffer(req.body)) {
      rawReq.rawBody = req.body;

      if (req.is("application/json")) {
        try {
          req.body = JSON.parse(req.body.toString("utf8"));
        } catch {
          // Leave req.body as Buffer so downstream verification/handlers can decide how to respond.
        }
      }
    }

    next();
  },
);

app.use(
  express.json({
    limit: "10mb",
  }),
);

app.get("/health", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

app.use("/api", (_req: Request, res: Response, next: NextFunction) => {
  if (!process.env.DATABASE_URL) {
    return res.status(503).json({ error: "Database not configured" });
  }

  next();
});

app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/scans", scanRoutes);
app.use("/api/v1/billing", billingRoutes);
app.use("/api/v1/orgs", orgRoutes);
app.use("/api/v1/agents", agentRoutes);
app.use("/api/v1/prs", prRoutes);
app.use("/api/v1/education", educationRoutes);
app.use("/api/v1/compare", compareRoutes);
app.use("/api/v1/trust", trustRoutes);
app.use("/api/v1/projects", projectRoutes);
app.use("/api/v1/milestones", milestoneRoutes);
app.use("/api/v1/drift", driftRoutes);
app.use("/api/v1/gates", gateRoutes);
app.use("/api/v1", changeControlRoutes);
app.use("/api/v1", intentRoutes);
app.use("/api/v1/dashboards", dashboardRoutes);
app.use("/api/v1/scans", timeseriesRoutes);
app.use("/api/v1/scope-compliance", scopeComplianceRoutes);
app.use("/webhooks", webhookRoutes);
app.use("/api/v1/internal", internalRoutes);

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: "Not found" });
});

app.use(errorHandler);

export default app;
