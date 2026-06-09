import { describe, it, expect } from "vitest";
import { formatAsReviewDogComment } from "../integrations/reviewdog";
import type { Finding } from "../review_scanner";

const baseFinding = (overrides: Partial<Finding> = {}): Finding => ({
  category: "security",
  severity: "high",
  line: 5,
  type: "sql-injection",
  description: "User input concatenated into SQL",
  recommendation: "Use parameterised query",
  confidence: 0.95,
  path: "src/db.ts",
  ...overrides,
});

describe("formatAsReviewDogComment", () => {
  it("groups findings by file", () => {
    const findings = [
      baseFinding({ path: "src/a.ts", line: 1 }),
      baseFinding({ path: "src/a.ts", line: 5 }),
      baseFinding({ path: "src/b.ts", line: 3 }),
    ];
    const md = formatAsReviewDogComment(findings);
    expect(md).toContain("## src/a.ts");
    expect(md).toContain("## src/b.ts");
  });

  it("includes severity emoji", () => {
    const findings = [
      baseFinding({ severity: "critical" }),
      baseFinding({ severity: "high", type: "other" }),
    ];
    const md = formatAsReviewDogComment(findings);
    expect(md).toContain("🔴");
    expect(md).toContain("⚠️");
  });

  it("produces a markdown table", () => {
    const findings = [baseFinding()];
    const md = formatAsReviewDogComment(findings);
    expect(md).toContain("| Severity | Line | Type | Description |");
  });
});
