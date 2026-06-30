import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export interface SemgrepFinding {
  checkId: string;
  severity: string;
  path: string;
  message: string;
  weight: number;
}

/**
 * Map Semgrep severity levels to RepoRank weights.
 * ERROR=0.9, WARNING=0.6, INFO=0.3
 */
export function mapSemgrepSeverityToWeight(severity: string): number {
  const s = severity.toUpperCase();
  if (s === "ERROR") return 0.9;
  if (s === "WARNING") return 0.6;
  if (s === "INFO") return 0.3;
  return 0.3;
}

function parseSarifFindings(stdout: string): SemgrepFinding[] {
  const sarif = JSON.parse(stdout);
  const findings: SemgrepFinding[] = [];
  for (const run of sarif.runs || [])
    for (const r of run.results || []) {
      const severity = r.properties?.severity || r.level || "WARNING";
      findings.push({
        checkId: r.ruleId,
        severity: severity.toUpperCase(),
        path: r.locations?.[0]?.physicalLocation?.artifactLocation?.uri || "",
        message: r.message?.text || "",
        weight: mapSemgrepSeverityToWeight(severity),
      });
    }
  return findings;
}

export async function runSemgrep(repoPath: string, languages?: string[]) {
  try {
    const configs = buildConfigFlags(languages);
    const { stdout } = await execAsync(`semgrep scan --sarif --no-rewrite-rule-ids --quiet ${configs}`, {
      cwd: repoPath,
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
      timeout: 120000,
    });
    return parseSarifFindings(stdout);
  } catch (e: any) {
    if (e.stderr?.includes("not found") || e.message?.includes("not found")) return [];
    if (e.stdout) {
      try {
        return parseSarifFindings(e.stdout);
      } catch { /* ignore */ }
    }
    console.warn("Semgrep:", e.message);
    return [];
  }
}

/** Build --config flags for language-specific rule packs. */
export function buildConfigFlags(languages?: string[]): string {
  const packs = new Set<string>();

  if (languages && languages.length > 0) {
    for (const lang of languages) {
      const normalized = lang.toLowerCase().trim();
      const packsForLang = LANGUAGE_PACK_MAP[normalized];
      if (packsForLang) {
        for (const p of packsForLang) packs.add(p);
      }
    }
  }

  if (packs.size === 0) {
    packs.add("auto");
  }

  for (const p of GENERIC_SECURITY_PACKS) packs.add(p);

  return [...packs].map((p) => `--config "${p}"`).join(" ");
}

export const LANGUAGE_PACK_MAP: Record<string, string[]> = {
  typescript: ["p/typescript"], tsx: ["p/typescript"],
  javascript: ["p/javascript"], jsx: ["p/javascript"],
  python: ["p/python"], java: ["p/java"], kotlin: ["p/kotlin"],
  go: ["p/golang"], golang: ["p/golang"], ruby: ["p/ruby"],
  php: ["p/php"], c: ["p/c"], cpp: ["p/cpp"], "c++": ["p/cpp"],
  csharp: ["p/csharp"], "c#": ["p/csharp"], rust: ["p/rust"],
  swift: ["p/swift"], scala: ["p/scala"], lua: ["p/lua"],
  elixir: ["p/elixir"], clojure: ["p/clojure"], haskell: ["p/haskell"],
  ocaml: ["p/ocaml"], dart: ["p/dart"],
  dockerfile: ["p/dockerfile", "p/docker"], docker: ["p/dockerfile", "p/docker"],
  terraform: ["p/terraform"], hcl: ["p/terraform"],
  yaml: ["p/yaml"], yml: ["p/yaml"], json: ["p/json"],
  html: ["p/html"], css: ["p/css"], scss: ["p/scss"],
  bash: ["p/bash"], shell: ["p/bash"], sql: ["p/sql"],
  r: ["p/r"], apex: ["p/apex"], solidity: ["p/solidity"],
};

export const GENERIC_SECURITY_PACKS = ["p/secrets", "p/owasp-top-ten", "p/security-audit"];

