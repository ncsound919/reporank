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

const app: express.Express = express();
app.use(helmet());
app.use(cors({ origin: process.env.APP_URL || "http://localhost:5173", credentials: true }));
app.use(apiRateLimit);

// Stripe webhook needs raw body for signature verification — mount BEFORE express.json()
app.use("/api/v1/billing/webhook", express.raw({ type: "application/json" }));

app.use(express.json());

app.get("/health", (_req, res) => res.json({ status: "ok", timestamp: new Date().toISOString() }));
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/scans", scanRoutes);
app.use("/api/v1/billing", billingRoutes);
app.use("/api/v1/orgs", orgRoutes);
app.use("/api/v1/badges", badgeRoutes);
app.use("/api/v1/compare", compareRoutes);

app.use(errorHandler);
export default app;
