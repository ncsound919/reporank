export function analyzeNaming(files: string[]) {
  const conventions: Record<string, number> = { camelCase: 0, snake_case: 0, "kebab-case": 0, PascalCase: 0 };
  let total = 0;

  for (const file of files) {
    const name = (file.split("/").pop() || file).split(".").slice(0, -1).join(".");
    if (!name) continue;
    if (/^[a-z][a-zA-Z0-9]*$/.test(name)) conventions.camelCase++;
    else if (/^[a-z][a-z0-9_]*$/.test(name)) conventions.snake_case++;
    else if (/^[a-z][a-z0-9-]*$/.test(name)) conventions["kebab-case"]++;
    else if (/^[A-Z][a-zA-Z0-9]*$/.test(name)) conventions.PascalCase++;
    total++;
  }

  if (total === 0) return { score: 100, recommendations: [] };
  const sorted = Object.entries(conventions).sort((a, b) => b[1] - a[1]);
  const maxPct = (sorted[0][1] / total) * 100;
  const score = maxPct >= 90 ? 100 : maxPct >= 70 ? 70 : maxPct >= 50 ? 40 : 20;
  const recommendations = maxPct < 70 ? ["Mixed naming conventions — consider standardizing to one style."] : [];
  return { dominant: sorted[0][0], score, recommendations };
}
