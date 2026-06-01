import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

export async function runHadolint(repoPath: string) {
  const dockerfilePath = join(repoPath, "Dockerfile");
  if (!existsSync(dockerfilePath)) return { hasDockerfile: false, violations: [], score: 0 };
  try {
    const output = execSync(`hadolint Dockerfile --format json`, { cwd: repoPath, encoding: "utf-8", timeout: 30000 });
    const violations = JSON.parse(output);
    const errors = violations.filter((v: any) => v.severity === "error").length;
    const warnings = violations.filter((v: any) => v.severity === "warning").length;
    return { hasDockerfile: true, violations, score: Math.max(0, 100 - errors * 10 - warnings * 3) };
  } catch { return { hasDockerfile: true, violations: [], score: 50 }; }
}
