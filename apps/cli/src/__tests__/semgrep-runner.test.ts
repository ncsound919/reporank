import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:child_process", () => ({ execFile: vi.fn() }));

vi.mock("node:util", () => ({ promisify: (fn: any) => fn }));

import { execFile } from "node:child_process";

describe("semgrep-runner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (execFile as any).mockResolvedValue({
      stdout: JSON.stringify({ results: [
        { check_id: "javascript.lang.security.audit.sqli", extra: { message: "SQL injection", severity: "error" }, path: "test.js", start: { line: 5 } }
      ]})
    });
  });

  it("parses findings correctly", async () => {
    const { runSemgrep } = await import("../scanners/semgrep-runner");
    const result = await runSemgrep("./");
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      ruleId: "javascript.lang.security.audit.sqli",
      severity: "error",
      line: 5,
      category: "security",
    });
  });

  it("throws clear error when semgrep not installed", async () => {
    const { runSemgrep } = await import("../scanners/semgrep-runner");
    (execFile as any).mockRejectedValue({ code: "ENOENT" });
    await expect(runSemgrep("./")).rejects.toThrow("Semgrep not found");
  });

  it("throws clear error on timeout", async () => {
    const { runSemgrep } = await import("../scanners/semgrep-runner");
    (execFile as any).mockRejectedValue({ killed: true });
    await expect(runSemgrep("./", ["auto"], 100)).rejects.toThrow("timed out");
  });
});
