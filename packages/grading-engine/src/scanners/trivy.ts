import { execSync } from "node:child_process";

export async function runTrivy(repoPath: string) {
  try {
    const output = execSync(`trivy filesystem --format json --quiet --no-progress ${repoPath}`, { encoding: "utf-8", maxBuffer: 10 * 1024 * 1024, timeout: 120000 });
    const result = JSON.parse(output);
    const vulns = [];
    for (const res of result.Results || [])
      for (const v of res.Vulnerabilities || [])
        vulns.push({ vulnId: v.VulnerabilityID, pkgName: v.PkgName, severity: v.Severity, title: v.Title, installedVersion: v.InstalledVersion, fixedVersion: v.FixedVersion });
    return vulns;
  } catch (e: any) {
    if (e.stderr?.includes("not found")) return [];
    console.warn("Trivy:", e.message);
    return [];
  }
}
