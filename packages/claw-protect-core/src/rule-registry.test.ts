import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  LANGUAGE_TO_RULE_PACK,
  GENERIC_PACKS,
  getAllAvailableLanguages,
  getRulesForLanguages,
  mapSemgrepSeverityToWeight,
  applyWeightsToFindings,
} from "./rule-registry";

let mockExecImpl: ((cmd: string, opts: unknown, cb: (err: Error | null, result?: { stdout: string; stderr: string }) => void) => void) | null = null;

vi.mock("node:child_process", () => ({
  exec: (cmd: string, opts: unknown, cb: (err: Error | null, result?: { stdout: string; stderr: string }) => void) => {
    if (mockExecImpl) {
      mockExecImpl(cmd, opts, cb);
    } else {
      cb(null, { stdout: "", stderr: "" });
    }
  },
}));

describe("rule-registry", () => {
  describe("getAllAvailableLanguages", () => {
    it("returns all mapped languages", () => {
      const langs = getAllAvailableLanguages();
      expect(langs.length).toBeGreaterThan(30);
      expect(langs).toContain("typescript");
      expect(langs).toContain("python");
      expect(langs).toContain("java");
      expect(langs).toContain("go");
    });
  });

  describe("getRulesForLanguages", () => {
    it("returns rule packs for a single language", () => {
      const packs = getRulesForLanguages(["typescript"]);
      expect(packs).toContain("p/typescript");
      expect(packs.length).toBeGreaterThan(0);
    });

    it("returns rule packs for multiple languages", () => {
      const packs = getRulesForLanguages(["typescript", "python", "java"]);
      expect(packs).toContain("p/typescript");
      expect(packs).toContain("p/python");
      expect(packs).toContain("p/java");
      expect(packs.length).toBeGreaterThanOrEqual(6); // 3 lang packs + 3 generic
    });

    it("always includes generic security packs", () => {
      const packs = getRulesForLanguages(["typescript"]);
      for (const gp of GENERIC_PACKS) {
        expect(packs).toContain(gp);
      }
    });

    it("returns only generic packs for unknown language", () => {
      const packs = getRulesForLanguages(["somefakelang"]);
      expect(packs.length).toBe(GENERIC_PACKS.length);
      for (const gp of GENERIC_PACKS) {
        expect(packs).toContain(gp);
      }
    });

    it("deduplicates packs when languages share rule packs", () => {
      const packs = getRulesForLanguages(["typescript", "tsx"]);
      const tsCount = packs.filter((p: string) => p === "p/typescript").length;
      expect(tsCount).toBe(1);
    });

    it("maps golang alias to p/golang", () => {
      const packs = getRulesForLanguages(["golang"]);
      expect(packs).toContain("p/golang");
    });

    it("maps dockerfile alias", () => {
      const packs = getRulesForLanguages(["dockerfile"]);
      expect(packs).toContain("p/dockerfile");
      expect(packs).toContain("p/docker");
    });

    it("handles empty languages array", () => {
      const packs = getRulesForLanguages([]);
      expect(packs.length).toBe(GENERIC_PACKS.length);
    });

    it("handles case-insensitive input", () => {
      const packs = getRulesForLanguages(["TypeScript", "PYTHON", "Java"]);
      expect(packs).toContain("p/typescript");
      expect(packs).toContain("p/python");
      expect(packs).toContain("p/java");
    });

    it("handles whitespace in language names", () => {
      const packs = getRulesForLanguages(["  typescript  "]);
      expect(packs).toContain("p/typescript");
    });
  });

  describe("mapSemgrepSeverityToWeight", () => {
    it("maps ERROR to 0.9", () => {
      expect(mapSemgrepSeverityToWeight("ERROR")).toBe(0.9);
      expect(mapSemgrepSeverityToWeight("error")).toBe(0.9);
    });

    it("maps WARNING to 0.6", () => {
      expect(mapSemgrepSeverityToWeight("WARNING")).toBe(0.6);
      expect(mapSemgrepSeverityToWeight("warning")).toBe(0.6);
    });

    it("maps INFO to 0.3", () => {
      expect(mapSemgrepSeverityToWeight("INFO")).toBe(0.3);
      expect(mapSemgrepSeverityToWeight("info")).toBe(0.3);
    });

    it("defaults unknown severities to 0.3", () => {
      expect(mapSemgrepSeverityToWeight("UNKNOWN")).toBe(0.3);
    });
  });

  describe("applyWeightsToFindings", () => {
    it("attaches correct weight to findings", () => {
      const findings = [
        { checkId: "test-1", severity: "ERROR", path: "a.ts", message: "bad" },
        { checkId: "test-2", severity: "WARNING", path: "b.ts", message: "meh" },
        { checkId: "test-3", severity: "INFO", path: "c.ts", message: "ok" },
      ];
      const weighted = applyWeightsToFindings(findings);
      expect(weighted[0].weight).toBe(0.9);
      expect(weighted[1].weight).toBe(0.6);
      expect(weighted[2].weight).toBe(0.3);
    });

    it("preserves original fields", () => {
      const findings = [
        { checkId: "test-1", severity: "ERROR", path: "a.ts", message: "bad" },
      ];
      const weighted = applyWeightsToFindings(findings);
      expect(weighted[0].checkId).toBe("test-1");
      expect(weighted[0].severity).toBe("ERROR");
      expect(weighted[0].path).toBe("a.ts");
    });
  });

  describe("discoverAvailablePacks", () => {
    beforeEach(() => {
      mockExecImpl = null;
    });

    it("returns packs parsed from semgrep dry-run output", async () => {
      mockExecImpl = (_cmd, _opts, cb) => {
        cb(null, { stdout: "│ p/typescript  │  p/python  │  p/secrets  │\n", stderr: "" });
      };
      const { discoverAvailablePacks } = await import("./rule-registry");
      const packs = await discoverAvailablePacks();
      expect(packs).toContain("p/typescript");
      expect(packs).toContain("p/python");
      expect(packs).toContain("p/secrets");
    });

    it("returns empty array on failure", async () => {
      mockExecImpl = (_cmd, _opts, cb) => {
        cb(new Error("semgrep not found"));
      };
      const { discoverAvailablePacks } = await import("./rule-registry");
      const packs = await discoverAvailablePacks();
      expect(packs).toEqual([]);
    });
  });

  describe("LANGUAGE_TO_RULE_PACK coverage", () => {
    const expected = [
      "typescript", "javascript", "python", "java", "go", "rust", "kotlin", "swift",
      "ruby", "php", "c", "cpp", "csharp", "scala", "dart",
      "dockerfile", "terraform", "yaml", "json", "html", "css", "bash", "sql",
    ];

    for (const lang of expected) {
      it(`maps ${lang}`, () => {
        const packs = getRulesForLanguages([lang]);
        expect(packs.length).toBeGreaterThan(GENERIC_PACKS.length);
      });
    }
  });
});
