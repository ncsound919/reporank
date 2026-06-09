import { describe, it, expect } from "vitest";
import { dedupeFindings, capFindings } from "../util/dedupe";
import type { Finding } from "../review_scanner";

const baseFinding = (overrides: Partial<Finding> = {}): Finding => ({
  category: "security",
  severity: "high",
  line: 5,
  type: "sql-injection",
  description: "test",
  recommendation: "fix it",
  confidence: 0.9,
  ...overrides,
});

describe("dedupeFindings", () => {
  it("keeps highest-confidence finding of same type on same line", () => {
    const findings = [
      baseFinding({ type: "sql-injection", line: 3, confidence: 0.5 }),
      baseFinding({ type: "sql-injection", line: 3, confidence: 0.9 }),
    ];
    const deduped = dedupeFindings(findings);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].confidence).toBe(0.9);
  });

  it("keeps different types on same line", () => {
    const findings = [
      baseFinding({ type: "sql-injection", line: 5 }),
      baseFinding({ type: "hardcoded-secret", line: 5 }),
    ];
    expect(dedupeFindings(findings)).toHaveLength(2);
  });

  it("treats types with shared token as near-dupe when lines close", () => {
    const findings = [
      baseFinding({ type: "sql-injection", line: 3 }),
      baseFinding({ type: "sql-injection", line: 5 }),
    ];
    const deduped = dedupeFindings(findings);
    expect(deduped).toHaveLength(1);
  });
});

describe("capFindings", () => {
  it("caps findings to N per (category, type)", () => {
    const findings = [
      baseFinding({ line: 1 }),
      baseFinding({ line: 2 }),
      baseFinding({ line: 3 }),
    ];
    const capped = capFindings(findings, 2);
    expect(capped).toHaveLength(2);
  });
});
