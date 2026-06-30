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

export interface ScopeMatchInput {
  brief: {
    deliverables: string[];
    exclusions: string[];
    constraints: string[];
    assumptions: string[];
    intentDocument?: Record<string, unknown> | null;
  };
  report: Record<string, unknown> | null;
  fileTree: string[];
  sourceFiles?: { path: string; content: string }[];
  builderMetadata?: Record<string, unknown> | null;
}

type UnknownRecord = Record<string, unknown>;

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

const STOP_WORDS = new Set([
  "the",
  "and",
  "with",
  "from",
  "into",
  "that",
  "this",
  "have",
  "will",
  "must",
  "should",
  "could",
  "would",
  "for",
  "are",
  "not",
  "app",
  "page",
  "screen",
  "flow",
  "user",
  "users",
]);

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): UnknownRecord {
  return isRecord(value) ? value : {};
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function safeStringify(value: unknown): string {
  const seen = new WeakSet<object>();

  try {
    return JSON.stringify(value, (_key, currentValue) => {
      if (typeof currentValue === "object" && currentValue !== null) {
        if (seen.has(currentValue)) return "[Circular]";
        seen.add(currentValue);
      }
      return currentValue;
    });
  } catch {
    return "";
  }
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9/._-]+/g, " ").trim();
}

function keywordsFromText(text: string): string[] {
  return unique(
    normalizeText(text)
      .split(/\s+/)
      .filter((word) => word.length >= 2 && !STOP_WORDS.has(word)),
  );
}

function buildCorpus(
  fileTree: string[],
  report: Record<string, unknown>,
  builderMetadata?: Record<string, unknown> | null,
): { treeText: string; reportText: string; combinedText: string } {
  const treeText = fileTree.join(" ").toLowerCase();
  const reportText = safeStringify(report).toLowerCase();
  const metadataText = safeStringify(builderMetadata ?? {}).toLowerCase();
  const combinedText = `${treeText} ${reportText} ${metadataText}`;
  return { treeText, reportText, combinedText };
}

function hasAnyKeyword(corpus: string, keywords: string[]): boolean {
  return keywords.some((keyword) => corpus.includes(keyword.toLowerCase()));
}

function getRelevantMarkers(deliverable: string): string[] {
  const keywords = keywordsFromText(deliverable);
  const matchedMarkers = new Set<string>(keywords);

  for (const [category, markers] of Object.entries(DELIVERABLE_MARKERS)) {
    const categoryMatch =
      keywords.includes(category) ||
      keywords.some((keyword) =>
        markers.some((marker) => keyword.includes(marker) || marker.includes(keyword)),
      );

    if (categoryMatch) {
      matchedMarkers.add(category);
      for (const marker of markers) {
        matchedMarkers.add(marker);
      }
    }
  }

  return [...matchedMarkers];
}

function matchDeliverable(
  deliverable: string,
  corpus: { combinedText: string },
): boolean {
  const markers = getRelevantMarkers(deliverable);
  return hasAnyKeyword(corpus.combinedText, markers);
}

function detectOutOfScopeFeatures(
  corpus: { combinedText: string },
  deliverables: string[],
  exclusions: string[],
): string[] {
  const outOfScope: string[] = [];
  const deliverableKeywords = unique(deliverables.flatMap(getRelevantMarkers));
  const exclusionKeywords = unique(exclusions.flatMap(getRelevantMarkers));

  for (const [category, markers] of Object.entries(DELIVERABLE_MARKERS)) {
    const evidenced = hasAnyKeyword(corpus.combinedText, [category, ...markers]);
    if (!evidenced) continue;

    const inDeliverables = deliverableKeywords.some(
      (keyword) =>
        keyword === category || markers.some((marker) => keyword.includes(marker) || marker.includes(keyword)),
    );

    const inExclusions = exclusionKeywords.some(
      (keyword) =>
        keyword === category || markers.some((marker) => keyword.includes(marker) || marker.includes(keyword)),
    );

    if (inExclusions) {
      outOfScope.push(`${category} (explicitly excluded but found in code)`);
      continue;
    }

    if (!inDeliverables) {
      outOfScope.push(`${category} (detected in code, not in scope)`);
    }
  }

  return unique(outOfScope);
}

function countDependencies(packageJsonContent: string): number {
  try {
    const parsed = JSON.parse(packageJsonContent) as unknown;
    const pkg = asRecord(parsed);
    const dependencies = asRecord(pkg.dependencies);
    const devDependencies = asRecord(pkg.devDependencies);
    return Object.keys(dependencies).length + Object.keys(devDependencies).length;
  } catch {
    return 0;
  }
}

function extractPromisedFeatures(intentDocument: Record<string, unknown> | null | undefined): string[] {
  if (!intentDocument) return [];
  const promised = intentDocument.promisedFeatures;
  return asStringArray(promised);
}

export function runScopeMatcher(input: ScopeMatchInput): ScopeMatchResult {
  const brief = {
    deliverables: Array.isArray(input.brief.deliverables) ? input.brief.deliverables.filter(Boolean) : [],
    exclusions: Array.isArray(input.brief.exclusions) ? input.brief.exclusions.filter(Boolean) : [],
    constraints: Array.isArray(input.brief.constraints) ? input.brief.constraints.filter(Boolean) : [],
    assumptions: Array.isArray(input.brief.assumptions) ? input.brief.assumptions.filter(Boolean) : [],
    intentDocument: input.brief.intentDocument ?? null,
  };

  const safeReport = input.report ?? {};
  const safeFileTree = Array.isArray(input.fileTree) ? input.fileTree.filter(Boolean) : [];
  const safeSourceFiles = Array.isArray(input.sourceFiles) ? input.sourceFiles : [];
  const corpus = buildCorpus(safeFileTree, safeReport, input.builderMetadata ?? null);

  const inScope: string[] = [];
  const missingPlanned: string[] = [];
  const uncertain: string[] = [];

  for (const deliverable of brief.deliverables) {
    const exactEvidence = matchDeliverable(deliverable, corpus);

    if (exactEvidence) {
      inScope.push(deliverable);
      continue;
    }

    const directKeywords = keywordsFromText(deliverable);
    const partialEvidence = hasAnyKeyword(corpus.combinedText, directKeywords);

    if (partialEvidence) {
      uncertain.push(deliverable);
    } else {
      missingPlanned.push(deliverable);
    }
  }

  const outOfScope = detectOutOfScopeFeatures(corpus, brief.deliverables, brief.exclusions);
  const driftCategorySet = new Set<DriftCategory>();

  if (outOfScope.length > 0) driftCategorySet.add("feature-creep");
  if (missingPlanned.length > 0) driftCategorySet.add("missing-planned");
  if (uncertain.length > 0) driftCategorySet.add("unknown-work");

  const packageJsonFile = safeSourceFiles.find(
    (file) => file.path === "package.json" || file.path.endsWith("/package.json"),
  );

  if (packageJsonFile) {
    const depCount = countDependencies(packageJsonFile.content);
    const hasConstraintOnDeps = brief.constraints.some((constraint) =>
      /dep|librar|package|bundle|size/i.test(constraint),
    );

    if (depCount > 80 && !hasConstraintOnDeps) {
      driftCategorySet.add("dependency-creep");
      driftCategorySet.add("technical-complexity-creep");
    }
  }

  const intentGaps: IntentGap[] = extractPromisedFeatures(brief.intentDocument).map((feature) => {
    const evidenced = matchDeliverable(feature, corpus);
    return {
      promised: feature,
      evidenceFound: evidenced,
      detail: evidenced
        ? `Code evidence found for "${feature}"`
        : `No code evidence found for "${feature}" — may be missing or incomplete`,
    };
  });

  let status: DriftStatus;

  if (brief.deliverables.length === 0) {
    status = outOfScope.length > 0 ? "at-risk" : "on-scope";
  } else if (missingPlanned.length > 0 && inScope.length === 0 && uncertain.length === 0) {
    status = "blocked";
  } else if (outOfScope.length === 0 && missingPlanned.length === 0) {
    status = "on-scope";
  } else if (outOfScope.length > 2 || missingPlanned.length > 3) {
    status = "drifting";
  } else {
    status = "at-risk";
  }

  const summaryParts = [
    brief.deliverables.length > 0
      ? `${inScope.length}/${brief.deliverables.length} planned deliverables evidenced in code.`
      : "No planned deliverables were provided in the brief.",
    outOfScope.length > 0 ? `${outOfScope.length} unplanned feature area(s) detected.` : "",
    missingPlanned.length > 0 ? `${missingPlanned.length} planned deliverable(s) have no code evidence.` : "",
    uncertain.length > 0 ? `${uncertain.length} deliverable(s) have only partial evidence.` : "",
  ].filter(Boolean);

  return {
    inScope,
    outOfScope,
    missingPlanned,
    uncertain,
    driftCategories: [...driftCategorySet],
    status,
    summary: summaryParts.join(" "),
    intentGaps,
  };
}
