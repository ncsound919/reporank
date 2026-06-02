/**
 * scopeMatcher — detects drift between an approved project brief and the current scan.
 * Pure function, deterministic, no I/O.
 */

export type DriftStatus = "on-scope" | "at-risk" | "drifting" | "blocked";

export type DriftCategory =
  | "feature-creep"
  | "technical-complexity-creep"
  | "deadline-risk"
  | "dependency-creep"
  | "unknown-work"
  | "missing-planned";

export interface ScopeMatchResult {
  inScope: string[];
  outOfScope: string[];
  missingPlanned: string[];
  uncertain: string[];
  driftCategories: DriftCategory[];
  status: DriftStatus;
  summary: string;
  intentGaps?: IntentGap[];
}

export interface IntentGap {
  promised: string;
  evidenceFound: boolean;
  detail: string;
}

interface ScopeMatchInput {
  brief: {
    deliverables: string[];
    exclusions: string[];
    constraints: string[];
    assumptions: string[];
    intentDocument?: Record<string, unknown> | null;
  };
  report: Record<string, unknown> | null;
  fileTree: string[];
  builderMetadata?: Record<string, unknown> | null;
}

// Keyword -> code evidence mappings
const DELIVERABLE_MARKERS: Record<string, string[]> = {
  auth: ["login", "signin", "signup", "auth", "session", "token", "jwt", "password", "oauth"],
  payment: ["billing", "stripe", "payment", "subscription", "checkout", "invoice", "plan", "price"],
  admin: ["admin", "dashboard/admin", "management", "superuser", "moderator"],
  export: ["export", "download", "csv", "pdf", "report"],
  search: ["search", "filter", "query", "elasticsearch", "algolia"],
  email: ["email", "sendgrid", "resend", "smtp", "mailer", "nodemailer"],
  api: ["api/", "endpoint", "rest", "graphql", "route"],
  upload: ["upload", "s3", "storage", "file", "multipart"],
  notification: ["notification", "push", "webhook", "alert"],
  analytics: ["analytics", "tracking", "metrics", "posthog", "segment"],
  testing: ["test", "spec", "jest", "vitest", "cypress", "playwright"],
  docs: ["readme", "docs", "documentation", "swagger", "openapi"],
  deploy: ["dockerfile", "ci", "github/workflows", "railway", "vercel"],
  database: ["prisma", "drizzle", "mongoose", "migration", "schema"],
};

function keywordsFromText(text: string): string[] {
  return text.toLowerCase().split(/[\s,;:]+/).filter(w => w.length > 3);
}

function isEvidencedInTree(keywords: string[], fileTree: string[]): boolean {
  const lowerTree = fileTree.join(" ").toLowerCase();
  return keywords.some(kw => lowerTree.includes(kw));
}

function isEvidencedInReport(keywords: string[], report: Record<string, unknown>): boolean {
  const reportStr = JSON.stringify(report).toLowerCase();
  return keywords.some(kw => reportStr.includes(kw));
}

function matchDeliverable(deliverable: string, fileTree: string[], report: Record<string, unknown>): boolean {
  const keywords = keywordsFromText(deliverable);
  // Check against known marker categories
  for (const [, markers] of Object.entries(DELIVERABLE_MARKERS)) {
    const categoryMatch = markers.some(m => keywords.some(k => k.includes(m) || m.includes(k)));
    if (categoryMatch && isEvidencedInTree(markers, fileTree)) return true;
  }
  // Fallback: direct keyword match in file tree or report
  return isEvidencedInTree(keywords, fileTree) || isEvidencedInReport(keywords, report);
}

function detectOutOfScopeFeatures(
  fileTree: string[],
  deliverables: string[],
  exclusions: string[],
): string[] {
  const outOfScope: string[] = [];
  const deliverableKeywords = deliverables.flatMap(keywordsFromText);
  const exclusionKeywords = exclusions.flatMap(keywordsFromText);

  for (const [category, markers] of Object.entries(DELIVERABLE_MARKERS)) {
    const evidenced = isEvidencedInTree(markers, fileTree);
    if (!evidenced) continue;

    const inDeliverables = deliverableKeywords.some(k =>
      markers.some(m => k.includes(m) || m.includes(k))
    );
    const inExclusions = exclusionKeywords.some(k =>
      markers.some(m => k.includes(m) || m.includes(k))
    );

    if (!inDeliverables && !inExclusions) {
      outOfScope.push(`${category} (detected in code, not in scope)`);
    }

    if (inExclusions) {
      outOfScope.push(`${category} (explicitly excluded but found in code)`);
    }
  }

  return [...new Set(outOfScope)];
}

export function runScopeMatcher(input: ScopeMatchInput): ScopeMatchResult {
  const { brief, report, fileTree } = input;
  const safeReport = report || {};

  const inScope: string[] = [];
  const missingPlanned: string[] = [];
  const uncertain: string[] = [];

  for (const deliverable of brief.deliverables) {
    if (matchDeliverable(deliverable, fileTree, safeReport)) {
      inScope.push(deliverable);
    } else {
      const keywords = keywordsFromText(deliverable);
      const partialMatch = keywords.some(k => fileTree.join(" ").toLowerCase().includes(k));
      if (partialMatch) {
        uncertain.push(deliverable);
      } else {
        missingPlanned.push(deliverable);
      }
    }
  }

  const outOfScope = detectOutOfScopeFeatures(fileTree, brief.deliverables, brief.exclusions);

  const driftCategories: DriftCategory[] = [];
  if (outOfScope.length > 0) driftCategories.push("feature-creep");
  if (missingPlanned.length > 2) driftCategories.push("missing-planned");

  // Dependency creep: check for large dep counts not mentioned in constraints
  const pkgFile = fileTree.filter(f => f === "package.json" || f.endsWith("/package.json"));
  if (pkgFile.length > 0 && brief.constraints.join(" ").length < 50) {
    driftCategories.push("dependency-creep");
  }

  // Intent gap analysis
  const intentGaps: IntentGap[] = [];
  if (brief.intentDocument && typeof brief.intentDocument === "object") {
    const intent = brief.intentDocument as Record<string, unknown>;
    const promisedFeatures = Array.isArray(intent.promisedFeatures) ? intent.promisedFeatures as string[] : [];
    for (const feature of promisedFeatures) {
      const evidenced = matchDeliverable(feature, fileTree, safeReport);
      intentGaps.push({
        promised: feature,
        evidenceFound: evidenced,
        detail: evidenced
          ? `Code evidence found for "${feature}"`
          : `No code evidence found for "${feature}" — may be missing or incomplete`,
      });
    }
  }

  // Determine status
  let status: DriftStatus;
  if (missingPlanned.length === 0 && outOfScope.length === 0) {
    status = "on-scope";
  } else if (outOfScope.length === 0 && missingPlanned.length <= 2) {
    status = "at-risk";
  } else if (outOfScope.length > 2 || missingPlanned.length > 3) {
    status = "drifting";
  } else if (missingPlanned.length > 0 && inScope.length === 0) {
    status = "blocked";
  } else {
    status = "at-risk";
  }

  const summary = [
    `${inScope.length}/${brief.deliverables.length} planned deliverables evidenced in code.`,
    outOfScope.length > 0 ? `${outOfScope.length} unplanned feature area(s) detected.` : "",
    missingPlanned.length > 0 ? `${missingPlanned.length} planned deliverable(s) have no code evidence.` : "",
  ].filter(Boolean).join(" ");

  return { inScope, outOfScope, missingPlanned, uncertain, driftCategories, status, summary, intentGaps };
}
