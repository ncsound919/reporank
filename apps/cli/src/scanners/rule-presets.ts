export const SEMGREP_PRESETS = {
  default: ["p/owasp-top-ten", "p/security-audit", "p/javascript", "p/typescript", "p/nodejs", "p/react"],
  security: ["p/owasp-top-ten", "p/security-audit", "p/secrets"],
  quality: ["p/javascript", "p/typescript", "p/nodejs", "p/react"],
  custom: [] as string[],
} as const;

export type PresetName = keyof typeof SEMGREP_PRESETS;
