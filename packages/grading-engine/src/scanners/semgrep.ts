import { execSync } from "node:child_process";

export async function runSemgrep(repoPath: string) {
  try {
    const output = execSync(`semgrep scan --sarif --no-rewrite-rule-ids --quiet`, { cwd: repoPath, encoding: "utf-8", maxBuffer: 10 * 1024 * 1024, timeout: 120000 });
    const sarif = JSON.parse(output);
    const findings = [];
    for (const run of sarif.runs || [])
      for (const r of run.results || [])
        findings.push({ checkId: r.ruleId, severity: r.properties?.severity || "WARNING", path: r.locations?.[0]?.physicalLocation?.artifactLocation?.uri || "", message: r.message?.text || "" });
    return findings;
  } catch (e: any) {
    if (e.stderr?.includes("not found")) return [];
    console.warn("Semgrep:", e.message);
    return [];
  }
}
