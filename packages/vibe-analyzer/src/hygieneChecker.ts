export interface HygieneFile {
  path: string;
  content: string;
}

export interface HygieneAnalysis {
  score: number;
  recommendations: string[];
  details: {
    commentedCode: number;
    warningComments: number;
    consoleLogs: number;
  };
}

const WARNING_COMMENT_RE = /\b(TODO|FIXME|HACK|TASK|FIX_NOW)\b/i;
const COMMENTED_CODE_RE =
  /^(?:\/\/|\/\*+|\*+)\s*(?:const|let|var|function|class|interface|type|enum|if|else|for|while|switch|try|catch|return|import|export|async\s+function|\w+\s*=|.*[;{}])\s*$/;
const CONSOLE_RE = /\bconsole\.(log|warn|error|debug)\s*\(/g;

export function analyzeHygiene(files: HygieneFile[]): HygieneAnalysis {
  let commentedCode = 0;
  let warningComments = 0;
  let consoleLogs = 0;

  for (const file of files) {
    const lines = file.content.split(/\r?\n/);
    let inBlockComment = false;

    for (const rawLine of lines) {
      const line = rawLine.trim();

      if (!line) {
        if (inBlockComment && rawLine.includes("*/")) inBlockComment = false;
        continue;
      }

      if (inBlockComment) {
        const commentPortion = extractBlockCommentPortion(rawLine);
        if (WARNING_COMMENT_RE.test(commentPortion)) warningComments++;
        if (looksLikeCommentedCode(commentPortion)) commentedCode++;
        if (rawLine.includes("*/")) inBlockComment = false;
        continue;
      }

      if (line.startsWith("//")) {
        if (WARNING_COMMENT_RE.test(line)) warningComments++;
        if (looksLikeCommentedCode(line)) commentedCode++;
        continue;
      }

      if (line.startsWith("/*") || line.startsWith("/**")) {
        const commentPortion = extractBlockCommentPortion(rawLine);
        if (WARNING_COMMENT_RE.test(commentPortion)) warningComments++;
        if (looksLikeCommentedCode(commentPortion)) commentedCode++;
        if (!rawLine.includes("*/")) inBlockComment = true;
        continue;
      }

      const codeOnly = stripTrailingLineComment(stripInlineBlockComments(rawLine));
      consoleLogs += countMatches(codeOnly, CONSOLE_RE);

      const blockCommentStart = rawLine.indexOf("/*");
      if (blockCommentStart >= 0 && !rawLine.includes("*/", blockCommentStart + 2)) {
        const commentTail = rawLine.slice(blockCommentStart);
        if (WARNING_COMMENT_RE.test(commentTail)) warningComments++;
        if (looksLikeCommentedCode(commentTail)) commentedCode++;
        inBlockComment = true;
      }
    }
  }

  let score = 100;
  const recommendations: string[] = [];

  if (commentedCode > 10) {
    score -= 30;
    recommendations.push(`Found ${commentedCode} likely commented-out code lines — clean them up.`);
  } else if (commentedCode > 0) {
    score -= 10;
  }

  if (warningComments > 5) {
    score -= 15;
    recommendations.push(`Found ${warningComments} warning comments (TODO/FIXME/HACK/TASK) — move them into tracked work.`);
  } else if (warningComments > 0) {
    score -= 5;
  }

  if (consoleLogs > 5) {
    score -= 15;
    recommendations.push(`${consoleLogs} console statements detected — remove or gate them before production.`);
  } else if (consoleLogs > 0) {
    score -= 5;
  }

  return {
    score: Math.max(0, score),
    recommendations,
    details: {
      commentedCode,
      warningComments,
      consoleLogs,
    },
  };
}

function looksLikeCommentedCode(commentLine: string): boolean {
  return COMMENTED_CODE_RE.test(commentLine.trim());
}

function countMatches(content: string, pattern: RegExp): number {
  const regex = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
  let count = 0;
  for (const _ of content.matchAll(regex)) count++;
  return count;
}

function stripTrailingLineComment(line: string): string {
  const index = line.indexOf("//");
  return index >= 0 ? line.slice(0, index) : line;
}

function stripInlineBlockComments(line: string): string {
  return line.replace(/\/\*.*?\*\//g, " ");
}

function extractBlockCommentPortion(line: string): string {
  const start = line.indexOf("/*");
  if (start === -1) return line.trim();
  const end = line.indexOf("*/", start + 2);
  return (end === -1 ? line.slice(start) : line.slice(start, end + 2)).trim();
}
