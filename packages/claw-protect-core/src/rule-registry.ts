/**
 * Semgrep Rule Registry — maps languages to Semgrep community rule packs (2K+ rules).
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";

export const LANGUAGE_TO_RULE_PACK: Record<string, string[]> = {
  typescript: ["p/typescript"],
  tsx: ["p/typescript"],
  javascript: ["p/javascript"],
  jsx: ["p/javascript"],
  python: ["p/python"],
  java: ["p/java"],
  kotlin: ["p/kotlin"],
  go: ["p/golang"],
  golang: ["p/golang"],
  ruby: ["p/ruby"],
  php: ["p/php"],
  c: ["p/c"],
  cpp: ["p/cpp"],
  "c++": ["p/cpp"],
  csharp: ["p/csharp"],
  "c#": ["p/csharp"],
  rust: ["p/rust"],
  swift: ["p/swift"],
  scala: ["p/scala"],
  lua: ["p/lua"],
  elixir: ["p/elixir"],
  clojure: ["p/clojure"],
  haskell: ["p/haskell"],
  ocaml: ["p/ocaml"],
  dart: ["p/dart"],
  dockerfile: ["p/dockerfile", "p/docker"],
  docker: ["p/dockerfile", "p/docker"],
  terraform: ["p/terraform"],
  hcl: ["p/terraform"],
  yaml: ["p/yaml"],
  yml: ["p/yaml"],
  json: ["p/json"],
  html: ["p/html"],
  css: ["p/css"],
  scss: ["p/scss"],
  bash: ["p/bash"],
  shell: ["p/bash"],
  sql: ["p/sql"],
  r: ["p/r"],
  apex: ["p/apex"],
  solidity: ["p/solidity"],
};

export const GENERIC_PACKS = ["p/secrets", "p/owasp-top-ten", "p/generic", "p/security-audit"];

export function getAllAvailableLanguages(): string[] {
  return Object.keys(LANGUAGE_TO_RULE_PACK);
}

export function getRulesForLanguages(langs: string[]): string[] {
  const packs = new Set<string>();

  for (const lang of langs) {
    const normalized = lang.toLowerCase().trim();
    const matched = LANGUAGE_TO_RULE_PACK[normalized];
    if (matched) {
      for (const p of matched) packs.add(p);
    }
  }

  for (const p of GENERIC_PACKS) packs.add(p);

  return [...packs];
}

export function mapSemgrepSeverityToWeight(severity: string): number {
  const s = severity.toUpperCase();
  if (s === "ERROR") return 0.9;
  if (s === "WARNING") return 0.6;
  if (s === "INFO") return 0.3;
  return 0.3;
}

/**
 * Discover which semgrep rule packs are actually available by running a dry-run scan.
 */

const execAsync = promisify(exec);

export async function discoverAvailablePacks(): Promise<string[]> {
  try {
    const { stdout } = await execAsync("semgrep --config auto --dryrun .", {
      encoding: "utf-8",
      maxBuffer: 5 * 1024 * 1024,
      timeout: 30000,
    });
    const packs = new Set<string>();
    const matches = stdout.matchAll(/p\/([\w-]+)/g);
    for (const m of matches) {
      packs.add(m[0]);
    }
    return [...packs];
  } catch (err) {
    console.warn("Failed to discover available semgrep packs:", (err as Error).message);
    return [];
  }
}

export interface SemgrepFinding {
  checkId: string;
  severity: string;
  path: string;
  message: string;
  weight: number;
}

export function applyWeightsToFindings(
  findings: { checkId: string; severity: string; path: string; message: string }[]
): SemgrepFinding[] {
  return findings.map((f) => ({
    ...f,
    weight: mapSemgrepSeverityToWeight(f.severity),
  }));
}
