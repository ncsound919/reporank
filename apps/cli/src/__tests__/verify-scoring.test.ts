import { describe, it, expect } from "vitest";
import { computeQualityScore } from "../verify";
import type { Finding } from "../review_scanner";

function finding(severity: Finding["severity"], confidence = 1): Finding {
  return {
    category: "quality",
    severity,
    line: 1,
    type: "test-finding",
    description: "synthetic",
    recommendation: "fix it",
    confidence,
  };
}

describe("computeQualityScore", () => {
  it("returns 100 when there are no findings", () => {
    expect(computeQualityScore([])).toBe(100);
  });

  it("does not raise the score when more files carry the same findings", () => {
    const perFile = [finding("high"), finding("medium")];
    const oneFile = computeQualityScore(perFile);
    const threeFiles = computeQualityScore([...perFile, ...perFile, ...perFile]);
    // The old sqrt(fileCount) divisor made this go UP as files were added.
    expect(threeFiles).toBeLessThanOrEqual(oneFile);
  });

  it("weights the penalty by confidence", () => {
    const highConfidence = computeQualityScore([finding("high", 1)]);
    const lowConfidence = computeQualityScore([finding("high", 0)]);
    expect(lowConfidence).toBeGreaterThan(highConfidence);
  });

  it("caps the total penalty so the score never goes below 0", () => {
    const many = Array.from({ length: 50 }, () => finding("critical", 1));
    expect(computeQualityScore(many)).toBe(0);
  });
});
