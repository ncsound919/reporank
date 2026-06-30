/**
 * Centralized constants to avoid magic strings throughout the codebase.
 */

function defineEnum<const T extends Record<string, string>>(values: T): Readonly<T> {
  return Object.freeze(values);
}

// Scan status values
export const ScanStatus = defineEnum({
  QUEUED: "queued",
  CLONING: "cloning",
  SCANNING: "scanning",
  GRADING: "grading",
  COMPLETE: "complete",
  ERROR: "error",
});

export type ScanStatusValue = (typeof ScanStatus)[keyof typeof ScanStatus];

// Project brief status values
export const BriefStatus = defineEnum({
  PENDING: "pending",
  APPROVED: "approved",
});

export type BriefStatusValue = (typeof BriefStatus)[keyof typeof BriefStatus];

// Milestone status values
export const MilestoneStatus = defineEnum({
  PENDING: "pending",
  ACHIEVED: "achieved",
});

export type MilestoneStatusValue = (typeof MilestoneStatus)[keyof typeof MilestoneStatus];

// Gate status values
export const GateStatus = defineEnum({
  PENDING: "pending",
  PASSED: "passed",
  FAILED: "failed",
  OVERRIDDEN: "overridden",
});

export type GateStatusValue = (typeof GateStatus)[keyof typeof GateStatus];

// Subscription status values
export const SubscriptionStatus = defineEnum({
  ACTIVE: "active",
  CANCELED: "canceled",
});

export type SubscriptionStatusValue = (typeof SubscriptionStatus)[keyof typeof SubscriptionStatus];

// Drift status values
export const DriftStatus = defineEnum({
  ON_SCOPE: "on-scope",
  AT_RISK: "at-risk",
  DRIFTING: "drifting",
  BLOCKED: "blocked",
});

export type DriftStatusValue = (typeof DriftStatus)[keyof typeof DriftStatus];

// Grade categories
export const GradeCategory = defineEnum({
  A_PLUS: "A+",
  A: "A",
  B_PLUS: "B+",
  B: "B",
  C: "C",
  D: "D",
  F: "F",
});

export type GradeCategoryValue = (typeof GradeCategory)[keyof typeof GradeCategory];

// Severity levels
export const Severity = defineEnum({
  CRITICAL: "critical",
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
  WARNING: "WARNING",
});

export type SeverityValue = (typeof Severity)[keyof typeof Severity];

// Evidence levels
export const EvidenceLevel = defineEnum({
  VERIFIED: "verified",
  INFERRED: "inferred",
  MISSING_PROOF: "missing-proof",
  HUMAN_NEEDED: "human-needed",
});

export type EvidenceLevelValue = (typeof EvidenceLevel)[keyof typeof EvidenceLevel];

// Error codes
export const ErrorCodes = defineEnum({
  FORBIDDEN: "FORBIDDEN",
  UNAUTHORIZED: "UNAUTHORIZED",
  NOT_FOUND: "NOT_FOUND",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  P2002: "P2002",
  NO_SCAN: "NO_SCAN",
});

export type ErrorCodeValue = (typeof ErrorCodes)[keyof typeof ErrorCodes];

// Badge colors
export const BadgeColor = defineEnum({
  BRIGHT_GREEN: "brightgreen",
  GREEN: "green",
  YELLOW: "yellow",
  ORANGE: "orange",
  RED: "red",
  LIGHT_GREY: "lightgrey",
});

export type BadgeColorValue = (typeof BadgeColor)[keyof typeof BadgeColor];
