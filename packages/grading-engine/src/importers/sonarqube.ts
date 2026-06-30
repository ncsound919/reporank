import { XMLParser } from "fast-xml-parser";

export type SonarQubeSeverity = "BLOCKER" | "CRITICAL" | "MAJOR" | "MINOR" | "INFO";

export type RepoRankCategory =
  | "security"
  | "reliability"
  | "maintainability"
  | "hygiene"
  | "performance"
  | "architecture"
  | "unknown";

export interface SonarQubeRule {
  repositoryKey: string;
  key: string;
  priority?: SonarQubeSeverity;
  parameters?: Record<string, string>;
}

export interface SonarQubeProfile {
  name: string;
  language: string;
  rules: SonarQubeRule[];
  rawRules?: Array<Record<string, unknown>>;
}

export interface SonarQubeIssue {
  rule: string;
  severity: SonarQubeSeverity;
  component: string;
  message: string;
  line?: number;
  textRange?: { startLine: number; endLine: number; startOffset: number; endOffset: number };
  type?: string;
  effort?: string;
  debt?: string;
  tags?: string[];
}

export interface SonarQubeIssueReport {
  issues: SonarQubeIssue[];
  total?: number;
}

export interface SonarQubeQualityGateCondition {
  metric: string;
  op: string;
  error?: string;
  warning?: string;
  actual?: string;
  level?: string;
}

export interface SonarQubeQualityGate {
  name: string;
  conditions: SonarQubeQualityGateCondition[];
}

export interface RepoRankRuleMapping {
  sonarRuleKey: string;
  repositoryKey: string;
  severity: SonarQubeSeverity;
  reporankWeight: number;
  reporankCategory: RepoRankCategory;
  parameters?: Record<string, string>;
}

export interface RepoRankIssueMapping {
  rule: string;
  severity: SonarQubeSeverity;
  weight: number;
  category: RepoRankCategory;
  component: string;
  message: string;
  line?: number;
}

export interface RepoRankThresholdConfig {
  metric: string;
  operator: string;
  errorThreshold?: number;
  warningThreshold?: number;
  level?: string;
}

export interface MigrationReport {
  source: "sonarqube";
  profileName?: string;
  language?: string;
  totalRules: number;
  totalIssues: number;
  mappedRules: RepoRankRuleMapping[];
  mappedIssues: RepoRankIssueMapping[];
  unmappedRuleTypes: string[];
  thresholdConfig: RepoRankThresholdConfig[];
  coverage: {
    total: number;
    mapped: number;
    percent: number;
  };
  gaps: string[];
  summary: string;
}

const SEVERITY_WEIGHT: Record<SonarQubeSeverity, number> = {
  BLOCKER: 0.95,
  CRITICAL: 0.85,
  MAJOR: 0.7,
  MINOR: 0.5,
  INFO: 0.25,
};

const SEVERITY_ORDER: SonarQubeSeverity[] = ["BLOCKER", "CRITICAL", "MAJOR", "MINOR", "INFO"];

function mapSeverity(severity: SonarQubeSeverity): number {
  return SEVERITY_WEIGHT[severity] ?? 0.5;
}

function mapRuleTypeToCategory(ruleType?: string, repositoryKey?: string): RepoRankCategory {
  if (!ruleType) {
    const lowerRepo = (repositoryKey ?? "").toLowerCase();
    if (lowerRepo.includes("bug") && !lowerRepo.includes("debug")) return "reliability";
    if (lowerRepo.includes("vulnerability") || lowerRepo.includes("security")) return "security";
    if (lowerRepo.includes("code_smell") || lowerRepo.includes("code-smell") || lowerRepo.includes("sqale")) return "maintainability";
    if (lowerRepo.includes("performance")) return "performance";
    if (lowerRepo.includes("architecture") || lowerRepo.includes("design")) return "architecture";
    return "unknown";
  }
  const t = ruleType.toUpperCase();
  if (t === "BUG") return "reliability";
  if (t === "VULNERABILITY") return "security";
  if (t === "CODE_SMELL") return "maintainability";
  if (t === "SECURITY_HOTSPOT") return "security";
  return "unknown";
}

function parseSeverityPriority(priority?: string): SonarQubeSeverity | undefined {
  if (!priority) return undefined;
  const norm = priority.toUpperCase();
  const valid: SonarQubeSeverity[] = ["BLOCKER", "CRITICAL", "MAJOR", "MINOR", "INFO"];
  return valid.includes(norm as SonarQubeSeverity) ? (norm as SonarQubeSeverity) : undefined;
}

function validateSeverity(raw: string): SonarQubeSeverity {
  const SEVERITY_VALUES: SonarQubeSeverity[] = ["BLOCKER", "CRITICAL", "MAJOR", "MINOR", "INFO"];
  return SEVERITY_VALUES.includes(raw as SonarQubeSeverity) ? (raw as SonarQubeSeverity) : "MAJOR";
}

export function parseQualityProfile(xmlContent: string): SonarQubeProfile {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    parseAttributeValue: false,
    textNodeName: "#text",
    processEntities: false,
  });

  const sanitized = xmlContent.replace(/<!DOCTYPE[^>]*\[.*?\]>/gis, "").replace(/<!DOCTYPE[^>]*>/gi, "");
  const parsed = parser.parse(sanitized);

  const profile = parsed?.profile ?? {};
  const name = typeof profile.name === "string" ? profile.name : "";
  const language = typeof profile.language === "string" ? profile.language : "";

  const rulesContainer = profile.rules ?? {};
  let ruleEntries = rulesContainer.rule ?? [];

  if (!Array.isArray(ruleEntries)) {
    ruleEntries = [ruleEntries];
  }

  const rules: SonarQubeRule[] = [];
  const rawRules: Array<Record<string, unknown>> = [];

  for (const entry of ruleEntries) {
    const repoKey = typeof entry.repositoryKey === "string" ? entry.repositoryKey : "";
    const ruleKey = typeof entry.key === "string" ? entry.key : "";
    const priority = entry.priority ?? entry.severity;
    const parsedPriority = typeof priority === "string" ? parseSeverityPriority(priority) : undefined;

    let parameters: Record<string, string> | undefined;
    if (entry.parameters && entry.parameters.parameter) {
      const paramEntries = Array.isArray(entry.parameters.parameter)
        ? entry.parameters.parameter
        : [entry.parameters.parameter];
      parameters = {};
      for (const p of paramEntries) {
        const paramKey = typeof p.key === "string" ? p.key : "";
        let paramValue: string;
        if (typeof p.value === "string") paramValue = p.value;
        else if (typeof p.value === "number") paramValue = String(p.value);
        else if (typeof p["#text"] === "string") paramValue = p["#text"];
        else paramValue = "";
        if (paramKey) parameters[paramKey] = paramValue;
      }
    }

    rules.push({
      repositoryKey: repoKey,
      key: ruleKey,
      priority: parsedPriority,
      parameters,
    });

    rawRules.push({
      repositoryKey: repoKey,
      key: ruleKey,
      priority: parsedPriority ?? entry.priority,
    });
  }

  return { name, language, rules, rawRules };
}

export function parseIssueReport(jsonContent: string): SonarQubeIssueReport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonContent);
  } catch {
    throw new Error("Invalid JSON in SonarQube issue report");
  }

  const parsedObj = parsed as Record<string, unknown>;
  const rawIssues = Array.isArray(parsed)
    ? (parsed as unknown[])
    : parsedObj.issues && Array.isArray(parsedObj.issues)
      ? (parsedObj.issues as unknown[])
      : [];

  const normalized: SonarQubeIssue[] = (rawIssues as Record<string, unknown>[]).map((issue) => ({
    rule: typeof issue.rule === "string" ? issue.rule : "",
    severity: validateSeverity(typeof issue.severity === "string" ? issue.severity.toUpperCase() : ""),
    component: typeof issue.component === "string" ? issue.component : "",
    message: typeof issue.message === "string" ? issue.message : "",
    line: typeof issue.line === "number" ? issue.line : (typeof issue.line === "string" ? parseInt(issue.line, 10) || undefined : undefined),
    textRange: issue.textRange as SonarQubeIssue["textRange"],
    type: typeof issue.type === "string" ? issue.type : undefined,
    effort: typeof issue.effort === "string" ? issue.effort : undefined,
    debt: typeof issue.debt === "string" ? issue.debt : undefined,
    tags: Array.isArray(issue.tags) ? (issue.tags as string[]) : undefined,
  }));

  return { issues: normalized, total: (parsedObj.total as number | undefined) ?? normalized.length };
}

export function parseQualityGate(jsonContent: string): SonarQubeQualityGate {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonContent);
  } catch {
    throw new Error("Invalid JSON in SonarQube quality gate");
  }

  const parsedObj = parsed as Record<string, unknown>;
  const conditions: SonarQubeQualityGateCondition[] = [];
  const conditionsSource = parsedObj.conditions ?? [];

  for (const c of Array.isArray(conditionsSource) ? conditionsSource : [conditionsSource]) {
    conditions.push({
      metric: typeof c.metric === "string" ? c.metric : (typeof c.id === "string" ? c.id : ""),
      op: typeof c.op === "string" ? c.op : "LT",
      error: typeof c.error === "string" ? c.error : undefined,
      warning: typeof c.warning === "string" ? c.warning : undefined,
      actual: typeof c.actual === "string" ? c.actual : undefined,
      level: typeof c.level === "string" ? c.level : undefined,
    });
  }

  return { name: typeof parsedObj.name === "string" ? parsedObj.name : "", conditions };
}

export function mapProfileToRepoRank(profile: SonarQubeProfile): RepoRankRuleMapping[] {
  return profile.rules.map((rule) => ({
    sonarRuleKey: rule.key,
    repositoryKey: rule.repositoryKey,
    severity: rule.priority ?? "MAJOR",
    reporankWeight: mapSeverity(rule.priority ?? "MAJOR"),
    reporankCategory: mapRuleTypeToCategory(undefined, rule.repositoryKey),
    parameters: rule.parameters,
  }));
}

export function mapIssuesToRepoRank(issues: SonarQubeIssue[]): RepoRankIssueMapping[] {
  return issues.map((issue) => ({
    rule: issue.rule,
    severity: issue.severity,
    weight: mapSeverity(issue.severity),
    category: mapRuleTypeToCategory(issue.type),
    component: issue.component,
    message: issue.message,
    line: issue.line,
  }));
}

export function mapQualityGateToThresholds(gate: SonarQubeQualityGate): RepoRankThresholdConfig[] {
  const METRIC_MAP: Record<string, string> = {
    blocker_violations: "blockers",
    critical_violations: "critical_issues",
    major_violations: "major_issues",
    minor_violations: "minor_issues",
    info_violations: "info_issues",
    code_smells: "code_smells",
    bugs: "bugs",
    vulnerabilities: "vulnerabilities",
    coverage: "test_coverage",
    duplicated_lines_density: "duplication",
    sqale_rating: "maintainability_rating",
    reliability_rating: "reliability_rating",
    security_rating: "security_rating",
    security_hotspots_reviewed: "security_hotspots",
  };

  return gate.conditions.map((c) => ({
    metric: METRIC_MAP[c.metric] ?? c.metric,
    operator: c.op,
    errorThreshold: c.error ? parseFloat(c.error) : undefined,
    warningThreshold: c.warning ? parseFloat(c.warning) : undefined,
    level: c.level,
  }));
}

export function generateMigrationReport(
  profile: SonarQubeProfile | null,
  issues: SonarQubeIssue[] | null,
  qualityGate: SonarQubeQualityGate | null,
): MigrationReport {
  const mappedRules = profile ? mapProfileToRepoRank(profile) : [];
  const mappedIssues = issues ? mapIssuesToRepoRank(issues) : [];
  const thresholdConfig = qualityGate ? mapQualityGateToThresholds(qualityGate) : [];

  const totalRules = mappedRules.length;
  const mapped = mappedRules.filter((r) => r.reporankCategory !== "unknown").length;

  const categories = new Set(mappedRules.map((r) => r.reporankCategory));
  const unmappedRuleTypes = mappedRules
    .filter((r) => r.reporankCategory === "unknown")
    .map((r) => r.repositoryKey);

  const REPORANK_BUILTIN_CATEGORIES = ["security", "reliability", "maintainability", "hygiene", "performance", "architecture"];
  const gaps = REPORANK_BUILTIN_CATEGORIES.filter((c) => !categories.has(c as RepoRankCategory));

  const summary = totalRules === 0
    ? "No SonarQube rules imported. Provide a quality profile XML file."
    : `Imported ${totalRules} rule(s) from SonarQube. ${mapped} rule(s) mapped (${((mapped / totalRules) * 100).toFixed(1)}% coverage). ${unmappedRuleTypes.length} unmapped. ${mappedIssues.length} issue(s) imported.`;

  return {
    source: "sonarqube",
    profileName: profile?.name,
    language: profile?.language,
    totalRules,
    totalIssues: mappedIssues.length,
    mappedRules,
    mappedIssues,
    unmappedRuleTypes: [...new Set(unmappedRuleTypes)],
    thresholdConfig,
    coverage: {
      total: totalRules,
      mapped,
      percent: totalRules > 0 ? (mapped / totalRules) * 100 : 100,
    },
    gaps,
    summary,
  };
}

export function generateRepoRankConfig(report: MigrationReport): Record<string, unknown> {
  const rules: Record<string, unknown>[] = report.mappedRules.map((r) => ({
    ruleKey: r.sonarRuleKey,
    source: `sonarqube:${r.repositoryKey}`,
    weight: r.reporankWeight,
    category: r.reporankCategory,
    parameters: r.parameters ?? {},
  }));

  const thresholds: Record<string, unknown> = {};
  for (const t of report.thresholdConfig) {
    thresholds[t.metric] = {
      operator: t.operator,
      error: t.errorThreshold,
      warning: t.warningThreshold,
    };
  }

  return {
    generator: "reporank import sonarqube",
    generatedAt: new Date().toISOString(),
    source: {
      type: "sonarqube",
      profileName: report.profileName,
      language: report.language,
    },
    rules,
    thresholds,
    migrationCoverage: report.coverage,
    unmappedRuleTypes: report.unmappedRuleTypes,
    gaps: report.gaps,
  };
}
