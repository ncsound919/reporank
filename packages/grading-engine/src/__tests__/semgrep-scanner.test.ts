import { describe, it, expect } from "vitest";
import {
  buildConfigFlags,
  mapSemgrepSeverityToWeight,
  LANGUAGE_PACK_MAP,
  GENERIC_SECURITY_PACKS,
} from "../scanners/semgrep";

describe("semgrep scanner", () => {
  describe("buildConfigFlags", () => {
    it("returns auto when no languages provided", () => {
      const flags = buildConfigFlags();
      expect(flags).toContain("auto");
    });

    it("builds config flags for typescript", () => {
      const flags = buildConfigFlags(["typescript"]);
      expect(flags).toContain('--config "p/typescript"');
      expect(flags).toContain('--config "p/secrets"');
    });

    it("builds config flags for multiple languages", () => {
      const flags = buildConfigFlags(["typescript", "python"]);
      expect(flags).toContain('--config "p/typescript"');
      expect(flags).toContain('--config "p/python"');
    });

    it("includes generic security packs", () => {
      const flags = buildConfigFlags(["typescript"]);
      for (const pack of GENERIC_SECURITY_PACKS) {
        expect(flags).toContain(`--config "${pack}"`);
      }
    });

    it("deduplicates packs when languages alias", () => {
      const flags = buildConfigFlags(["typescript", "tsx"]);
      const tsCount = (flags.match(/p\/typescript/g) || []).length;
      expect(tsCount).toBe(1);
    });

    it("handles empty languages array", () => {
      const flags = buildConfigFlags([]);
      expect(flags).toContain("auto");
      expect(flags).toContain('--config "p/secrets"');
    });
  });

  describe("mapSemgrepSeverityToWeight", () => {
    it("ERROR = 0.9", () => expect(mapSemgrepSeverityToWeight("ERROR")).toBe(0.9));
    it("WARNING = 0.6", () => expect(mapSemgrepSeverityToWeight("WARNING")).toBe(0.6));
    it("INFO = 0.3", () => expect(mapSemgrepSeverityToWeight("INFO")).toBe(0.3));
    it("lowercase works", () => expect(mapSemgrepSeverityToWeight("error")).toBe(0.9));
    it("unknown defaults to 0.3", () => expect(mapSemgrepSeverityToWeight("CRITICAL")).toBe(0.3));
  });

  describe("LANGUAGE_PACK_MAP", () => {
    it("maps common languages", () => {
      expect(LANGUAGE_PACK_MAP["typescript"]).toContain("p/typescript");
      expect(LANGUAGE_PACK_MAP["python"]).toContain("p/python");
      expect(LANGUAGE_PACK_MAP["go"]).toContain("p/golang");
      expect(LANGUAGE_PACK_MAP["rust"]).toContain("p/rust");
    });

    it("maps dockerfile with multiple packs", () => {
      expect(LANGUAGE_PACK_MAP["dockerfile"].length).toBe(2);
      expect(LANGUAGE_PACK_MAP["dockerfile"]).toContain("p/dockerfile");
      expect(LANGUAGE_PACK_MAP["dockerfile"]).toContain("p/docker");
    });
  });
});
