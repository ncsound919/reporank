export function analyzeHygiene(files: { path: string; content: string }[]) {
  let commentedCode = 0, todos = 0, consoleLogs = 0;

  for (const file of files) {
    const c = file.content;
    commentedCode += (c.match(/\/\/\s*.+[;{}]/gm) || []).length;
    todos += (c.match(/\/\/\s*(TODO|FIXME|HACK)/gi) || []).length;
    consoleLogs += (c.match(/console\.(log|warn|error|debug)\(/g) || []).length;
  }

  let score = 100; const recommendations: string[] = [];
  if (commentedCode > 10) { score -= 30; recommendations.push(`Found ${commentedCode} commented-out code blocks — clean up.`); }
  if (todos > 5) { score -= 15; recommendations.push(`${todos} TODO/FIXME comments — address.`); }
  if (consoleLogs > 5) { score -= 15; recommendations.push(`${consoleLogs} console statements — remove before production.`); }
  return { score: Math.max(0, score), recommendations };
}
