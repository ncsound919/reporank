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

const FEATURE_PATTERNS = [
  /users? (?:can|should|will|must|shall) (.+?)(?:\.|,|;|$)/gi,
  /(?:implement|build|create|add|support) (.+?)(?:\.|,|;|$)/gi,
  /(?:feature|functionality|capability):\s*(.+?)(?:\.|,|;|$)/gi,
  /- (.+?) (?:feature|page|screen|endpoint|flow)/gi,
  /##\s+(.+)/g, // Markdown headings as features
];

const INTEGRATION_MARKERS = [
  "stripe", "supabase", "firebase", "clerk", "auth0", "sendgrid", "resend",
  "twilio", "openai", "anthropic", "pinecone", "algolia", "elasticsearch",
  "redis", "postgres", "mysql", "mongodb", "s3", "cloudinary", "vercel",
  "railway", "fly.io", "netlify", "aws", "gcp", "azure", "github", "linear",
  "slack", "discord", "notion", "airtable", "hubspot", "salesforce",
];

const PERSONA_PATTERNS = [
  /(?:as a|for|target user is|users are) ([a-z\s]+?)(?:\.|,|;|$)/gi,
  /persona:\s*([^.\n]+)/gi,
  /role:\s*([^.\n]+)/gi,
];

const CONSTRAINT_PATTERNS = [
  /(?:must not|should not|do not|never) (.+?)(?:\.|,|;|$)/gi,
  /(?:constraint|limitation|restriction|out of scope):\s*(.+?)(?:\.|,|;|$)/gi,
  /(?:no|without) (.+?)(?:\.|,|;|$)/gi,
];

const QUALITY_PATTERNS = [
  /(?:must be|should be|needs to be) (?:fast|secure|accessible|responsive|reliable|scalable|tested)/gi,
  /(?:performance|security|accessibility|test coverage|uptime|latency)[^\n.]*(?:\.|$)/gi,
  /(?:95th percentile|p99|<\d+ms|zero downtime|99\.?\d*%)[^\n.]*/gi,
];

function extractMatches(text: string, patterns: RegExp[]): string[] {
  const results = new Set<string>();
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const extracted = (match[1] || match[0]).trim();
      if (extracted.length > 3 && extracted.length < 200) {
        results.add(extracted.charAt(0).toUpperCase() + extracted.slice(1));
      }
    }
  }
  return [...results].slice(0, 30);
}

function extractIntegrations(text: string): string[] {
  const lower = text.toLowerCase();
  return INTEGRATION_MARKERS.filter(marker => lower.includes(marker));
}

export function parseIntent(text: string, source: string): IntentDocument {
  const promisedFeatures = extractMatches(text, FEATURE_PATTERNS);
  const constraints = extractMatches(text, CONSTRAINT_PATTERNS);
  const personas = extractMatches(text, PERSONA_PATTERNS);
  const integrations = extractIntegrations(text);
  const qualityExpectations = extractMatches(text, QUALITY_PATTERNS);

  return {
    source,
    promisedFeatures,
    constraints,
    personas,
    integrations,
    qualityExpectations,
    extractedAt: new Date().toISOString(),
  };
}
