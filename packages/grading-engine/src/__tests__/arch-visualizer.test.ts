import { describe, it, expect, vi } from "vitest";
import { generateArchitectureDiagram } from "../analyzers/arch-visualizer";

describe("generateArchitectureDiagram", () => {
  it("returns empty diagram for no files", () => {
    const result = generateArchitectureDiagram([]);
    expect(result.moduleCount).toBe(0);
    expect(result.mermaidCode).toContain("No source files");
  });

  it("generates mermaid graph for valid files", () => {
    const files = [
      { path: "src/routes/users.ts", content: 'import { db } from "../db/client";\nexport const getUsers = () => db.find();' },
      { path: "src/db/client.ts", content: 'import { PrismaClient } from "@prisma/client";\nexport const prisma = new PrismaClient();' },
    ];
    const result = generateArchitectureDiagram(files);
    expect(result.mermaidCode).toContain("graph LR");
    expect(result.moduleCount).toBeGreaterThanOrEqual(1);
  });

  it("counts dependencies", () => {
    const files = [
      { path: "src/routes/users.ts", content: 'import { getDb } from "../db";' },
      { path: "src/db/index.ts", content: 'export const getDb = () => {};' },
    ];
    const result = generateArchitectureDiagram(files);
    expect(typeof result.dependencyCount).toBe("number");
  });

  it("returns summary", () => {
    const files = [
      { path: "src/routes/users.ts", content: 'import { getDb } from "../db";' },
      { path: "src/db/index.ts", content: 'export const getDb = () => {};' },
    ];
    const result = generateArchitectureDiagram(files);
    expect(typeof result.summary).toBe("string");
    expect(result.summary.length).toBeGreaterThan(0);
  });

  it("handles null entries gracefully", () => {
    const files: any[] = [null, undefined, { path: "test.ts", content: "const x = 1;" }];
    const result = generateArchitectureDiagram(files);
    expect(result.moduleCount).toBeGreaterThanOrEqual(0);
  });

  it("generates color-coded nodes for different module types", () => {
    const files = [
      { path: "src/routes/api.ts", content: "export const x = 1;" },
      { path: "src/components/Button.tsx", content: "export const Button = () => null;" },
      { path: "src/db/models.ts", content: "export const x = 1;" },
    ];
    const result = generateArchitectureDiagram(files);
    expect(result.mermaidCode).toContain(":::api");
    expect(result.mermaidCode).toContain(":::ui");
    expect(result.mermaidCode).toContain(":::data");
  });
});
