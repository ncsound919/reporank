import { describe, it, expect } from "vitest";
import { detectInvisibleBugs } from "../analyzers/invisible-bugs";

describe("detectInvisibleBugs", () => {
  it("returns empty for empty source files", () => {
    const result = detectInvisibleBugs([]);
    expect(result.findings).toEqual([]);
    expect(result.highConfidence).toEqual([]);
  });

  it("detects non-null assertions", () => {
    const files = [{ path: "test.ts", content: "const name = user.name!;" }];
    const result = detectInvisibleBugs(files);
    expect(result.findings.some(f => f.category === "non-null-crash")).toBe(true);
  });

  it("detects type casts", () => {
    const files = [{ path: "test.ts", content: "const data = response as UserType;" }];
    const result = detectInvisibleBugs(files);
    expect(result.findings.some(f => f.category === "non-null-crash")).toBe(true);
  });

  it("detects side effects at module top level", () => {
    const files = [{ path: "service.ts", content: "setInterval(() => {}, 1000);\nexport const x = 1;" }];
    const result = detectInvisibleBugs(files);
    expect(result.findings.some(f => f.category === "side-effect-ordering")).toBe(true);
  });

  it("detects error handler blind spots", () => {
    const files = [{ path: "test.ts", content: "try { await fetch(url); } catch (err) { console.error(err); }" }];
    const result = detectInvisibleBugs(files);
    expect(result.findings.some(f => f.category === "error-blindspot")).toBe(true);
  });

  it("detects timing bombs (short setTimeout)", () => {
    const files = [{ path: "test.ts", content: "setTimeout(() => resolve(), 50);" }];
    const result = detectInvisibleBugs(files);
    expect(result.findings.some(f => f.category === "timing-bomb")).toBe(true);
  });

  it("detects unbounded push calls", () => {
    const files = [{ path: "collector.ts", content: "function add(item: any) {\n  items.push(item);\n  items.push(item);\n  items.push(item);\n  items.push(item);\n}" }];
    const result = detectInvisibleBugs(files);
    expect(result.findings.some(f => f.category === "memory-leak")).toBe(true);
  });

  it("detects missing .off() listeners", () => {
    const files = [{ path: "test.ts", content: "emitter.on('data', handler);" }];
    const result = detectInvisibleBugs(files);
    expect(result.findings.some(f => f.category === "memory-leak")).toBe(true);
  });

  it("detects data corruption via mutations", () => {
    const files = [{ path: "test.ts", content: "function process(config: any) {\n  config.timeout = 5000;\n  config.retries = 3;\n  config.url = 'https://example.com';\n  config.port = 8080;\n}" }];
    const result = detectInvisibleBugs(files);
    expect(result.findings.some(f => f.category === "data-corruption")).toBe(true);
  });

  it("includes reproduction scenarios", () => {
    const files = [{ path: "test.ts", content: "const name = user.name!;" }];
    const result = detectInvisibleBugs(files);
    for (const f of result.findings) {
      expect(typeof f.reproductionScenario).toBe("string");
      expect(f.reproductionScenario.length).toBeGreaterThan(10);
    }
  });

  it("includes senior notes", () => {
    const files = [{ path: "test.ts", content: "const name = user.name!;" }];
    const result = detectInvisibleBugs(files);
    for (const f of result.findings) {
      expect(typeof f.seniorNote).toBe("string");
      expect(f.seniorNote.length).toBeGreaterThan(10);
    }
  });

  it("assigns confidence scores", () => {
    const files = [{ path: "test.ts", content: "const name = user.name!;" }];
    const result = detectInvisibleBugs(files);
    for (const f of result.findings) {
      expect(f.confidence).toBeGreaterThanOrEqual(0);
      expect(f.confidence).toBeLessThanOrEqual(100);
    }
  });

  it("handles files without content", () => {
    const files = [{ path: "empty.ts", content: "" }];
    const result = detectInvisibleBugs(files);
    expect(Array.isArray(result.findings)).toBe(true);
  });

  it("catches this pattern: parameter reassignment", () => {
    const files = [{ path: "test.ts", content: "function update(obj: any, val: string) {\n  obj = val;\n  return obj;\n}" }];
    const result = detectInvisibleBugs(files);
    expect(result.findings.some(f => f.category === "implicit-coupling")).toBe(true);
  });

  it("returns summary", () => {
    const files = [{ path: "test.ts", content: "const name = user.name!;" }];
    const result = detectInvisibleBugs(files);
    expect(typeof result.summary).toBe("string");
    expect(result.summary).toContain("invisible bugs");
  });
});
