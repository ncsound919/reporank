export interface ArchitectureFinding {
  type: "orphan" | "misplaced" | "layer-violation" | "circular-dependency" | "missing-module" | "inconsistent-pattern";
  filePath: string;
  severity: "critical" | "high" | "medium" | "low";
  detail: string;
}

export interface ArchitectureReport {
  findings: ArchitectureFinding[];
  directoryBreakdown: { dir: string; fileCount: number; description: string }[];
  recommendedStructure: string;
  summary: string;
}

// Standard project archetypes and their expected directory structures
const ARCHETYPES: Record<string, { dirs: string[]; description: string }> = {
  "react-app": {
    dirs: ["src/components", "src/pages", "src/hooks", "src/contexts", "src/lib", "src/types", "public"],
    description: "React SPA with component-based architecture",
  },
  "express-api": {
    dirs: ["src/routes", "src/middleware", "src/services", "src/db", "src/config", "src/types", "src/utils"],
    description: "Express REST API with layered architecture",
  },
  "next-app": {
    dirs: ["app", "components", "lib", "public", "styles", "types"],
    description: "Next.js full-stack app with file-based routing",
  },
  "npm-package": {
    dirs: ["src", "dist", "tests", "examples"],
    description: "npm library package",
  },
  "agent-sdk": {
    dirs: ["src/modules", "src/types", "src/utils", "tests"],
    description: "Agent SDK with modular security modules",
  },
  "generic": {
    dirs: ["src", "tests", "docs", "scripts"],
    description: "Generic project",
  },
};

export function analyzeArchitecture(
  fileTree: string[],
  sourceFiles: { path: string; content: string }[]
): ArchitectureReport {
  const findings: ArchitectureFinding[] = [];
  const dirs = new Map<string, number>();

  // Build directory map
  for (const f of fileTree) {
    const parts = f.replace(/\\/g, "/").split("/");
    for (let i = 1; i <= parts.length - 1; i++) {
      const dir = parts.slice(0, i).join("/");
      dirs.set(dir, (dirs.get(dir) || 0) + 1);
    }
  }

  const dirCounts = [...dirs.entries()].sort((a, b) => b[1] - a[1]);

  // Detect archetype
  const detectedArchetype = detectArchetype(fileTree, dirs);
  const archetype = ARCHETYPES[detectedArchetype] || ARCHETYPES.generic;

  // Check for expected directories
  for (const expectedDir of archetype.dirs) {
    if (expectedDir.endsWith("/")) continue;
    if (![...dirs.keys()].some(d => d.startsWith(expectedDir) || d === expectedDir)) {
      findings.push({
        type: "missing-module", filePath: expectedDir,
        severity: "medium",
        detail: `Expected directory "${expectedDir}" not found (${archetype.description})`,
      });
    }
  }

  // Find orphaned files (files with no imports from other files)
  const importGraph = buildImportGraph(sourceFiles);
  const allImportedFiles = new Set<string>();
  for (const [, imports] of importGraph) {
    for (const imp of imports) allImportedFiles.add(imp);
  }

  for (const [file, imports] of importGraph) {
    if (imports.length === 0 && !file.includes("index.")) {
      const isEntryPoint = ["index.ts", "index.tsx", "main.tsx", "app.ts", "server.ts"].some(e => file.endsWith(e));
      if (!isEntryPoint) {
        const isImportedByOther = [...importGraph.entries()].some(([_, imps]) => imps.includes(file));
        if (!isImportedByOther) {
          findings.push({
            type: "orphan", filePath: file, severity: "low",
            detail: "File is not imported by any other source file — possibly dead code",
          });
        }
      }
    }
  }

  // Layer violation detection (e.g., importing from db/ in components/)
  for (const [file, imports] of importGraph) {
    const fileDir = file.split("/").slice(0, -1).join("/");

    for (const imp of imports) {
      // Component importing database
      if ((fileDir.includes("components") || fileDir.includes("pages")) && (imp.includes("db/") || imp.includes("database"))) {
        findings.push({
          type: "layer-violation", filePath: file, severity: "high",
          detail: `UI layer (${fileDir}) directly imports data layer (${imp}) — should go through service/api layer`,
        });
      }

      // Route importing from components (should be the other way)
      if (fileDir.includes("routes") && imp.includes("components") && !imp.includes("layouts")) {
        findings.push({
          type: "layer-violation", filePath: file, severity: "medium",
          detail: `Route handler imports from components/ — consider moving shared logic to services/`,
        });
      }
    }
  }

  // Inconsistent pattern detection
  const namingConventions = new Map<string, string[]>();
  for (const f of sourceFiles) {
    const name = f.path.split("/").pop() || "";
    const dir = f.path.split("/").slice(0, -1).join("/");
    if (!namingConventions.has(dir)) namingConventions.set(dir, []);
    namingConventions.get(dir)!.push(name);
  }

  for (const [dir, names] of namingConventions) {
    const conventions = names.map(n => {
      if (n.includes("-")) return "kebab-case";
      if (n.includes("_")) return "snake_case";
      if (/^[a-z]/.test(n) && /[A-Z]/.test(n)) return "camelCase";
      if (/^[A-Z]/.test(n)) return "PascalCase";
      return "other";
    });
    const unique = [...new Set(conventions)];
    if (unique.length > 1 && names.length > 3) {
      findings.push({
        type: "inconsistent-pattern", filePath: dir, severity: "low",
        detail: `Mixed naming conventions in ${dir}: ${unique.join(", ")}`,
      });
    }
  }

  // Directory breakdown
  const directoryBreakdown = dirCounts.slice(0, 10).map(([dir, count]) => ({
    dir, fileCount: count,
    description: classifyDirectory(dir),
  }));

  return {
    findings,
    directoryBreakdown,
    recommendedStructure: archetype.dirs.join(", "),
    summary: `Detected archetype: ${detectedArchetype}. ${findings.length} structural issues found. ${dirs.size} directories across ${fileTree.length} files.`,
  };
}

function detectArchetype(files: string[], dirs: Map<string, number>): string {
  const allFiles = files.join(" ");
  if (allFiles.includes("src/components/") && allFiles.includes("src/pages/")) return "react-app";
  if (allFiles.includes("src/routes/") && allFiles.includes("src/middleware/")) return "express-api";
  if (allFiles.includes("app/") && allFiles.includes("next.config")) return "next-app";
  if (allFiles.includes("src/modules/") && dirs.has("src/modules")) return "agent-sdk";
  if (dirs.has("dist")) return "npm-package";
  return "generic";
}

function buildImportGraph(files: { path: string; content: string }[]): Map<string, string[]> {
  const graph = new Map<string, string[]>();

  for (const file of files) {
    const imports: string[] = [];
    for (const match of file.content.matchAll(/(?:from|require)\s*\(?\s*["']([^"']+)["']/g)) {
      const imp = match[1];
      if (imp.startsWith(".")) {
        const dir = file.path.split("/").slice(0, -1).join("/");
        const resolved = resolveRelativePath(dir, imp);
        if (resolved) imports.push(resolved);
      } else {
        imports.push(imp);
      }
    }
    graph.set(file.path, imports);
  }

  return graph;
}

function resolveRelativePath(dir: string, relativePath: string): string | null {
  if (!relativePath.startsWith(".")) return null;
  const parts = dir.split("/");
  const relative = relativePath.split("/");

  for (const p of relative) {
    if (p === "..") parts.pop();
    else if (p !== ".") parts.push(p);
  }

  return parts.join("/");
}

function classifyDirectory(dir: string): string {
  if (dir.includes("components")) return "UI components";
  if (dir.includes("routes")) return "API route handlers";
  if (dir.includes("middleware")) return "Express middleware";
  if (dir.includes("services")) return "Business logic services";
  if (dir.includes("db") || dir.includes("database")) return "Database access layer";
  if (dir.includes("hooks")) return "React hooks";
  if (dir.includes("contexts") || dir.includes("context")) return "React context providers";
  if (dir.includes("lib") || dir.includes("utils")) return "Utility/helper functions";
  if (dir.includes("types")) return "TypeScript type definitions";
  if (dir.includes("pages")) return "Page components / routing";
  if (dir.includes("config")) return "Configuration";
  if (dir.includes("modules")) return "Feature modules";
  if (dir.includes("public")) return "Static assets";
  if (dir.includes("tests") || dir.includes("__tests__")) return "Test files";
  if (dir.includes("docs")) return "Documentation";
  if (dir.includes("api")) return "API endpoints";
  if (dir.includes("schemas")) return "Data schemas / validation";
  return "Other";
}
