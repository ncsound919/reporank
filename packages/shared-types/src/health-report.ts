export interface HealthReport {
  repoOwner: string;
  repoName: string;
  overallScore: number;
  gradeCategory: GradeCategory;
  maturityLevel: MaturityLevel;
  mainLanguage: string;
  starsCount: number;
  forksCount: number;
  openIssuesCount: number;
  lastPushedAt: string;
  summary: string;
  dimensionScores: DimensionScores;
  security: SecurityScan;
  quality: QualityScorecard;
  vibe: VibeScore;
  architecture: ArchitectureMetrics;
  deployment: DeploymentReadiness;
  documentation: DocumentationScore;
  license: LicenseAudit;
  market: MarketSnapshot;
  valuation: ValuationMetrics;
  hallucinatedFeatures: string[];
  bugsAndLeaks: string[];
  structuralSmells: string[];
  quickWins: QuickWin[];
  roadmap: RoadmapItem[];
  implementationPlan: ImplementationStep[];
  globalBenchmarkPercent: number;
  scannedAt: string;
}

export type GradeCategory = "A+" | "A" | "B+" | "B" | "C" | "D" | "F";
export type MaturityLevel = "Prototype" | "MVP" | "Beta" | "Production" | "Enterprise";

export interface DimensionScores {
  security: number;
  quality: number;
  vibe: number;
  architecture: number;
  deployment: number;
  documentation: number;
  license: number;
  market: number;
}

export interface SecurityScan {
  secretsFound: number;
  secretsCritical: number;
  vulnerabilityCount: number;
  highestSeverity: "none" | "low" | "medium" | "high" | "critical";
  vulnerabilities: Vulnerability[];
  dependencyCves: number;
  hasSastScan: boolean;
  score: number;
}

export interface Vulnerability {
  id: string;
  severity: "low" | "medium" | "high" | "critical";
  title: string;
  description: string;
  packageName?: string;
  cveId?: string;
  recommendation: string;
}

export interface QualityScorecard {
  readmeScore: number;
  testFramework: string | null;
  testFileCount: number;
  codeSmells: number;
  duplicationPercent: number;
  hasLintConfig: boolean;
  hasCiConfig: boolean;
  score: number;
}

export interface VibeScore {
  overall: number;
  namingScore: number;
  modernityScore: number;
  hygieneScore: number;
  configCoherence: number;
  dependencyFreshness: number;
  recommendations: string[];
}

export interface ArchitectureMetrics {
  couplingScore: number;
  circularImportsCount: number;
  complexityRating: "low" | "medium" | "high" | "very-high";
  fileCount: number;
  avgFileLength: number;
  score: number;
}

export interface DeploymentReadiness {
  hasDockerfile: boolean;
  dockerfileScore: number;
  hasCIConfig: boolean;
  hasEnvExample: boolean;
  hasHealthcheck: boolean;
  hasLogging: boolean;
  loggingFramework: string | null;
  score: number;
}

export interface DocumentationScore {
  readmeCompleteness: number;
  hasSetupInstructions: boolean;
  hasApiDocs: boolean;
  hasArchitectureDiagram: boolean;
  hasContributingGuide: boolean;
  hasLicenseFile: boolean;
  score: number;
}

export interface LicenseAudit {
  licenseType: string | null;
  isCopyleft: boolean;
  licenseConflicts: string[];
  hasLicenseFile: boolean;
  score: number;
}

export interface MarketSnapshot {
  trendAlignment: "rising" | "steady" | "declining";
  percentileRank: number;
  competitorCount: number;
  recentActivity: "active" | "stale" | "inactive";
  score: number;
}

export interface ValuationMetrics {
  replacementCostFMV: number;
  reliefFromRoyaltyValue: number;
  productivityWasteHeuristic: number;
}

export interface QuickWin {
  title: string;
  severity: "critical" | "high" | "medium" | "low";
  category: string;
  effort: "minutes" | "hours" | "days";
  description: string;
  action: string;
  filePath?: string;
}

export interface RoadmapItem {
  phase: "now" | "next" | "later";
  priority: number;
  category: string;
  task: string;
  effort: "hours" | "days" | "weeks";
}

export interface ImplementationStep {
  title: string;
  description: string;
  targetFiles: string[];
  promptInstruction: string;
}
