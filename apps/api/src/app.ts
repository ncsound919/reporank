import "express-async-errors";
import express from "express";
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

const app: express.Express = express();
app.use(helmet());
app.use(cors({ origin: process.env.APP_URL || "http://localhost:5173", credentials: true }));

// Badge endpoint has its own relaxed rate limit and is cached — mount before global rate limiter
app.use("/api/v1/badges", badgeRoutes);

app.use(apiRateLimit);

// Stripe webhook needs raw body for signature verification — mount BEFORE express.json()
app.use("/api/v1/billing/webhook", express.raw({ type: "application/json" }));

// GitHub webhook needs raw body for signature verification — mount BEFORE express.json()
app.use("/webhooks", express.raw({ type: "application/json" }), (req: any, res, next) => {
  req.rawBody = req.body;
  next();
});

app.use(express.json({ limit: "10mb" }));

app.get("/health", (_req, res) => res.json({ status: "ok", timestamp: new Date().toISOString() }));
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

app.use(errorHandler);
export default app;
