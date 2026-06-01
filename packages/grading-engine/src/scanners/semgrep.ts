import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export async function runSemgrep(repoPath: string) {
  try {
    const { stdout } = await execAsync(`semgrep scan --sarif --no-rewrite-rule-ids --quiet`, {
      cwd: repoPath,
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
      timeout: 120000,
    });
    const sarif = JSON.parse(stdout);
    const findings = [];
    for (const run of sarif.runs || [])
      for (const r of run.results || [])
        findings.push({
          checkId: r.ruleId,
          severity: r.properties?.severity || "WARNING",
          path: r.locations?.[0]?.physicalLocation?.artifactLocation?.uri || "",
          message: r.message?.text || "",
        });
    return findings;
  } catch (e: any) {
    if (e.stderr?.includes("not found") || e.message?.includes("not found")) return [];
    if (e.stdout) {
      try {
        const sarif = JSON.parse(e.stdout);
        const findings = [];
        for (const run of sarif.runs || [])
          for (const r of run.results || [])
            findings.push({
              checkId: r.ruleId,
              severity: r.properties?.severity || "WARNING",
              path: r.locations?.[0]?.physicalLocation?.artifactLocation?.uri || "",
              message: r.message?.text || "",
            });
        return findings;
      } catch { /* ignore */ }
    }
    console.warn("Semgrep:", e.message);
    return [];
  }
}
