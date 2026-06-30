const SECRET_PATTERNS = [
  { name: "aws-access-key", pattern: /AKIA[0-9A-Z]{16}/g, severity: "critical" },
  { name: "github-token", pattern: /gh[pousr]_[A-Za-z0-9_]{36,}/g, severity: "critical" },
  { name: "openai-api-key", pattern: /sk-[A-Za-z0-9]{20,}/g, severity: "critical" },
  { name: "google-api-key", pattern: /AIza[0-9A-Za-z\-_]{35}/g, severity: "critical" },
  { name: "private-key", pattern: /-----BEGIN\s+(RSA|EC|DSA|OPENSSH)\s+PRIVATE\s+KEY-----/g, severity: "critical" },
  { name: "connection-string", pattern: /(postgresql|mysql|mongodb|redis):\/\/[^\s]{10,}/gi, severity: "critical" },
  { name: "stripe-key", pattern: /(sk_live|pk_live|sk_test|pk_test)_[0-9A-Za-z]{24,}/g, severity: "critical" },
  { name: "jwt-token", pattern: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, severity: "high" },
  { name: "slack-token", pattern: /xox[baprs]-[0-9A-Za-z-]{10,}/g, severity: "high" },
];

export function scanSecrets(content: string) {
  const secrets = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    for (const p of SECRET_PATTERNS) {
      const matches = lines[i].matchAll(p.pattern);
      for (const m of matches) {
        if (m.index === undefined) continue;
        const val = m[0];
        if (val.includes("test") || val.includes("example")) continue;
        secrets.push({ type: p.name, line: i + 1, column: m.index + 1, redacted: redactSecret(val), severity: p.severity });
      }
    }
  }
  return { secretsFound: secrets.length, secrets, recommendation: secrets.length > 0 ? `Found ${secrets.length} secret(s) — review immediately.` : "No secrets detected." };
}

function redactSecret(val: string): string {
  if (val.length <= 8) {
    return val[0] + "***";
  }
  return val.slice(0, 4) + "****" + val.slice(-4);
}
