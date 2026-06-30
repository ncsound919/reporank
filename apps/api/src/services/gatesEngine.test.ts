import { evaluateGate } from "./gatesEngine";

describe("evaluateGate", () => {
  it("tests-present passes when testFileCount > 0", () => {
    const result = evaluateGate(
      { type: "tests-present", criterion: "", milestoneId: null },
      { quality: { testFileCount: 3, testFramework: "vitest" } },
      {}
    );
    expect(result.passed).toBe(true);
    expect(result.evidence).toContain("3 test files found");
  });

  it("tests-present fails when testFileCount = 0", () => {
    const result = evaluateGate(
      { type: "tests-present", criterion: "", milestoneId: null },
      { quality: { testFileCount: 0, testFramework: null } },
      {}
    );
    expect(result.passed).toBe(false);
    expect(result.evidence).toContain("No test files found");
  });

  it("code-present passes when sourceFiles > 0", () => {
    const result = evaluateGate(
      { type: "code-present", criterion: "", milestoneId: null },
      { quality: { testFileCount: 0 } },
      { sourceFiles: [{ path: "src/index.ts", content: "process.stdout.write('hello');" }] }
    );
    expect(result.passed).toBe(true);
  });

  it("code-present fails when sourceFiles = 0", () => {
    const result = evaluateGate(
      { type: "code-present", criterion: "", milestoneId: null },
      { quality: { testFileCount: 0 } },
      { sourceFiles: [] }
    );
    expect(result.passed).toBe(false);
  });

  it("docs-updated passes when README exists", () => {
    const result = evaluateGate(
      { type: "docs-updated", criterion: "", milestoneId: null },
      {},
      { sourceFiles: [{ path: "README.md", content: "# My Project" }] }
    );
    expect(result.passed).toBe(true);
  });

  it("docs-updated fails when no README", () => {
    const result = evaluateGate(
      { type: "docs-updated", criterion: "", milestoneId: null },
      {},
      { sourceFiles: [{ path: "src/index.ts", content: "process.stdout.write('hello');" }] }
    );
    expect(result.passed).toBe(false);
  });

  it("deploy-preview passes when Dockerfile or CI exists", () => {
    const result = evaluateGate(
      { type: "deploy-preview", criterion: "", milestoneId: null },
      {},
      { sourceFiles: [
        { path: "Dockerfile", content: "FROM node:18" },
        { path: "src/index.ts", content: "process.stdout.write('hello');" }
      ] }
    );
    expect(result.passed).toBe(true);
  });

  it("deploy-preview passes when CI config exists", () => {
    const result = evaluateGate(
      { type: "deploy-preview", criterion: "", milestoneId: null },
      {},
      { sourceFiles: [
        { path: ".github/workflows/ci.yml", content: "name: CI" },
        { path: "src/index.ts", content: "process.stdout.write('hello');" }
      ] }
    );
    expect(result.passed).toBe(true);
  });

  it("deploy-preview fails when no Dockerfile or CI", () => {
    const result = evaluateGate(
      { type: "deploy-preview", criterion: "", milestoneId: null },
      {},
      { sourceFiles: [{ path: "src/index.ts", content: "process.stdout.write('hello');" }] }
    );
    expect(result.passed).toBe(false);
  });

  it("security gate passes when no critical/high secrets", () => {
    const result = evaluateGate(
      { type: "security", criterion: "", milestoneId: null },
      { security: { highestSeverity: "medium" } },
      { secrets: { secretsFound: 1 } }
    );
    expect(result.passed).toBe(true);
  });

  it("security gate fails when critical secrets found", () => {
    const result = evaluateGate(
      { type: "security", criterion: "", milestoneId: null },
      { security: { highestSeverity: "critical" } },
      { secrets: { secretsFound: 2 } }
    );
    expect(result.passed).toBe(false);
  });

  it("security gate fails when high severity secrets found", () => {
    const result = evaluateGate(
      { type: "security", criterion: "", milestoneId: null },
      { security: { highestSeverity: "high" } },
      { secrets: { secretsFound: 1 } }
    );
    expect(result.passed).toBe(false);
  });
});