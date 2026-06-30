export interface SharedCheckResult {
  hasStructuredLogging: boolean;
  consoleLogCount: number;
  hasHealthCheck: boolean;
  hardcodedUrlHits: string[];
}

export function checkStructuredLogging(sourceFiles: { path: string; content: string }[]): {
  hasStructuredLogger: boolean;
  consoleLogCount: number;
} {
  const allContent = sourceFiles.map(f => f.content).join("\n");
  const hasStructuredLogger = /\b(pino|winston|bunyan|log4j)\b/i.test(allContent);
  const consoleLogCount = (allContent.match(/console\.(log|warn|error|debug|info)\(/g) || []).length;
  return { hasStructuredLogger, consoleLogCount };
}

export function checkHealthEndpoint(sourceFiles: { path: string; content: string }[]): boolean {
  return sourceFiles.some(f =>
    /\/(health|healthz|ready)\b/.test(f.content)
    || f.content.includes("healthcheck")
    || f.content.includes("healthCheck")
  );
}

export function checkHardcodedUrls(allContent: string): string[] {
  const hits: string[] = [];
  const patterns: { regex: RegExp; label: string }[] = [
    { regex: /localhost:\d+/g, label: "hardcoded localhost URLs" },
    { regex: /['"]https?:\/\/[^'"{}]+\.[a-z]{2,}(?:\.[a-z]{2,})*/g, label: "hardcoded external URLs" },
    { regex: /port\s*=\s*\d{4,5}/g, label: "hardcoded port numbers" },
  ];
  for (const { regex, label } of patterns) {
    const matches = allContent.match(regex);
    if (matches && matches.length > 2) {
      hits.push(`${matches.length} instances of ${label}`);
    }
  }
  return hits;
}
