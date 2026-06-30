export interface ProjectFile {
  path: string;
  content: string;
}

export interface ModernityAnalysis {
  score: number;
  recommendations: string[];
  details: {
    usesTypeScript: boolean;
    usesAsyncAwait: boolean;
    usesHooks: boolean;
    likelyReactProject: boolean;
    hookCount: number;
    callbackPatterns: number;
  };
}

const TS_FILE_RE = /\.(ts|tsx)$/i;
const REACT_FILE_RE = /\.(jsx|tsx)$/i;
const AWAIT_RE = /\bawait\b/g;
const ASYNC_FUNCTION_RE = /\basync\b/g;
const PROMISE_CALLBACK_RE = /\.(then|catch|finally)\s*\(\s*function\b/g;
const HOOK_CALL_RE = /\buse[A-Z][a-zA-Z0-9]*\s*\(/g;
const REACT_IMPORT_RE =
  /\bfrom\s+["']react["']|\brequire\s*\(\s*["']react["']\s*\)|<\s*[A-Z][A-Za-z0-9]*/;

export function analyzeModernity(files: ProjectFile[]): ModernityAnalysis {
  let callbackPatterns = 0;
  let hookCount = 0;
  let asyncKeywordCount = 0;
  let awaitCount = 0;

  let usesTypeScript = false;
  let likelyReactProject = false;

  for (const file of files) {
    if (TS_FILE_RE.test(file.path)) {
      usesTypeScript = true;
    }

    if (REACT_FILE_RE.test(file.path) || REACT_IMPORT_RE.test(file.content)) {
      likelyReactProject = true;
    }

    awaitCount += countMatches(file.content, AWAIT_RE);
    asyncKeywordCount += countMatches(file.content, ASYNC_FUNCTION_RE);
    callbackPatterns += countMatches(file.content, PROMISE_CALLBACK_RE);
    hookCount += countMatches(file.content, HOOK_CALL_RE);
  }

  const usesAsyncAwait = awaitCount > 0 || asyncKeywordCount > 0;
  const usesHooks = hookCount > 0;

  let score = 0;
  const recommendations: string[] = [];

  if (usesAsyncAwait) {
    score += 30;
  } else {
    recommendations.push("Prefer async/await for Promise-based async flows.");
  }

  if (callbackPatterns === 0) {
    score += 20;
  } else if (callbackPatterns >= 5) {
    recommendations.push(
      `Found ${callbackPatterns} Promise callback patterns — consider migrating repetitive .then()/.catch(function ...) flows to async/await.`,
    );
  }

  if (likelyReactProject) {
    if (usesHooks) {
      score += 25;
    } else {
      recommendations.push("React-like files detected, but no Hook-style usage was found.");
    }
  } else {
    score += 25;
  }

  if (usesTypeScript) {
    score += 25;
  } else {
    recommendations.push("TypeScript would improve type safety and tooling.");
  }

  return {
    score,
    recommendations,
    details: {
      usesTypeScript,
      usesAsyncAwait,
      usesHooks,
      likelyReactProject,
      hookCount,
      callbackPatterns,
    },
  };
}

function countMatches(content: string, pattern: RegExp): number {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const regex = new RegExp(pattern.source, flags);
  let count = 0;

  for (const _match of content.matchAll(regex)) {
    count += 1;
  }

  return count;
}
