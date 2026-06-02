export type RuleSeverity = "must" | "should" | "may";
export type RuleCategory = "security" | "quality" | "agent-behavior" | "code-review" | "education";
export type RuleMode = "minimal" | "standard" | "comprehensive";

export interface AgentRule {
  id: string;
  category: RuleCategory;
  severity: RuleSeverity;
  title: string;
  description: string;
  condition?: (analysis: CodebaseAnalysis) => boolean;
  modes: RuleMode[];
}

export interface CodebaseAnalysis {
  vibeCodingScore: number;
  securityIssues: number;
  aiGeneratedPatterns: number;
  hasTests: boolean;
  hasLicense: boolean;
  hasCI: boolean;
  hasDockerfile: boolean;
  fileCount: number;
  languages: string[];
  teamSize: number;
  isEducation: boolean;
  framework: string;
}

const ALL_RULES: AgentRule[] = [
  {
    id: "no-secrets-in-code",
    category: "security",
    severity: "must",
    title: "No secrets in source code",
    description: "API keys, tokens, and credentials must be in environment variables, never in source files.",
    condition: (a) => a.securityIssues > 0,
    modes: ["minimal", "standard", "comprehensive"],
  },
  {
    id: "no-eval",
    category: "security",
    severity: "must",
    title: "No eval() in production code",
    description: "eval() allows arbitrary code execution and must never appear in production code.",
    modes: ["minimal", "standard", "comprehensive"],
  },
  {
    id: "no-any-abuse",
    category: "quality",
    severity: "should",
    title: "Minimize `any` type usage",
    description: "Using `any` defeats TypeScript's type safety. Use proper types or generics instead.",
    condition: (a) => a.aiGeneratedPatterns > 3,
    modes: ["standard", "comprehensive"],
  },
  {
    id: "no-hardcoded-urls",
    category: "quality",
    severity: "should",
    title: "Extract URLs and configuration to env vars",
    description: "Hardcoded URLs and configuration values prevent environment-specific deployments.",
    modes: ["standard", "comprehensive"],
  },
  {
    id: "async-error-handling",
    category: "quality",
    severity: "must",
    title: "Handle async errors properly",
    description: "Every async function must have try/catch or .catch() handler. Unhandled rejections crash the process.",
    modes: ["minimal", "standard", "comprehensive"],
  },
  {
    id: "no-stale-debug-code",
    category: "quality",
    severity: "should",
    title: "Remove debug code before committing",
    description: "console.log, debugger statements, and TODO/FIXME comments should be removed or tracked in issues.",
    modes: ["standard", "comprehensive"],
  },
  {
    id: "agent-never-writes-code",
    category: "agent-behavior",
    severity: "must",
    title: "Agent must not write production code directly",
    description: "AI agent should explain, suggest, and review — never write or commit code without human review.",
    condition: (a) => a.isEducation,
    modes: ["minimal", "standard", "comprehensive"],
  },
  {
    id: "agent-explains-not-solves",
    category: "agent-behavior",
    severity: "must",
    title: "Agent explains concepts instead of providing solutions",
    description: "When asked a question, the agent should guide the user toward understanding, not give the answer directly.",
    condition: (a) => a.isEducation,
    modes: ["minimal", "standard"],
  },
  {
    id: "agent-reviews-code",
    category: "code-review",
    severity: "should",
    title: "All PRs must pass code review",
    description: "Every pull request requires at least one review from a human or AI reviewer before merging.",
    condition: (a) => a.fileCount > 10,
    modes: ["standard", "comprehensive"],
  },
  {
    id: "min-score-threshold",
    category: "code-review",
    severity: "should",
    title: "Minimum RepoRank score threshold",
    description: "Codebase must maintain a minimum quality score. PRs that would drop the score below threshold require review.",
    condition: (a) => a.hasCI,
    modes: ["comprehensive"],
  },
  {
    id: "small-files",
    category: "quality",
    severity: "should",
    title: "Keep files under 300 lines",
    description: "Small files are easier for both humans and AI to reason about. Files over 300 lines should be split.",
    modes: ["standard", "comprehensive"],
  },
  {
    id: "type-annotations",
    category: "quality",
    severity: "should",
    title: "Add type annotations to function signatures",
    description: "TypeScript type annotations help both humans and LLMs understand function contracts. Always annotate parameters and return types.",
    condition: (a) => a.languages.includes("TypeScript"),
    modes: ["standard", "comprehensive"],
  },
  {
    id: "write-tests",
    category: "quality",
    severity: "should",
    title: "Write tests for core functionality",
    description: "Core business logic should have tests. CI should run tests on every PR.",
    condition: (a) => !a.hasTests,
    modes: ["standard", "comprehensive"],
  },
];

export function getRulesForAnalysis(analysis: CodebaseAnalysis): AgentRule[] {
  return ALL_RULES.filter(r => {
    if (r.condition && !r.condition(analysis)) return false;
    return true;
  });
}

export function getRulesForMode(mode: RuleMode, analysis: CodebaseAnalysis): AgentRule[] {
  return getRulesForAnalysis(analysis).filter(r => r.modes.includes(mode));
}

export function getRuleById(id: string): AgentRule | undefined {
  return ALL_RULES.find(r => r.id === id);
}
