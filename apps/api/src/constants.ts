/**
 * Centralized constants to avoid magic strings throughout the codebase.
 */

// Scan status values
export const ScanStatus = {
  QUEUED: "queued",
  CLONING: "cloning",
  SCANNING: "scanning",
  GRADING: "grading",
  COMPLETE: "complete",
  ERROR: "error",
} as const;

export type ScanStatusValue = (typeof ScanStatus)[keyof typeof ScanStatus];

// Project brief status values
export const BriefStatus = {
  PENDING: "pending",
  APPROVED: "approved",
} as const;

export type BriefStatusValue = (typeof BriefStatus)[keyof typeof BriefStatus];

// Milestone status values
export const MilestoneStatus = {
  PENDING: "pending",
  ACHIEVED: "achieved",
} as const;

export type MilestoneStatusValue = (typeof MilestoneStatus)[keyof typeof MilestoneStatus];

// Gate status values
export const GateStatus = {
  PENDING: "pending",
  PASSED: "passed",
  FAILED: "failed",
  OVERRIDDEN: "overridden",
} as const;

export type GateStatusValue = (typeof GateStatus)[keyof typeof GateStatus];

// Subscription status values
export const SubscriptionStatus = {
  ACTIVE: "active",
  CANCELED: "canceled",
} as const;

export type SubscriptionStatusValue = (typeof SubscriptionStatus)[keyof typeof SubscriptionStatus];

// Drift status values
export const DriftStatus = {
  ON_SCOPE: "on-scope",
  AT_RISK: "at-risk",
  DRIFTING: "drifting",
  BLOCKED: "blocked",
} as const;

export type DriftStatusValue = (typeof DriftStatus)[keyof typeof DriftStatus];

// Grade categories
export const GradeCategory = {
  A_PLUS: "A+",
  A: "A",
  B_PLUS: "B+",
  B: "B",
  C: "C",
  D: "D",
  F: "F",
} as const;

export type GradeCategoryValue = (typeof GradeCategory)[keyof typeof GradeCategory];

// Severity levels
export const Severity = {
  CRITICAL: "critical",
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
  WARNING: "WARNING",
} as const;

export type SeverityValue = (typeof Severity)[keyof typeof Severity];

// Evidence levels
export const EvidenceLevel = {
  VERIFIED: "verified",
  INFERRED: "inferred",
  MISSING_PROOF: "missing-proof",
  HUMAN_NEEDED: "human-needed",
} as const;

export type EvidenceLevelValue = (typeof EvidenceLevel)[keyof typeof EvidenceLevel];

// Error codes
export const ErrorCodes = {
  FORBIDDEN: "FORBIDDEN",
  UNAUTHORIZED: "UNAUTHORIZED",
  NOT_FOUND: "NOT_FOUND",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  P2002: "P2002", // Prisma unique constraint violation
  NO_SCAN: "NO_SCAN",
} as const;

export type ErrorCodeValue = (typeof ErrorCodes)[keyof typeof ErrorCodes];

// Badge colors
export const BadgeColor = {
  BRIGHT_GREEN: "brightgreen",
  GREEN: "green",
  YELLOW: "yellow",
  ORANGE: "orange",
  RED: "red",
  LIGHT_GREY: "lightgrey",
} as const;

export type BadgeColorValue = (typeof BadgeColor)[keyof typeof BadgeColor];