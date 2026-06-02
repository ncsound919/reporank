/**
 * Unstick Analyzer — identifies what's actually blocking development progress
 * and prioritizes fixes by impact. Most devs know their code has issues.
 * What they don't know is WHAT TO FIX FIRST and what's BLOCKING SHIP.
 */
export interface Blocker {
  type: "deploy-blocker" | "safety-risk" | "refactor-prerequisite" | "velocity-drag" | "knowledge-gap" | "architecture-trap";
  title: string;
  impact: string; // What happens if you DON'T fix this
  payoff: string; // What happens if you DO fix this
  effort: "minutes" | "hours" | "days" | "sprint";
  priority: 1 | 2 | 3 | 4 | 5;
  file?: string;
  dependsOn?: string[]; // Fix these first
  unlocks?: string[]; // Fixing this enables these
}

export interface UnstickPlan {
  blockers: Blocker[];
  topPriority: string;
  quickestWin: string;
  biggestRisk: string;
  sequence: string[]; // Ordered fix sequence
  summary: string;
}

export function generateUnstickPlan(
  overallScore: number,
  dimensionScores: Record<string, number>,
  quickWins: { severity: string; title: string; category: string; effort: string; description: string; action?: string }[],
  bugsAndLeaks: string[],
  structuralSmells: string[],
  hallucinatedFeatures: string[],
  reportVibe: { overall: number; recommendations: string[] },
  deploymentReadiness: { hasDockerfile: boolean; hasCIConfig: boolean; hasEnvExample: boolean; score: number },
  licenseInfo: { hasLicenseFile: boolean; score: number },
  securityInfo: { secretsFound: number; score: number },
  hasTrending: boolean,
): UnstickPlan {
  const blockers: Blocker[] = [];

  // ─── 1. DEPLOY BLOCKERS (highest priority) ──────────────────────
  if (!licenseInfo.hasLicenseFile) {
    blockers.push({
      type: "deploy-blocker", priority: 1,
      title: "No license file — cannot deploy as open source",
      impact: "Anyone who forks or installs your project has no legal right to use it. Enterprises will block this repo.",
      payoff: "Adding MIT or Apache 2.0 license takes 2 minutes and removes the #1 reason enterprises reject projects.",
      effort: "minutes",
      dependsOn: [],
      unlocks: ["legal-adoption", "enterprise-approval"],
    });
  }

  if (securityInfo.secretsFound > 0) {
    blockers.push({
      type: "safety-risk", priority: 1,
      title: `${securityInfo.secretsFound} exposed secret(s) — credentials in the repo`,
      impact: "Exposed API keys and secrets can be used by anyone who finds them. Automated scanners crawl GitHub for exactly these patterns.",
      payoff: "Remove secrets, add them to .env, and revoke the exposed keys. Prevents account takeover and data breaches.",
      effort: "hours",
      dependsOn: [],
      unlocks: ["security-audit-clean"],
    });
  }

  // ─── 2. SAFETY RISKS ───────────────────────────────────────────
  if (bugsAndLeaks.length > 0) {
    blockers.push({
      type: "safety-risk", priority: 2,
      title: `${bugsAndLeaks.length} known bugs and potential crashes`,
      impact: `Every bug is a potential production incident. ${bugsAndLeaks.filter(b => b.includes("null") || b.includes("undefined")).length > 0 ? "Null crashes are the most common cause of production failures." : ""}`,
      payoff: "Fix the null-safety bugs first (highest crash rate), then work through the remaining issues.",
      effort: "days",
      dependsOn: [],
      unlocks: ["production-stability"],
    });
  }

  // ─── 3. REFACTOR PREREQUISITES ─────────────────────────────────
  if (structuralSmells.length > 0) {
    const godFiles = structuralSmells.filter(s => s.includes("mixed concerns") || s.includes("god-file"));
    if (godFiles.length > 0) {
      blockers.push({
        type: "refactor-prerequisite", priority: 2,
        title: `${godFiles.length} file(s) mixing multiple concerns — must split before adding features`,
        impact: "Every new feature added to these files makes them harder to split later. The cost compounds.",
        payoff: `Split the ${godFiles.length} file(s) into dedicated modules first. This makes future feature work 2-3x faster.`,
        effort: "days",
        dependsOn: ["production-stability"],
        unlocks: ["feature-velocity"],
      });
    }
  }

  // ─── 4. VELOCITY DRAGS ─────────────────────────────────────────
  if (reportVibe.recommendations.length > 0) {
    blockers.push({
      type: "velocity-drag", priority: 3,
      title: `${reportVibe.recommendations.length} code quality issues slowing development`,
      impact: "Inconsistent naming, mixed conventions, and poor hygiene add cognitive overhead. Every developer spends mental energy decoding the code instead of adding value.",
      payoff: "Standardizing conventions and cleaning up hygiene issues reduces onboarding time for new devs by 40-60%.",
      effort: "sprint",
      dependsOn: ["refactor-prerequisite"],
      unlocks: ["team-velocity", "onboarding-speed"],
    });
  }

  // ─── 5. ARCHITECTURE TRAPS ─────────────────────────────────────
  if (hallucinatedFeatures.length > 0) {
    blockers.push({
      type: "architecture-trap", priority: 3,
      title: `${hallucinatedFeatures.length} claimed but unimplemented feature(s) — architectural dead ends`,
      impact: "Features documented but not built create false expectations. When someone tries to build them, they may find the architecture doesn't actually support them.",
      payoff: "Either remove from documentation or build them. Documented-but-unbuilt features are trust-killers for users and investors.",
      effort: "sprint",
      dependsOn: ["refactor-prerequisite"],
      unlocks: ["trustworthy-docs"],
    });
  }

  // ─── 6. KNOWLEDGE GAPS ─────────────────────────────────────────
  if (dimensionScores.vibe < 50) {
    blockers.push({
      type: "knowledge-gap", priority: 4,
      title: "Low code consistency score — high onboarding friction",
      impact: "Every new team member must learn the project's unique patterns rather than applying standard practices. This increases ramp-up time by weeks.",
      payoff: "Adopting standard conventions (consistent naming, folder structure, patterns) makes the codebase self-documenting.",
      effort: "sprint",
      dependsOn: ["velocity-drag"],
      unlocks: ["team-scalability"],
    });
  }

  // ─── 7. DEPLOYMENT GAPS ────────────────────────────────────────
  if (!deploymentReadiness.hasCIConfig) {
    blockers.push({
      type: "deploy-blocker", priority: 2,
      title: "No CI/CD pipeline — every deploy is a manual risk",
      impact: "Without CI, every merge is a potential regression. No automated tests run. No build verification. Deploying becomes a high-anxiety manual process.",
      payoff: "A basic CI pipeline (lint → test → build) catches 80% of regressions before they reach production.",
      effort: "hours",
      dependsOn: [],
      unlocks: ["safe-merges", "automated-deploys"],
    });
  }

  if (!deploymentReadiness.hasDockerfile && !deploymentReadiness.hasCIConfig) {
    blockers.push({
      type: "deploy-blocker", priority: 2,
      title: "No Dockerfile and no CI — deployment is fully manual",
      impact: "Every deploy requires manual setup, manual testing, and manual rollback procedures. 'Works on my machine' becomes the standard.",
      payoff: "Add a Dockerfile for reproducible builds. Add CI for automated verification. Together they eliminate entire classes of deployment failures.",
      effort: "days",
      dependsOn: [],
      unlocks: ["reproducible-builds"],
    });
  }

  // ─── GENERATE PLAN ─────────────────────────────────────────────
  const sorted = blockers.sort((a, b) => a.priority - b.priority);

  const topPriority = sorted[0]?.title || "No critical blockers identified";
  const quickestWin = sorted.filter(b => b.effort === "minutes" || b.effort === "hours")
    .sort((a, b) => a.priority - b.priority)[0]?.title || "All fixes require significant effort";
  const biggestRisk = sorted.filter(b => b.type === "safety-risk" || b.type === "deploy-blocker")
    .sort((a, b) => a.priority - b.priority)[0]?.title || "No immediate risks identified";

  // Build sequential fix plan
  const sequence: string[] = [];
  const handled = new Set<string>();
  const addBlockers = (blockers: Blocker[]) => {
    for (const b of blockers) {
      if (handled.has(b.title)) continue;
      handled.add(b.title);

      // Add dependencies first
      if (b.dependsOn) {
        const deps = sorted.filter(d => b.dependsOn!.includes(d.title));
        if (deps.length > 0) addBlockers(deps);
      }

      sequence.push(`${priorityLabel(b.priority)} ${b.title} (${b.effort})${b.file ? ` — ${b.file}` : ""}`);
    }
  };
  addBlockers(sorted);

  return {
    blockers: sorted,
    topPriority,
    quickestWin,
    biggestRisk,
    sequence: sequence.slice(0, 10),
    summary: `${sorted.length} blockers identified. #1: ${topPriority}. Quickest win: ${quickestWin}. ${sequence.length} steps in recommended sequence.`,
  };
}

function priorityLabel(p: number): string {
  switch (p) {
    case 1: return "🔴";
    case 2: return "⚠️";
    case 3: return "🔶";
    case 4: return "💡";
    default: return "•";
  }
}
