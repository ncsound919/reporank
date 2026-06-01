export interface ScanPromptRequest { content: string; isWebContent?: boolean; }
export interface ScanPromptResponse {
  isInjection: boolean; confidence: number; detectedPatterns: string[];
  sanitized: string | null; recommendation: string;
}
export interface ScanSecretsRequest { content: string; filename?: string; }
export interface SecretMatch { type: string; value: string; line: number; column: number; redacted: string; }
export interface ScanSecretsResponse { secretsFound: number; secrets: SecretMatch[]; recommendation: string; }
export interface ClawAgentRegistration { name: string; type: "openclaw" | "hermes" | "custom"; publicKey: string; }
