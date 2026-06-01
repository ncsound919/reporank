import type { VibeScore } from "@reporank/shared-types";
import { analyzeNaming } from "./namingAnalyzer";
import { analyzeModernity } from "./modernityScorer";
import { analyzeHygiene } from "./hygieneChecker";

const WEIGHTS = {
  naming: 0.25,
  modernity: 0.25,
  hygiene: 0.20,
  configCoherence: 0.15,
  dependencyFreshness: 0.15,
};

const DEFAULT_CONFIG_COHERENCE = 75;
const DEFAULT_DEP_FRESHNESS = 65;

export function analyzeVibe(input: { files: string[]; sourceFiles: { path: string; content: string }[] }): VibeScore {
  const naming = analyzeNaming(input.files);
  const modernity = analyzeModernity(input.sourceFiles);
  const hygiene = analyzeHygiene(input.sourceFiles);

  const overall = Math.round(
    naming.score * WEIGHTS.naming +
    modernity.score * WEIGHTS.modernity +
    hygiene.score * WEIGHTS.hygiene +
    DEFAULT_CONFIG_COHERENCE * WEIGHTS.configCoherence +
    DEFAULT_DEP_FRESHNESS * WEIGHTS.dependencyFreshness
  );

  return {
    overall, namingScore: naming.score, modernityScore: modernity.score, hygieneScore: hygiene.score,
    configCoherence: DEFAULT_CONFIG_COHERENCE, dependencyFreshness: DEFAULT_DEP_FRESHNESS,
    recommendations: [...naming.recommendations, ...modernity.recommendations, ...hygiene.recommendations],
  };
}

export { analyzeNaming } from "./namingAnalyzer";
export { analyzeModernity } from "./modernityScorer";
export { analyzeHygiene } from "./hygieneChecker";
