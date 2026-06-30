type SecretSeverity = "critical" | "high";

interface SecretPattern {
  readonly name: string;
  readonly pattern: RegExp;
  readonly severity: SecretSeverity;
}

export interface SecretFinding {
  type: string;
  line: number;
  column: number;
  redacted: string;
  severity: SecretSeverity;
}

export interface SecretScanResult {
  secretsFound: number;
  secrets: SecretFinding[];
  recommendation: string;
}

const SECRET_PATTERNS: readonly SecretPattern[] = [
  { name: "aws-access-key", pattern: /AKIA[0-9A-Z]{16}/g, severity: "critical" },
  { name: "github-token", pattern: /gh[pousr]_[A-Za-z0-9_]{36,}/g, severity: "critical" },
  { name: "openai-api-key", pattern: /sk-[A-Za-z0-9]{20,}/g, severity: "critical" },
  { name: "google-api-key", pattern: /AIza[0-9A-Za-z\-_]{35}/g, severity: "critical" },
  { name: "private-key", pattern: /-----BEGIN\s+(RSA|EC|DSA|OPENSSH)\s+PRIVATE\s+KEY-----/g, severity: "critical" },
  { name: "connection-string", pattern: /(postgresql|mysql|mongodb|redis):\/\/[^\s]{10,}/gi, severity: "critical" },
  { name: "stripe-key", pattern: /(sk_live|pk_live|sk_test|pk_test)_[0-9A-Za-z]{24,}/g, severity: "critical" },
  { name: "jwt-token", pattern: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, severity: "high" },
  { name: "slack-token", pattern: /xox[baprs]-[0-9A-Za-z-]{10,}/g, severity: "high" },
] as const;

const PLACEHOLDER_MARKERS = [
  "example",
  "sample",
  "dummy",
  "changeme",
  "your_",
  "your-",
  "test",
] as const;

export function scanSecrets(content: string): SecretScanResult {
  const secrets: SecretFinding[] = [];
  const lines = content.split(/\r?\n/);

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];

    for (const secretPattern of SECRET_PATTERNS) {
      const regex = cloneGlobalRegex(secretPattern.pattern);

      for (const match of line.matchAll(regex)) {
        if (match.index === undefined) continue;

        const value = match[0];
        if (shouldIgnoreMatch(value)) continue;

        secrets.push({
          type: secretPattern.name,
          line: lineIndex + 1,
          column: match.index + 1,
          redacted: redactSecret(value),
          severity: secretPattern.severity,
        });
      }
    }
  }

  return {
    secretsFound: secrets.length,
    secrets,
    recommendation:
      secrets.length > 0
        ? `Found ${secrets.length} secret(s) — review immediately.`
        : "No secrets detected.",
  };
}

function cloneGlobalRegex(pattern: RegExp): RegExp {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  return new RegExp(pattern.source, flags);
}

function shouldIgnoreMatch(value: string): boolean {
  const normalized = value.toLowerCase();
  return PLACEHOLDER_MARKERS.some((marker) => normalized.includes(marker));
}

function redactSecret(value: string): string {
  if (value.length <= 4) {
    return "*".repeat(value.length);
  }

  if (value.length <= 8) {
    return `${value.slice(0, 1)}***`;
  }

  return `${value.slice(0, 4)}****${value.slice(-4)}`;
}
