/**
 * Tech Debt Interest Calculator — estimates the real-world cost of leaving
 * each issue unfixed. "This missing null guard will cause ~3 crashes/year."
 * No other code review tool quantifies the cost of inaction.
 */
export interface DebtItem {
  issue: string;
  category: string;
  severity: string;
  interestHoursPerMonth: number;
  interestCostPerYear: number;
  fixEffort: "minutes" | "hours" | "days";
  rationale: string;
}

export interface TechDebtReport {
  items: DebtItem[];
  totalMonthlyInterest: number;
  totalYearlyCost: number;
  topCostItems: DebtItem[];
  summary: string;
}

const CRASH_COST_HOURS = 6;  // Average hours to investigate + fix a production crash
const INCIDENT_COST_HOURS = 4; // Average hours for a minor incident

export function calculateTechDebt(
  codeHygieneFindings: { category: string; severity: string; detail: string }[] | undefined,
  productionFindings: { type: string; severity: string; detail: string }[] | undefined,
  securitySecretsCount: number,
  overallScore: number
): TechDebtReport {
  const items: DebtItem[] = [];

  // 1. Null safety: missing null guards = crashes
  const nullSafetyCount = codeHygieneFindings?.filter(f => f.category === "null-safety").length || 0;
  if (nullSafetyCount > 0) {
    const crashesPerMonth = Math.ceil(nullSafetyCount / 3);
    items.push({
      issue: `${nullSafetyCount} missing null guards (potential crashes)`,
      category: "Reliability", severity: "high",
      interestHoursPerMonth: crashesPerMonth * CRASH_COST_HOURS,
      interestCostPerYear: crashesPerMonth * CRASH_COST_HOURS * 12 * 100, // $100/hr developer cost
      fixEffort: "hours",
      rationale: `~${crashesPerMonth} crash/month from null pointer exceptions at $${CRASH_COST_HOURS * 100}/crash`,
    });
  }

  // 2. Loose equality: subtle comparison bugs
  const looseEqCount = codeHygieneFindings?.filter(f => f.category === "comparison-bug").length || 0;
  if (looseEqCount > 0) {
    items.push({
      issue: `${looseEqCount} loose equality (==) comparisons — type coercion bugs`,
      category: "Correctness", severity: "medium",
      interestHoursPerMonth: Math.ceil(looseEqCount / 10) * INCIDENT_COST_HOURS,
      interestCostPerYear: Math.ceil(looseEqCount / 10) * INCIDENT_COST_HOURS * 12 * 100,
      fixEffort: "hours",
      rationale: `~${Math.ceil(looseEqCount / 10)} incidents/month from comparison bugs at $${INCIDENT_COST_HOURS * 100}/incident`,
    });
  }

  // 3. Console.log in production: debugging overhead
  const consoleCount = codeHygieneFindings?.filter(f => f.category === "console-left-in").length || 0;
  if (consoleCount > 0) {
    items.push({
      issue: `${consoleCount} console.log statements remove before production`,
      category: "Observability", severity: "medium",
      interestHoursPerMonth: 1,
      interestCostPerYear: 12 * 100,
      fixEffort: "minutes",
      rationale: "1 hour/month of log noise filtering during incident response",
    });
  }

  // 4. Missing timeouts: production hangs
  const noTimeout = productionFindings?.filter(f => f.type === "missing-timeout").length || 0;
  if (noTimeout > 0) {
    items.push({
      issue: `${noTimeout} HTTP calls without timeout — can hang indefinitely`,
      category: "Reliability", severity: "high",
      interestHoursPerMonth: 2,
      interestCostPerYear: 24 * 100,
      fixEffort: "hours",
      rationale: "~2 hours/month of manual intervention for hung connections",
    });
  }

  // 5. Memory leaks: growing resource usage
  const memLeaks = codeHygieneFindings?.filter(f => f.category === "memory-leak").length || 0;
  if (memLeaks > 0) {
    items.push({
      issue: `${memLeaks} memory leak(s) — setInterval without clearInterval`,
      category: "Performance", severity: "high",
      interestHoursPerMonth: 3,
      interestCostPerYear: 36 * 100,
      fixEffort: "hours",
      rationale: "~3 hours/month for memory-related incident response + increased infrastructure costs",
    });
  }

  // 6. Unhandled rejections: process crashes
  const unhandled = productionFindings?.filter(f => f.type === "unhandled-rejection").length || 0;
  if (unhandled > 0) {
    items.push({
      issue: `${unhandled} unhandled promise rejection(s) — process will crash`,
      category: "Reliability", severity: "critical",
      interestHoursPerMonth: 4,
      interestCostPerYear: 48 * 100,
      fixEffort: "days",
      rationale: "~4 hours/month of incident response + user-facing downtime",
    });
  }

  // 7. Exposed secrets: breach risk
  if (securitySecretsCount > 0) {
    items.push({
      issue: `${securitySecretsCount} exposed secret(s) — data breach risk`,
      category: "Security", severity: "critical",
      interestHoursPerMonth: 8,
      interestCostPerYear: 96 * 100,
      fixEffort: "hours",
      rationale: "~8 hours/month of security review overhead + potential breach remediation",
    });
  }

  // 8. Low overall score: general productivity tax
  if (overallScore < 60) {
    const productivityTax = Math.round((60 - overallScore) * 0.5);
    items.push({
      issue: `Low codebase quality (${overallScore}/100) — developer productivity tax`,
      category: "Productivity", severity: "medium",
      interestHoursPerMonth: productivityTax,
      interestCostPerYear: productivityTax * 12 * 100,
      fixEffort: "days",
      rationale: `~${productivityTax} hours/month lost to navigating confusing code + debugging preventable issues`,
    });
  }

  const totalMonthlyInterest = items.reduce((s, i) => s + i.interestHoursPerMonth, 0);
  const totalYearlyCost = items.reduce((s, i) => s + i.interestCostPerYear, 0);

  return {
    items,
    totalMonthlyInterest,
    totalYearlyCost,
    topCostItems: [...items].sort((a, b) => b.interestCostPerYear - a.interestCostPerYear).slice(0, 5),
    summary: `${items.length} debt items identified. ` +
      `Paying ~${totalMonthlyInterest}h/month ($${totalYearlyCost.toLocaleString()}/year) in tech debt interest. ` +
      (items.length > 0 ? `Fix these: ${items.map(i => i.issue.split(" — ")[0]).join(", ")}` : ""),
  };
}
