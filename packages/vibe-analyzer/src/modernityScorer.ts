export function analyzeModernity(files: { path: string; content: string }[]) {
  let callbackPatterns = 0, hookCount = 0;
  let usesAsyncAwait = false, usesHooks = false, usesTypeScript = false;

  for (const file of files) {
    if (file.path.endsWith(".ts") || file.path.endsWith(".tsx")) usesTypeScript = true;
    const c = file.content;
    const awaitMatches = c.match(/\bawait\b/g);
    if (awaitMatches) { usesAsyncAwait = true; }
    if (c.match(/\.(then|catch)\s*\(function/g)) callbackPatterns += (c.match(/\.(then|catch)\s*\(function/g) || []).length;
    if (c.match(/use[A-Z][a-zA-Z]*\s*\(/g)) { hookCount += (c.match(/use[A-Z][a-zA-Z]*\s*\(/g) || []).length; usesHooks = true; }
  }

  let score = 0; const recommendations: string[] = [];
  if (usesAsyncAwait) score += 30; else recommendations.push("Migrate from callbacks to async/await.");
  if (callbackPatterns === 0) score += 20; else if (callbackPatterns >= 5) recommendations.push(`Found ${callbackPatterns} callback patterns — prefer async/await.`);
  if (usesHooks) score += 25; else recommendations.push("No React hooks detected — use functional components + hooks.");
  if (usesTypeScript) score += 25; else recommendations.push("TypeScript would improve type safety.");

  return { score, recommendations };
}
