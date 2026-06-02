import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the prisma client so the route handler doesn't try to connect to a real DB
vi.mock("../db/client", () => ({
  prisma: {
    scan: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

import request from "supertest";
import express from "express";
import trustRoutes from "../routes/trust";
import { authMiddleware } from "../middleware/auth";
import { errorHandler } from "../middleware/errorHandler";
import { prisma } from "../db/client";

vi.mock("../middleware/auth", () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.userId = "user-1";
    next();
  },
  AuthRequest: class {},
}));

function makeApp(opts: { withAuth?: boolean } = {}) {
  const app = express();
  app.use(express.json());
  if (opts.withAuth !== false) {
    app.use("/api/v1/trust", authMiddleware as any, trustRoutes);
  } else {
    app.use("/api/v1/trust", trustRoutes);
  }
  app.use(errorHandler);
  return app;
}

describe("POST /api/v1/trust", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("computes trust score from inline input", async () => {
    const res = await request(makeApp())
      .post("/api/v1/trust")
      .send({
        overallScore: 85,
        vibeCodingIndex: 20,
        securityFindings: { critical: 0, high: 0, medium: 1, low: 2 },
      });
    expect(res.status).toBe(200);
    expect(res.body.data.trust).toBeGreaterThan(50);
    expect(res.body.data.grade).toMatch(/A|B|C|D|F/);
  });

  it("rejects invalid input types (400)", async () => {
    const res = await request(makeApp())
      .post("/api/v1/trust")
      .send({ overallScore: "not a number" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("hydrates from scanId when provided", async () => {
    (prisma.scan.findFirst as any).mockResolvedValue({
      id: "scan-1",
      userId: "user-1",
      overallScore: 90,
      report: { vibeCodingIndex: { overallScore: 15 } },
      clawFindings: { critical: 0, high: 1, medium: 2, low: 0 },
    });
    const res = await request(makeApp())
      .post("/api/v1/trust")
      .send({ scanId: "scan-1" });
    expect(res.status).toBe(200);
    expect(res.body.data.trust).toBeGreaterThan(60);
  });

  it("returns 404 when scanId not found", async () => {
    (prisma.scan.findFirst as any).mockResolvedValue(null);
    const res = await request(makeApp())
      .post("/api/v1/trust")
      .send({ scanId: "nonexistent" });
    expect(res.status).toBe(404);
  });
});

describe("GET /api/v1/trust/scan/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns trust score for a stored scan", async () => {
    (prisma.scan.findFirst as any).mockResolvedValue({
      id: "scan-1",
      userId: "user-1",
      overallScore: 75,
      report: { vibeCodingIndex: { overallScore: 30 } },
      clawFindings: { critical: 0, high: 0, medium: 0, low: 1 },
    });
    const res = await request(makeApp()).get("/api/v1/trust/scan/scan-1");
    expect(res.status).toBe(200);
    expect(res.body.data.grade).toBeDefined();
  });
});

describe("Public badge routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns SVG for /trust/:scanId.svg", async () => {
    (prisma.scan.findUnique as any).mockResolvedValue({
      id: "scan-1",
      overallScore: 80,
      report: { vibeCodingIndex: { overallScore: 25 } },
      clawFindings: { critical: 0, high: 0, medium: 0, low: 0 },
    });
    const res = await request(makeApp({ withAuth: false })).get("/api/v1/trust/trust/scan-1.svg");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("image/svg+xml");
    const text = typeof res.text === "string" ? res.text : res.body?.toString() ?? "";
    expect(text).toContain("<svg");
  });

  it("returns SVG for /vibe/:scanId.svg", async () => {
    (prisma.scan.findUnique as any).mockResolvedValue({
      id: "scan-1",
      overallScore: 80,
      report: { vibeCodingIndex: { overallScore: 15 } },
    });
    const res = await request(makeApp({ withAuth: false })).get("/api/v1/trust/vibe/scan-1.svg");
    expect(res.status).toBe(200);
    const text = typeof res.text === "string" ? res.text : res.body?.toString() ?? "";
    expect(text).toContain("vibe coding");
  });

  it("returns SVG for /software20/:scanId.svg", async () => {
    (prisma.scan.findUnique as any).mockResolvedValue({
      id: "scan-1",
      overallScore: 80,
      report: { software20Score: { overall: 70 } },
    });
    const res = await request(makeApp({ withAuth: false })).get("/api/v1/trust/software20/scan-1.svg");
    expect(res.status).toBe(200);
    const text = typeof res.text === "string" ? res.text : res.body?.toString() ?? "";
    expect(text).toContain("software 2.0");
  });

  it("returns 404 for unknown scan on badge routes", async () => {
    (prisma.scan.findUnique as any).mockResolvedValue(null);
    const res = await request(makeApp({ withAuth: false })).get("/api/v1/trust/vibe/missing.svg");
    expect(res.status).toBe(404);
  });
});
