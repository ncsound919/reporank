import { describe, it, expect } from "vitest";
import { extractScanTrustInputs } from "../services/trustHelper";

describe("extractScanTrustInputs", () => {
  it("extracts overallScore, vibe, and security from a scan", () => {
    const inputs = extractScanTrustInputs({
      overallScore: 80,
      report: { vibeCodingIndex: { overallScore: 25 } },
      clawFindings: { critical: 0, high: 1, medium: 2, low: 0 },
    });
    expect(inputs.overallScore).toBe(80);
    expect(inputs.vibeCodingIndex).toBe(25);
    expect(inputs.securityFindings).toEqual({ critical: 0, high: 1, medium: 2, low: 0 });
  });

  it("returns zeros for missing fields", () => {
    const inputs = extractScanTrustInputs({});
    expect(inputs.overallScore).toBe(0);
    expect(inputs.vibeCodingIndex).toBe(0);
    expect(inputs.securityFindings).toBeUndefined();
  });

  it("handles null report and clawFindings gracefully", () => {
    const inputs = extractScanTrustInputs({ report: null, clawFindings: null });
    expect(inputs.overallScore).toBe(0);
    expect(inputs.vibeCodingIndex).toBe(0);
    expect(inputs.securityFindings).toBeUndefined();
  });

  it("handles malformed JSON gracefully (missing nested fields)", () => {
    const inputs = extractScanTrustInputs({
      overallScore: 75,
      report: { vibeCodingIndex: {} },
      clawFindings: { critical: undefined, high: undefined, medium: 3, low: 1 },
    });
    expect(inputs.vibeCodingIndex).toBe(0);
    expect(inputs.securityFindings).toEqual({ critical: 0, high: 0, medium: 3, low: 1 });
  });
});
