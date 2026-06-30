/**
 * intentParser — extracts structured intent from raw text (prompt, PRD, README, knowledge file).
 * Pure function, deterministic, no I/O.
 */

export interface IntentDocument {
  source: string;
  promisedFeatures: string[];
  constraints: string[];
  personas: string[];
  integrations: string[];
  qualityExpectations: string[];
  extractedAt: string;
}

const FEATURE_PATTERNS: readonly RegExp[] = [
  /users?\s+(?:can|should|will|must|shall)\s+(.+?)(?:\.|,|;|$)/gi,
  /(?:implement|build|create|add|support)\s+(.+?)(?:\.|,|;|$)/gi,
  /(?:feature|functionality|capability):\s*(.+?)(?:\.|,|;|$)/gi,
  /-\s+(.+?)\s+(?:feature|page|screen|endpoint|flow)/gi,
  /^##\s+(.+)$/gim,
];

const INTEGRATION_MARKERS = [
  "stripe",
  "supabase",
  "firebase",
  "clerk",
  "auth0",
  "sendgrid",
  "resend",
  "twilio",
  "openai",
  "anthropic",
  "pinecone",
  "algolia",
  "elasticsearch",
  "redis",
  "postgres",
  "mysql",
  "mongodb",
  "s3",
  "cloudinary",
  "vercel",
  "railway",
  "fly.io",
  "netlify",
  "aws",
  "gcp",
  "azure",
  "github",
  "linear",
  "slack",
  "discord",
  "notion",
  "airtable",
  "hubspot",
  "salesforce",
] as const;

const PERSONA_PATTERNS: readonly RegExp[] = [
  /(?:as a|for|target user is|users are)\s+([a-z][a-z\s/-]+?)(?:\.|,|;|$)/gi,
  /persona:\s*([^.\n]+)/gi,
  /role:\s*([^.\n]+)/gi,
];

const CONSTRAINT_PATTERNS: readonly RegExp[] = [
  /(?:must not|should not|do not|never)\s+(.+?)(?:\.|,|;|$)/gi,
  /(?:constraint|limitation|restriction|out of scope):\s*(.+?)(?:\.|,|;|$)/gi,
  /(?:no|without)\s+(.+?)(?:\.|,|;|$)/gi,
];

const QUALITY_PATTERNS: readonly RegExp[] = [
  /(?:must be|should be|needs to be)\s+(?:fast|secure|accessible|responsive|reliable|scalable|tested)(?:\.|,|;|$)/gi,
  /(?:performance|security|accessibility|test coverage|uptime|latency)[^\n.]*(?:\.|$)/gi,
  /(?:95th percentile|p99|<\d+ms|zero downtime|99\.?\d*%)[^\n.]*/gi,
];

const MAX_ITEMS_PER_SECTION = 30;
const DETERMINISTIC_EXTRACTED_AT = "1970-01-01T00:00:00.000Z";

function uniqPreserveOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }

  return result;
}

function normalizeExtracted(value: string): string {
  const cleaned = value
    .replace(/[`*_#>-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[a-z]/, (char) => char.toUpperCase());

  return cleaned;
}

function extractMatches(text: string, patterns: readonly RegExp[]): string[] {
  const results: string[] = [];

  for (const pattern of patterns) {
    const regex = new RegExp(pattern.source, pattern.flags);
    let match: RegExpExecArray | null = null;

    while ((match = regex.exec(text)) !== null) {
      const extracted = normalizeExtracted((match[1] ?? match[0] ?? "").trim());

      if (extracted.length > 3 && extracted.length < 200) {
        results.push(extracted);
      }

      if (match[0].length === 0) {
        regex.lastIndex += 1;
      }
    }
  }

  return uniqPreserveOrder(results).slice(0, MAX_ITEMS_PER_SECTION);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function includesMarker(text: string, marker: string): boolean {
  const escaped = escapeRegex(marker);
  const regex = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i");
  return regex.test(text);
}

function extractIntegrations(text: string): string[] {
  const lower = text.toLowerCase();

  return INTEGRATION_MARKERS.filter((marker) => includesMarker(lower, marker)).slice(
    0,
    MAX_ITEMS_PER_SECTION,
  );
}

export function parseIntent(text: string, source: string): IntentDocument {
  const safeText = typeof text === "string" ? text : "";
  const safeSource = typeof source === "string" ? source : "";

  const promisedFeatures = extractMatches(safeText, FEATURE_PATTERNS);
  const constraints = extractMatches(safeText, CONSTRAINT_PATTERNS);
  const personas = extractMatches(safeText, PERSONA_PATTERNS);
  const integrations = extractIntegrations(safeText);
  const qualityExpectations = extractMatches(safeText, QUALITY_PATTERNS);

  return {
    source: safeSource,
    promisedFeatures,
    constraints,
    personas,
    integrations,
    qualityExpectations,
    extractedAt: DETERMINISTIC_EXTRACTED_AT,
  };
}
