import { describe, it, expect } from "vitest";
import {
  analyzeStructure,
  findImportCycles,
  detectLayerViolations,
  computeModuleCoupling,
  DEFAULT_LAYER_RULES,
} from "../analyzers/structural";
import {
  buildModuleGraph,
  extractImportSpecifiers,
  resolveSpecifier,
} from "../analyzers/import-graph";

function file(path: string, content: string): { path: string; content: string } {
  return { path, content };
}

describe("import-graph extraction + resolution", () => {
  it("extracts static imports, side-effects, re-exports and require with lines", () => {
    const content = [
      'import { a } from "./a";',
      'import "./polyfill";',
      'export { b } from "./b";',
      'const c = require("./c");',
      'const d = await import("./d");',
    ].join("\n");
    const specs = extractImportSpecifiers(content, "js");
    expect(specs.map((s) => s.raw)).toEqual(["./a", "./polyfill", "./b", "./c", "./d"]);
    expect(specs[0].line).toBe(1);
    expect(specs[3].line).toBe(4);
  });

  it("resolves extensionless and index imports", () => {
    const nodes = new Set(["src/a.ts", "src/lib/index.ts"]);
    expect(resolveSpecifier("src/main.ts", "./a", "js", nodes)).toBe("src/a.ts");
    expect(resolveSpecifier("src/main.ts", "./lib", "js", nodes)).toBe("src/lib/index.ts");
    expect(resolveSpecifier("src/main.ts", "react", "js", nodes)).toBeNull();
  });

  it("resolves python relative and absolute imports", () => {
    const nodes = new Set(["pkg/mod.py", "pkg/sub/__init__.py"]);
    expect(resolveSpecifier("pkg/main.py", ".mod", "py", nodes)).toBe("pkg/mod.py");
    expect(resolveSpecifier("pkg/main.py", ".sub", "py", nodes)).toBe("pkg/sub/__init__.py");
    expect(resolveSpecifier("pkg/main.py", "pkg.mod", "py", nodes)).toBe("pkg/mod.py");
  });

  it("builds a deterministic graph with external specifiers separated", () => {
    const graph = buildModuleGraph([
      file("src/b.ts", 'import { a } from "./a";'),
      file("src/a.ts", 'import React from "react";\nexport const a = 1;'),
    ]);
    expect(graph.nodes).toEqual(["src/a.ts", "src/b.ts"]);
    expect(graph.edges.get("src/b.ts")).toEqual(["src/a.ts"]);
    expect(graph.external.get("src/a.ts")).toEqual(["react"]);
  });
});

describe("findImportCycles (strongly-connected components)", () => {
  it("detects a 3-node cycle and reports the participating edges", () => {
    const graph = buildModuleGraph([
      file("src/a.ts", 'import { b } from "./b";\nexport const a = 1;'),
      file("src/b.ts", 'import { c } from "./c";\nexport const b = 1;'),
      file("src/c.ts", 'import { a } from "./a";\nexport const c = 1;'),
      file("src/d.ts", 'import { b } from "./b";\nexport const d = 1;'),
    ]);
    const cycles = findImportCycles(graph);
    expect(cycles).toHaveLength(1);
    expect(cycles[0].modules).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);
    expect(cycles[0].edges).toContain("src/a.ts -> src/b.ts");
    expect(cycles[0].edges).toContain("src/c.ts -> src/a.ts");
  });

  it("detects a self-import as a single-module cycle", () => {
    const graph = buildModuleGraph([file("src/self.ts", 'import { x } from "./self";\nexport const x = 1;')]);
    const cycles = findImportCycles(graph);
    expect(cycles).toHaveLength(1);
    expect(cycles[0].modules).toEqual(["src/self.ts"]);
  });

  it("finds no cycles in a DAG", () => {
    const graph = buildModuleGraph([
      file("src/a.ts", 'import { b } from "./b";'),
      file("src/b.ts", 'import { c } from "./c";'),
      file("src/c.ts", "export const c = 1;"),
    ]);
    expect(findImportCycles(graph)).toEqual([]);
  });
});

describe("detectLayerViolations", () => {
  it("flags api -> db with a real line number", () => {
    const graph = buildModuleGraph([
      file("src/api/users.ts", 'import { db } from "../db/client";\nexport const users = db;'),
      file("src/db/client.ts", "export const db = 1;"),
    ]);
    const violations = detectLayerViolations(graph, DEFAULT_LAYER_RULES);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      type: "layer-violation",
      filePath: "src/api/users.ts",
      line: 1,
      severity: "high",
    });
  });

  it("flags the critical inverted direction db -> api", () => {
    const graph = buildModuleGraph([
      file("src/db/bad.ts", 'import { users } from "../api/users";\nexport const x = users;'),
      file("src/api/users.ts", "export const users = 1;"),
    ]);
    const violations = detectLayerViolations(graph, DEFAULT_LAYER_RULES);
    expect(violations[0].severity).toBe("critical");
  });

  it("honours per-repo rules from reporank.config.json", () => {
    const graph = buildModuleGraph([
      file("reporank.config.json", JSON.stringify({ layerRules: [{ from: "services", disallow: "db", severity: "critical", reason: "no service->db" }] })),
      file("src/services/order.ts", 'import { db } from "../db/client";\nexport const o = db;'),
      file("src/db/client.ts", "export const db = 1;"),
    ]);
    // analyzeStructure loads the config itself.
    const report = analyzeStructure([
      file("reporank.config.json", JSON.stringify({ layerRules: [{ from: "services", disallow: "db", severity: "critical", reason: "no service->db" }] })),
      file("src/services/order.ts", 'import { db } from "../db/client";\nexport const o = db;'),
      file("src/db/client.ts", "export const db = 1;"),
    ]);
    expect(report.layerViolations[0].severity).toBe("critical");
    expect(report.layerViolations[0].detail).toContain("no service->db");
    expect(graph.nodes.length).toBe(3);
  });
});

describe("computeModuleCoupling", () => {
  it("computes Ca, Ce, instability and a directory-local cohesion proxy", () => {
    const files = [
      file("src/lib/a.ts", 'import { b } from "./b";\nimport { c } from "./c";\nimport { x } from "../other/x";'),
      file("src/lib/b.ts", "export const b = 1;"),
      file("src/lib/c.ts", "export const c = 1;"),
      file("src/other/x.ts", "export const x = 1;"),
      file("src/consumer.ts", 'import { a } from "./lib/a";'),
    ];
    const report = analyzeStructure(files);
    const a = report.coupling.find((c) => c.file === "src/lib/a.ts")!;
    expect(a.efferent).toBe(3);
    expect(a.afferent).toBe(1);
    expect(a.instability).toBe(0.75);
    // 2 of 3 imports stay inside src/lib
    expect(a.cohesion).toBeCloseTo(0.667, 2);

    const b = report.coupling.find((c) => c.file === "src/lib/b.ts")!;
    expect(b.afferent).toBe(1);
    expect(b.efferent).toBe(0);
    expect(b.instability).toBe(0);
  });

  it("emits bounded instability/low-cohesion findings", () => {
    const files = [
      file("src/leaf.ts", ['a', 'b', 'c', 'd', 'e'].map((n) => `import { ${n} } from "./other/${n}";`).join("\n")),
      ...["a", "b", "c", "d", "e"].map((n) => file(`src/other/${n}.ts`, `export const ${n} = 1;`)),
    ];
    const report = analyzeStructure(files);
    const types = report.findings.map((f) => f.type);
    expect(types).toContain("high-instability");
    expect(types).toContain("low-cohesion");
  });

  it("returns coupling metrics for every module deterministically", () => {
    const graph = buildModuleGraph([file("src/a.ts", "export const a = 1;")]);
    expect(computeModuleCoupling(graph)).toEqual([
      { file: "src/a.ts", afferent: 0, efferent: 0, instability: 0, cohesion: 1 },
    ]);
  });
});
