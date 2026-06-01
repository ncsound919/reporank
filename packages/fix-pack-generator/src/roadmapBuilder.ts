import type { QuickWin, RoadmapItem } from "@reporank/shared-types";

export function buildRoadmap(wins: QuickWin[], overallScore: number): RoadmapItem[] {
  const now: RoadmapItem[] = wins.filter(w => w.severity === "critical" || w.severity === "high").map((w, i) => ({
    phase: "now", priority: i + 1, category: w.category, task: w.title, effort: w.effort === "minutes" ? "hours" as const : w.effort,
  }));
  const next: RoadmapItem[] = wins.filter(w => w.severity === "medium").map((w, i) => ({
    phase: "next", priority: i + 1, category: w.category, task: w.title, effort: w.effort === "minutes" ? "hours" as const : w.effort,
  }));
  const later: RoadmapItem[] = wins.filter(w => w.severity === "low").map((w, i) => ({
    phase: "later", priority: i + 1, category: w.category, task: w.title, effort: w.effort === "minutes" ? "hours" as const : w.effort,
  }));

  if (overallScore < 50) now.push({ phase: "now", priority: now.length + 1, category: "Architecture", task: "Fix critical structural issues before adding features", effort: "days" });
  if (overallScore >= 50 && overallScore < 70) next.push({ phase: "next", priority: next.length + 1, category: "Testing", task: "Add test coverage for core modules", effort: "days" });

  return [...now, ...next, ...later];
}
