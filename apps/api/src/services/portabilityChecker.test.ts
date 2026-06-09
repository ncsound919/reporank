import { checkPortability } from "./portabilityChecker";

describe("checkPortability", () => {
  it("passes when .env.example present and no hardcoded secrets", () => {
    const result = checkPortability(
      [".env.example", "Dockerfile", ".gitignore", "package.json"],
      [{ path: "src/index.ts", content: "const x = 1;" }]
    );
    expect(result.secretsExternalized).toBe(true);
    expect(result.deployReproducible).toBe(true);
  });

  it("flags hardcoded api_key", () => {
    const result = checkPortability(
      [".env.example"],
      [{ path: "src/config.ts", content: `const api_key = "sk-abcdefghij";` }]
    );
    expect(result.secretsExternalized).toBe(false);
    const secretsIssue = result.issues.find(i => i.check === "Secrets externalized");
    expect(secretsIssue).toBeDefined();
    expect(secretsIssue?.severity).toBe("critical");
  });

  it("flags hardcoded secret with different format", () => {
    const result = checkPortability(
      [".env.example"],
      [{ path: "src/auth.ts", content: `const SECRET_KEY = 'super-secret-key-12345';` }]
    );
    expect(result.secretsExternalized).toBe(false);
    const secretsIssue = result.issues.find(i => i.check === "Secrets externalized");
    expect(secretsIssue).toBeDefined();
    expect(secretsIssue?.severity).toBe("critical");
  });

  it("flags committed node_modules", () => {
    const result = checkPortability(
      [".env.example", ".gitignore", "node_modules/express/index.js"],
      []
    );
    expect(result.gitHistoryUsable).toBe(false);
    const gitIssue = result.issues.find(i => i.check === "Git history usable");
    expect(gitIssue).toBeDefined();
    expect(gitIssue?.severity).toBe("critical");
  });

  it("passes deploy reproducible with Dockerfile", () => {
    const result = checkPortability(
      [".env.example", "Dockerfile"],
      [{ path: "src/index.ts", content: "const x = 1;" }]
    );
    expect(result.deployReproducible).toBe(true);
  });

  it("passes deploy reproducible with CI config", () => {
    const result = checkPortability(
      [".env.example", ".github/workflows/ci.yml"],
      [{ path: "src/index.ts", content: "const x = 1;" }]
    );
    expect(result.deployReproducible).toBe(true);
  });

  it("fails deploy reproducible with neither Dockerfile nor CI", () => {
    const result = checkPortability(
      [".env.example"],
      [{ path: "src/index.ts", content: "const x = 1;" }]
    );
    expect(result.deployReproducible).toBe(false);
  });

  it("passes migrations check when no ORM present", () => {
    const result = checkPortability(
      [".env.example"],
      [{ path: "src/index.ts", content: "const x = 1;" }]
    );
    expect(result.hasMigrations).toBe(true);
  });

  it("fails migrations check when ORM present but no migrations", () => {
    const result = checkPortability(
      [".env.example", "schema.prisma"],
      [{ path: "src/index.ts", content: "const x = 1;" }]
    );
    expect(result.hasMigrations).toBe(false);
    const migrationIssue = result.issues.find(i => i.check === "Database migrations present");
    expect(migrationIssue).toBeDefined();
    expect(migrationIssue?.severity).toBe("critical");
  });

  it("passes migrations check when ORM and migrations present", () => {
    const result = checkPortability(
      [".env.example", "schema.prisma", "prisma/migrations/001_init.sql"],
      [{ path: "src/index.ts", content: "const x = 1;" }]
    );
    expect(result.hasMigrations).toBe(true);
  });
});