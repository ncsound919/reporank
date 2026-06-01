import { exec } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { join } from "node:path";

const execAsync = promisify(exec);

export async function runHadolint(repoPath: string) {
  const dockerfilePath = join(repoPath, "Dockerfile");
  if (!existsSync(dockerfilePath)) return { hasDockerfile: false, violations: [], score: 0 };

  try {
    const { stdout } = await execAsync(`hadolint Dockerfile --format json`, {
      cwd: repoPath, encoding: "utf-8", timeout: 30000,
    });
    const violations = JSON.parse(stdout);
    const errors = violations.filter((v: any) => v.severity === "error").length;
    const warnings = violations.filter((v: any) => v.severity === "warning").length;
    return { hasDockerfile: true, violations, score: Math.max(0, 100 - errors * 10 - warnings * 3) };
  } catch (e: any) {
    if (e.stdout) {
      try {
        const violations = JSON.parse(e.stdout);
        const errors = violations.filter((v: any) => v.severity === "error").length;
        const warnings = violations.filter((v: any) => v.severity === "warning").length;
        return { hasDockerfile: true, violations, score: Math.max(0, 100 - errors * 10 - warnings * 3) };
      } catch { /* ignore */ }
    }
    if (e.message?.includes("not found")) return { hasDockerfile: true, violations: [], score: 50 };
    console.warn("Hadolint:", e.message);
    return { hasDockerfile: true, violations: [], score: 50 };
  }
}
