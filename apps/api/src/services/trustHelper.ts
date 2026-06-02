import type { TrustScoreInput } from "@reporank/grading-engine";

export interface ScanLike {
  overallScore?: number | null;
  report?: unknown;
  clawFindings?: unknown;
}

/**
 * Extract Trust Score inputs from a Prisma `scan` row.
 * Defensive against missing/null/malformed fields.
 */
export function extractScanTrustInputs(
  scan: ScanLike,
): Pick<TrustScoreInput, "overallScore" | "vibeCodingIndex" | "securityFindings"> {
  const report = scan.report as
    | { vibeCodingIndex?: { overallScore?: number }; software20Score?: { overall?: number } }
    | null
    | undefined;
  const claw = scan.clawFindings as
    | { critical?: number; high?: number; medium?: number; low?: number }
    | null
    | undefined;
  return {
    overallScore: scan.overallScore ?? 0,
    vibeCodingIndex: report?.vibeCodingIndex?.overallScore ?? 0,
    securityFindings: claw
      ? {
          critical: claw.critical ?? 0,
          high: claw.high ?? 0,
          medium: claw.medium ?? 0,
          low: claw.low ?? 0,
        }
      : undefined,
  };
}
