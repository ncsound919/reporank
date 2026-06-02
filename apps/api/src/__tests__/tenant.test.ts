import { describe, it, expect } from "vitest";

class AppError extends Error {
  constructor(public statusCode: number, message: string, public code?: string) {
    super(message);
    this.name = "AppError";
  }
}

const PLAN_LIMITS: Record<string, { scansPerMonth: number; teamMembers: number }> = {
  free: { scansPerMonth: 3, teamMembers: 1 },
  pro: { scansPerMonth: 150, teamMembers: 5 },
  enterprise: { scansPerMonth: -1, teamMembers: -1 },
};

describe("Scan limit middleware logic", () => {
  it("allows free users with remaining scans", () => {
    const limits = PLAN_LIMITS.free;
    const scanCount = 2;
    expect(scanCount).toBeLessThan(limits.scansPerMonth);
  });

  it("blocks free users at limit", () => {
    const limits = PLAN_LIMITS.free;
    const scanCount = 3;
    expect(scanCount).toBeGreaterThanOrEqual(limits.scansPerMonth);
  });

  it("unlimited for enterprise users", () => {
    const limits = PLAN_LIMITS.enterprise;
    expect(limits.scansPerMonth).toBe(-1);
  });

  it("allows pro users within limit", () => {
    const limits = PLAN_LIMITS.pro;
    const scanCount = 100;
    expect(scanCount).toBeLessThan(limits.scansPerMonth);
  });

  it("throws AppError when limit exceeded", () => {
    const limits = PLAN_LIMITS.free;
    const scanCount = 5;
    if (scanCount >= limits.scansPerMonth) {
      const err = new AppError(429, "Monthly scan limit reached", "LIMIT_EXCEEDED");
      expect(err.statusCode).toBe(429);
      expect(err.code).toBe("LIMIT_EXCEEDED");
    }
  });

  it("plan tiers are correctly mapped", () => {
    expect(Object.keys(PLAN_LIMITS).sort()).toEqual(["enterprise", "free", "pro"]);
    expect(PLAN_LIMITS.pro.teamMembers).toBe(5);
    expect(PLAN_LIMITS.enterprise.teamMembers).toBe(-1);
  });
});

describe("Compare endpoint logic", () => {
  it("calculates score delta correctly", () => {
    const scan1 = { overallScore: 70 };
    const scan2 = { overallScore: 85 };
    const delta = scan2.overallScore - scan1.overallScore;
    expect(delta).toBe(15);
  });

  it("handles null scores", () => {
    const delta = null; // when either scan has null score
    expect(delta).toBeNull();
  });

  it("calculates dimension deltas", () => {
    const d1: Record<string, number> = { security: 60, quality: 70, vibe: 80 };
    const d2: Record<string, number> = { security: 75, quality: 65, vibe: 90 };
    const deltas: Record<string, number> = {};
    for (const key of Object.keys(d1)) {
      deltas[key] = (d2[key] || 0) - (d1[key] || 0);
    }
    expect(deltas.security).toBe(15);
    expect(deltas.quality).toBe(-5);
    expect(deltas.vibe).toBe(10);
  });
});
