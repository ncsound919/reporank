import express from "express";
import cors from "cors";
import helmet from "helmet";
import { errorHandler } from "./middleware/errorHandler";
import authRoutes from "./routes/auth";
import scanRoutes from "./routes/scans";

const app: express.Express = express();
app.use(helmet());
app.use(cors({ origin: process.env.APP_URL || "http://localhost:5173", credentials: true }));
app.use(express.json());

app.get("/health", (_req, res) => res.json({ status: "ok", timestamp: new Date().toISOString() }));
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/scans", scanRoutes);

app.use(errorHandler);
export default app;
