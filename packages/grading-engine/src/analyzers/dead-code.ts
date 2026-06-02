/**
 * Dead Code Elimination Plan — finds exported but unused functions and
 * generates a safe removal plan with cross-reference checking.
 */
export interface EliminationStep {
  file: string;
  symbol: string;
  reason: string;
  removalPlan: string;
  riskLevel: "safe" | "moderate" | "risky";
}

export interface DeadCodeReport {
  steps: EliminationStep[];
  totalRemovable: number;
  estimatedSavingsLoc: number;
  summary: string;
}

export function generateDeadCodePlan(sourceFiles: { path: string; content: string }[]): DeadCodeReport {
  const steps: EliminationStep[] = [];
  let totalLoc = 0;

  // Build import usage map: for each file, track what symbols are imported from it
  const fileToImports = new Map<string, Set<string>>();
  const allExports = new Map<string, Map<string, number>>(); // file -> exported symbol -> line count

  for (const file of sourceFiles) {
    fileToImports.set(file.path, new Set());

    // Extract exported symbols (named exports only)
    const exports = new Map<string, number>();
    const lines = file.content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Named export: export function foo, export const foo, export class Foo
      const fnExport = line.match(/export\s+(?:async\s+)?function\s+(\w+)/);
      if (fnExport) {
        let fnLines = 1;
        for (let j = i + 1; j < Math.min(i + 100, lines.length); j++) {
          fnLines++;
          if (lines[j].trim() === "}") break;
        }
        exports.set(fnExport[1], fnLines);
      }

      const constExport = line.match(/export\s+(?:const|let|var)\s+(\w+)/);
      if (constExport) exports.set(constExport[1], 1);

      const classExport = line.match(/export\s+(?:default\s+)?class\s+(\w+)/);
      if (classExport) {
        let clsLines = 1;
        for (let j = i + 1; j < Math.min(i + 200, lines.length); j++) {
          clsLines++;
          if (lines[j].trim() === "}") break;
        }
        exports.set(classExport[1], clsLines);
      }
    }

    allExports.set(file.path, exports);

    // Track which files are imported by others
    for (const m of file.content.matchAll(/(?:from|require)\s*\(?\s*["']([^"']+)["']/g)) {
      const imp = m[1];
      if (imp.startsWith(".")) {
        const dir = file.path.split("/").slice(0, -1).join("/");
        const resolved = resolveRelPath(dir, imp);
        if (resolved) fileToImports.get(file.path)?.add(resolved);
      }
    }
  }

  // Find which files are never imported
  const allImportedFiles = new Set<string>();
  for (const [, imports] of fileToImports) {
    for (const imp of imports) allImportedFiles.add(imp);
  }

  for (const [file, exports] of allExports) {
    // Check if this file is imported by any other file
    const isImported = [...allImportedFiles].some(f => f === file || f.startsWith(file + ".") || file.startsWith(f));

    // Also check if exports are referenced in the same file (self-test)
    const filesContent = sourceFiles.map(f => f.content).join("\n");

    for (const [symbol, loc] of exports) {
      if (symbol === "default") continue;

      // Check if this symbol is used anywhere else
      const usedInOtherFiles = [...allExports.entries()].some(([f]) => f !== file && sourceFiles.some(sf => sf.path === f && sf.content.includes(symbol)));
      const fileContent = sourceFiles.find(sf => sf.path === file)?.content || "";
      if (!fileContent.includes(symbol)) continue;
      if (!isImported && exports.size > 1 && !usedInOtherFiles) {
        const isIndex = file.endsWith("index.ts") || file.endsWith("index.tsx");
        const riskLevel = isIndex ? "moderate" : "safe";

        steps.push({
          file,
          symbol,
          reason: `Exported symbol '${symbol}' is not imported by any other file`,
          removalPlan: isIndex
            ? `Verify '${symbol}' isn't re-exported through this index. If not, remove the export and the definition.`
            : `Remove export keyword from '${symbol}', then run tests. If nothing breaks, remove the definition entirely.`,
          riskLevel,
        });
        totalLoc += loc;
      }
    }
  }

  return {
    steps: steps.slice(0, 20),
    totalRemovable: steps.length,
    estimatedSavingsLoc: totalLoc,
    summary: `${steps.length} potentially dead export(s) found (~${totalLoc} lines). ${steps.filter(s => s.riskLevel === "safe").length} can be safely removed.`,
  };
}

function resolveRelPath(base: string, relative: string): string | null {
  if (!relative.startsWith(".")) return null;
  const parts = base ? base.split("/") : [];
  for (const p of relative.split("/")) {
    if (p === "..") parts.pop();
    else if (p !== ".") parts.push(p);
  }
  return parts.join("/");
}
