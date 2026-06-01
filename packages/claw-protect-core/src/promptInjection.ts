const PATTERNS = [
  { name: "role-escape", pattern: /ignore\s+(all\s+)?(previous|above|below)\s+(instructions|commands)/i, severity: "high" },
  { name: "system-override", pattern: /(you\s+are\s+now|act\s+as|pretend\s+to\s+be|from\s+now\s+on)\s+.*(system|assistant|admin)/i, severity: "high" },
  { name: "delimiter-injection", pattern: /(===|---|\"\"\"|''')\s*(user|system|assistant)\s*(===|---|\"\"\"|''')/i, severity: "medium" },
  { name: "jailbreak", pattern: /do\s+anything\s+now|no\s+(restrictions|limits|boundaries|filter)/i, severity: "high" },
  { name: "prompt-leak", pattern: /(print|display|show|reveal|output|leak)\s+(your|the|this)\s+(prompt|instructions|system|rules)/i, severity: "high" },
  { name: "zero-width", pattern: /[\u200B\u200C\u200D\uFEFF]/, severity: "medium" },
];

export function scanPrompt(content: string) {
  const detected = PATTERNS.filter(p => p.pattern.test(content));
  return {
    isInjection: detected.length > 0,
    confidence: detected.length > 0 ? Math.min(100, detected.length * 25) : 0,
    detectedPatterns: detected.map(d => d.name),
    recommendation: detected.length > 0 ? `Blocked: ${detected.length} injection pattern(s) detected` : "No injection patterns detected.",
  };
}
