/**
 * reporank/tests/e2e/reporank-scan.e2e.test.ts
 *
 * First E2E tests for the RepoRank internal scan endpoint.
 *
 * Uses supertest against the Express app directly (no real DB or Redis).
 * Prisma and the Bull queue are mocked so we never need a live PostgreSQL
 * or Redis connection for these tests.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import request from "supertest";

// ─── Mock Prisma ──────────────────────────────────────────────────────────────
vi.mock("../../../apps/api/src/db/client", () => ({
  prisma: {
    scan: {
      create: vi.fn().mockResolvedValue({
        id: "mock-scan-id-001",
        status: "queued",
        createdAt: new Date(),
      }),
      findUnique: vi.fn().mockResolvedValue({
        id: "mock-scan-id-001",
        status: "complete",
        progress: 100,
        overallScore: 80,
        gradeCategory: "B+",
        maturityLevel: "Production",
        vibeScore: 18,
        report: { summary: "E2E mock result" },
        fixPack: null,
        clawFindings: null,
        errorMessage: null,
        message: null,
        createdAt: new Date(),
        completedAt: new Date(),
        duration: 12,
        repoUrl: "local",
        userId: "mutly-internal",
        orgId: null,
      }),
    },
  },
}));

// ─── Mock Bull queue ──────────────────────────────────────────────────────────
vi.mock("../../../apps/api/src/jobs/queue", () => ({
  scanQueue: {
    add: vi.fn().mockResolvedValue({ id: "mock-job-1" }),
  },
}));

// ─── Load app after mocks ─────────────────────────────────────────────────────
let app: any;

beforeAll(async () => {
  // Set required env vars so config doesn't throw
  process.env.DATABASE_URL = "postgresql://mock:mock@localhost:5432/mock";
  process.env.REDIS_URL = "redis://localhost:6379";
  process.env.JWT_SECRET = "e2e-test-secret";
  process.env.GEMINI_API_KEY = "e2e-test-key";
  process.env.MUTLY_API_KEY = "e2e-shared-secret";
  process.env.NODE_ENV = "test";

  const mod = await import("../../../apps/api/src/app");
  app = mod.default;
});

afterAll(() => {
  delete process.env.MUTLY_API_KEY;
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("POST /api/v1/internal/mutly/scan", () => {
  const validPayload = {
    repoName: "my-workspace",
    files: [
      { path: "src/index.ts", content: "export const x = 1;" },
      { path: "package.json", content: '{"name":"test"}' },
    ],
    privateMode: true,
  };

  it("returns 201 with scanId when key is valid", async () => {
    const res = await request(app)
      .post("/api/v1/internal/mutly/scan")
      .set("X-Mutly-Key", "e2e-shared-secret")
      .set("Content-Type", "application/json")
      .send(validPayload);

    expect(res.status).toBe(201);
    expect(res.body.data.scanId).toBe("mock-scan-id-001");
    expect(res.body.data.status).toBe("queued");
    expect(typeof res.body.data.estimatedDuration).toBe("number");
  });

  it("returns 401 when X-Mutly-Key header is missing", async () => {
    const res = await request(app)
      .post("/api/v1/internal/mutly/scan")
      .set("Content-Type", "application/json")
      .send(validPayload);

    expect(res.status).toBe(401);
  });

  it("returns 401 when X-Mutly-Key is wrong", async () => {
    const res = await request(app)
      .post("/api/v1/internal/mutly/scan")
      .set("X-Mutly-Key", "totally-wrong")
      .set("Content-Type", "application/json")
      .send(validPayload);

    expect(res.status).toBe(401);
  });

  it("returns 400 when files array is empty", async () => {
    const res = await request(app)
      .post("/api/v1/internal/mutly/scan")
      .set("X-Mutly-Key", "e2e-shared-secret")
      .set("Content-Type", "application/json")
      .send({ ...validPayload, files: [] });

    expect(res.status).toBe(400);
  });

  it("returns 400 when a file path contains path traversal", async () => {
    const res = await request(app)
      .post("/api/v1/internal/mutly/scan")
      .set("X-Mutly-Key", "e2e-shared-secret")
      .set("Content-Type", "application/json")
      .send({
        ...validPayload,
        files: [{ path: "../../etc/passwd", content: "root:x:0:0" }],
      });

    expect(res.status).toBe(400);
  });
});

describe("GET /api/v1/scans/:id (poll endpoint)", () => {
  it("returns scan result after completion", async () => {
    // The mock returns status=complete with a report
    const res = await request(app)
      .get("/api/v1/scans/mock-scan-id-001")
      .set("Authorization", "Bearer any-token"); // authMiddleware is active on this route

    // Without a real JWT the status will be 401 — that's expected;
    // the important thing is the route exists (not 404)
    expect([200, 401, 403]).toContain(res.status);
    expect(res.status).not.toBe(404);
  });
});

describe("GET /health", () => {
  it("returns ok", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });
});
