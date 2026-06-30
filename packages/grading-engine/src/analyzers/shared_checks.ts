export interface SharedCheckResult {
  hasStructuredLogging: boolean;
  consoleLogCount: number;
  hasHealthCheck: boolean;
  hardcodedUrlHits: string[];
}

export interface AnchoredFinding {
  file: string;
  line: number;
  match: string;
}

/**
 * Checks for structured logging per file, returning anchored findings.
 * No longer joins all content — line numbers are now meaningful.
 */
export function checkStructuredLogging(sourceFiles: { path: string; content: string }[]): {
  hasStructuredLogger: boolean;
  consoleLogCount: number;
  findings: AnchoredFinding[];
} {
  let hasStructuredLogger = false;
  let consoleLogCount = 0;
  const findings: AnchoredFinding[] = [];

  for (const file of sourceFiles) {
    if (/\b(pino|winston|bunyan|log4j)\b/i.test(file.content)) {
      hasStructuredLogger = true;
    }
    const lines = file.content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(/console\.(log|warn|error|debug|info)\(/);
      if (match) {
        consoleLogCount++;
        findings.push({ file: file.path, line: i + 1, match: match[0] });
      }
    }
  }

  return { hasStructuredLogger, consoleLogCount, findings };
}

export function checkHealthEndpoint(sourceFiles: { path: string; content: string }[]): boolean {
  return sourceFiles.some(f =>
    /\/(health|healthz|ready)\b/.test(f.content)
    || f.content.includes("healthcheck")
    || f.content.includes("healthCheck")
  );
}

/**
 * Checks for hardcoded URLs per file, returning anchored findings with file + line context.
 */
export function checkHardcodedUrls(sourceFiles: { path: string; content: string }[]): {
  summary: string[];
  findings: AnchoredFinding[];
} {
  const patterns: { regex: RegExp; label: string }[] = [
    { regex: /localhost:\d+/, label: "hardcoded localhost URL" },
    { regex: /['"]https?:\/\/[^'"{}]+\.[a-z]{2,}(?:\.[a-z]{2,})*/, label: "hardcoded external URL" },
    { regex: /port\s*=\s*\d{4,5}/, label: "hardcoded port number" },
  ];

  const findings: AnchoredFinding[] = [];
  const hitCounts: Record<string, number> = {};

  for (const file of sourceFiles) {
    const lines = file.content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      for (const { regex, label } of patterns) {
        const match = lines[i].match(regex);
        if (match) {
          findings.push({ file: file.path, line: i + 1, match: match[0].trim() });
          hitCounts[label] = (hitCounts[label] || 0) + 1;
        }
      }
    }
  }

  const summary = Object.entries(hitCounts)
    .filter(([, count]) => count > 2)
    .map(([label, count]) => `${count} instances of ${label}`);

  return { summary, findings };
}
