import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");

describe("Build Pipeline Security — RepoRank", () => {
  it("package.json exists and is valid JSON", () => {
    const pkg = JSON.parse(
      readFileSync(join(PROJECT_ROOT, "package.json"), "utf8")
    );
    expect(pkg.name).toBeTruthy();
  });

  it("lockfile integrity: pnpm-lock.yaml exists and non-empty", () => {
    const lockPath = join(PROJECT_ROOT, "pnpm-lock.yaml");
    expect(existsSync(lockPath)).toBe(true);
    const lockStat = statSync(lockPath);
    expect(lockStat.size).toBeGreaterThan(0);
  });

  it("pnpm-workspace.yaml exists", () => {
    const wsPath = join(PROJECT_ROOT, "pnpm-workspace.yaml");
    expect(existsSync(wsPath)).toBe(true);
    const wsContent = readFileSync(wsPath, "utf8");
    expect(wsContent).toContain("packages:");
  });

  it("Dockerfile uses pinned base image digests", () => {
    const dockerfile = readFileSync(join(PROJECT_ROOT, "Dockerfile"), "utf8");
    expect(dockerfile).toContain("@sha256:");
  });

  it("Dockerfile uses non-root USER", () => {
    const dockerfile = readFileSync(join(PROJECT_ROOT, "Dockerfile"), "utf8");
    expect(dockerfile).toMatch(/^USER\s+(?!root)/m);
  });

  it("CI workflow includes security scan steps", () => {
    const ciYaml = readFileSync(
      join(PROJECT_ROOT, ".github", "workflows", "ci.yml"),
      "utf8"
    );
    expect(ciYaml).toMatch(/audit|security/i);
  });

  it("security-scan.yml workflow exists and has required jobs", () => {
    const secYaml = readFileSync(
      join(PROJECT_ROOT, ".github", "workflows", "security-scan.yml"),
      "utf8"
    );
    expect(secYaml).toContain("sbom");
    expect(secYaml).toContain("codeql");
    expect(secYaml).toContain("audit");
    expect(secYaml).toContain("license-check");
  });

  it("benchmark workflow exists", () => {
    const benchPath = join(
      PROJECT_ROOT,
      ".github",
      "workflows",
      "benchmark.yml"
    );
    expect(existsSync(benchPath)).toBe(true);
  });

  it("dependabot.yml is configured", () => {
    const depPath = join(PROJECT_ROOT, ".github", "dependabot.yml");
    expect(existsSync(depPath)).toBe(true);
    const depYaml = readFileSync(depPath, "utf8");
    expect(depYaml).toContain("npm");
    expect(depYaml).toContain("weekly");
  });

  it("CODEOWNERS file exists", () => {
    const ownersPath = join(PROJECT_ROOT, ".github", "CODEOWNERS");
    expect(existsSync(ownersPath)).toBe(true);
  });
});
