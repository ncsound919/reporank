import path from "node:path";

type NamingConvention =
  | "camelCase"
  | "snake_case"
  | "kebab-case"
  | "PascalCase"
  | "unknown";

interface AnalyzeNamingResult {
  dominant: NamingConvention;
  score: number;
  recommendations: string[];
  total: number;
  consistencyPct: number;
  conventions: Record<NamingConvention, number>;
}

const CASE_PATTERNS: Record<Exclude<NamingConvention, "unknown">, RegExp> = {
  camelCase: /^[a-z]+(?:[A-Z][a-z0-9]*)*$/,
  snake_case: /^[a-z0-9]+(?:_[a-z0-9]+)*$/,
  "kebab-case": /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
  PascalCase: /^[A-Z][a-zA-Z0-9]*$/,
};

export function analyzeNaming(files: string[]): AnalyzeNamingResult {
  const conventions: Record<NamingConvention, number> = {
    camelCase: 0,
    snake_case: 0,
    "kebab-case": 0,
    PascalCase: 0,
    unknown: 0,
  };

  let total = 0;

  for (const file of files) {
    const normalizedName = getBaseNameWithoutExtension(file);
    if (!normalizedName) continue;

    const convention = detectConvention(normalizedName);
    conventions[convention] += 1;
    total += 1;
  }

  if (total === 0) {
    return {
      dominant: "unknown",
      score: 100,
      recommendations: [],
      total: 0,
      consistencyPct: 100,
      conventions,
    };
  }

  const ranked = Object.entries(conventions)
    .sort((a, b) => b[1] - a[1]) as Array<[NamingConvention, number]>;

  const [dominant, dominantCount] = ranked[0];
  const consistencyPct = (dominantCount / total) * 100;

  const recommendations: string[] = [];
  if (consistencyPct < 70) {
    recommendations.push("Mixed naming conventions detected — standardize on one primary filename style.");
  }
  if (conventions.unknown > 0) {
    recommendations.push(
      `${conventions.unknown} file name(s) do not match camelCase, snake_case, kebab-case, or PascalCase.`,
    );
  }

  return {
    dominant,
    score: scoreConsistency(consistencyPct, conventions.unknown, total),
    recommendations,
    total,
    consistencyPct: round1(consistencyPct),
    conventions,
  };
}

function getBaseNameWithoutExtension(filePath: string): string {
  const parsed = path.parse(filePath);
  const name = parsed.name.trim();

  if (!name || name === "." || name === "..") {
    return "";
  }

  return name;
}

function detectConvention(name: string): NamingConvention {
  for (const [convention, pattern] of Object.entries(CASE_PATTERNS) as Array<
    [Exclude<NamingConvention, "unknown">, RegExp]
  >) {
    if (pattern.test(name)) {
      return convention;
    }
  }

  return "unknown";
}

function scoreConsistency(consistencyPct: number, unknownCount: number, total: number): number {
  const unknownPct = (unknownCount / total) * 100;

  if (consistencyPct >= 90 && unknownPct === 0) return 100;
  if (consistencyPct >= 80 && unknownPct <= 10) return 85;
  if (consistencyPct >= 70 && unknownPct <= 20) return 70;
  if (consistencyPct >= 50) return 45;
  return 20;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
