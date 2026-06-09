import type { Finding } from "../review_scanner";

export function isNearDupe(a: Finding, b: Finding): boolean {
  if (a.type !== b.type) {
    const aTokens = a.type.split("-");
    const bTokens = b.type.split("-");
    if (!aTokens.some((t) => bTokens.includes(t))) return false;
  }
  if (a.line > 0 && b.line > 0) {
    return Math.abs(a.line - b.line) <= 2;
  }
  return a.category === b.category;
}

export function dedupeFindings(findings: Finding[]): Finding[] {
  const sorted = [...findings].sort((a, b) => b.confidence - a.confidence);
  const kept: Finding[] = [];
  for (const f of sorted) {
    const dupe = kept.find((k) => isNearDupe(k, f));
    if (!dupe) kept.push(f);
  }
  return kept;
}

export function capFindings(findings: Finding[], maxPerType = 1): Finding[] {
  const sorted = [...findings].sort((a, b) => b.confidence - a.confidence);
  const seen = new Map<string, number>();
  const kept: Finding[] = [];
  for (const f of sorted) {
    const key = `${f.category}::${f.type}`;
    const count = seen.get(key) ?? 0;
    if (count >= maxPerType) continue;
    seen.set(key, count + 1);
    kept.push(f);
  }
  return kept;
}
