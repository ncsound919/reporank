export { runDeepAnalysis, type DeepAnalysisReport } from "./run-deep-analysis";
export {
  aggregateFileScores,
  buildWorstFiles,
  generateTopRecommendations,
  type AnalysisResult,
} from "./aggregator";
export { analyzeComplexity, type ComplexityReport } from "./complexity";
export { analyzeDependencies, type DependencyReport } from "./dependency-health";
export { analyzeArchitecture, type ArchitectureReport } from "./architecture";
export { analyzeProductionReadiness, type ProductionReport } from "./production";
export { scanCodeHygiene, type CodeHygieneReport } from "./code-hygiene";
export { runEnterpriseAnalysis, type EnterpriseReport } from "./enterprise";
export {
  analyzeStructure,
  parseLayerRules,
  findImportCycles,
  findStronglyConnectedComponents,
  detectLayerViolations,
  computeModuleCoupling,
  DEFAULT_LAYER_RULES,
  type StructuralReport,
  type StructuralFinding,
  type StructuralSeverity,
  type ImportCycle,
  type ModuleCoupling,
  type LayerRule,
  type AnalyzeStructureOptions,
} from "./structural";
export {
  buildModuleGraph,
  extractImportSpecifiers,
  resolveSpecifier,
  normalizePath,
  dirName,
  languageOf,
  type ModuleGraph,
  type GraphSourceFile,
  type GraphLanguage,
} from "./import-graph";
export {
  computeStructuralIndex,
  type StructuralIndex,
  type StructuralIndexOptions,
  type DimensionContribution,
  type IndexFinding,
  type IndexNormalization,
  type IndexSeverity,
} from "./structural-index";
export { calculateVibeCodingIndex, type VibeCodingReport } from "./contamination";
export {
  predictImpact,
  calculateSoftware20Score,
  breakdownImpact,
  generateRecommendations,
  EFFORT_LABELS,
  type FileChange,
  type FileChangeKind,
  type FileImpact,
  type ImpactReport,
  type Software20Score,
  type ImpactBreakdown,
  type CategoryContribution,
  type ImpactCategory,
  type FixRecommendation,
  type FixEffort,
  type FixType,
  type RecommendationReport,
} from "./impact";
export {
  auditSubmission,
  analyzeSession,
  type AuditReport,
  type ChatTurn,
  type CourseGuideline,
  type DisclosureLayer,
  type Layer1Report,
  type Layer2Report,
  type Layer3Report,
  type Layer4Report,
  type SessionAnalysis,
  type SessionInput,
  type SubmissionInput,
} from "./education";
export {
  calculateTrustScore,
  type TrustScoreInput,
  type TrustScoreResult,
} from "./trust";
