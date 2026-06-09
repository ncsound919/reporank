import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";

const execFileAsync = promisify(execFile);

export interface SemgrepFinding {
  ruleId: string;
  message: string;
  severity: "info" | "warning" | "error";
  path: string;
  line: number;
  category: "security" | "quality" | "performance" | "maintainability" | "testing";
}

export interface SemgrepResult {
  findings: SemgrepFinding[];
  durationMs: number;
  rulesRun: number;
}

export async function runSemgrep(
  target: string,
  config: string[] = ["auto"],
  timeoutMs = 120_000
): Promise<SemgrepResult> {
  const start = Date.now();
  const absolute = resolve(target);

  try {
    const { stdout } = await execFileAsync(
      "semgrep",
      ["--json", "--config", ...config, "--quiet", "--no-gitignore", absolute],
      { timeout: timeoutMs, maxBuffer: 50 * 1024 * 1024 }
    );
    const data = JSON.parse(stdout);
    const findings: SemgrepFinding[] = (data.results || []).map((r: any) => ({
      ruleId: r.check_id,
      message: r.extra?.message || "",
      severity: r.extra?.severity || "warning",
      path: r.path,
      line: r.start?.line || 0,
      category: mapCategory(r.check_id),
    }));
    return {
      findings,
      durationMs: Date.now() - start,
      rulesRun: data.results?.length || 0,
    };
  } catch (err: any) {
    if (err.code === "ENOENT") {
      throw new Error("Semgrep not found. Install with: pip install semgrep");
    }
    if (err.killed) {
      throw new Error(`Semgrep timed out after ${timeoutMs}ms`);
    }
    throw err;
  }
}

function mapCategory(ruleId: string): SemgrepFinding["category"] {
  if (/security|sqli|xss|crypto|secret/i.test(ruleId)) return "security";
  if (/performance/i.test(ruleId)) return "performance";
  if (/test/i.test(ruleId)) return "testing";
  if (/style|convention|naming/i.test(ruleId)) return "maintainability";
  return "quality";
}
