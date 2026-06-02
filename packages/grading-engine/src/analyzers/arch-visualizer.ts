/**
 * Architecture Visualizer — generates a Mermaid.js flowchart of the codebase
 * showing module relationships, dependency direction, and structural hotspots.
 * No other code review tool generates architecture diagrams from analysis.
 */
export interface ArchitectureDiagram {
  mermaidCode: string;
  moduleCount: number;
  dependencyCount: number;
  summary: string;
}

export function generateArchitectureDiagram(sourceFiles: { path: string; content: string }[]): ArchitectureDiagram {
  // Build a simplified dependency graph at the module/directory level
  const modules = new Map<string, Set<string>>();
  const dirFiles = new Map<string, string[]>();

  // Group files by top-level directory
  for (const file of sourceFiles) {
    const parts = file.path.replace(/\\/g, "/").split("/");
    const topDir = parts[0] === "src" && parts.length > 1 ? `src/${parts[1]}` : parts[0];
    if (!dirFiles.has(topDir)) dirFiles.set(topDir, []);
    dirFiles.get(topDir)!.push(file.path);
    if (!modules.has(topDir)) modules.set(topDir, new Set());
  }

  // Extract inter-module dependencies
  for (const file of sourceFiles) {
    const parts = file.path.replace(/\\/g, "/").split("/");
    const sourceModule = parts[0] === "src" && parts.length > 1 ? `src/${parts[1]}` : parts[0];
    const imports = file.content.matchAll(/(?:from|require)\s*\(?\s*["']([^"']+)["']/g);
    for (const m of imports) {
      const imp = m[1];
      if (imp.startsWith(".")) {
        // Resolve relative import to a directory
        const fileDir = file.path.split("/").slice(0, -1).join("/");
        const resolved = resolveDir(fileDir, imp);
        if (resolved) {
          const targetParts = resolved.replace(/\\/g, "/").split("/");
          const targetModule = targetParts[0] === "src" && targetParts.length > 1 ? `src/${targetParts[1]}` : targetParts[0];
          if (targetModule !== sourceModule && targetModule !== "" && !targetModule.startsWith(".") && !targetModule.startsWith("@")) {
            modules.get(sourceModule)?.add(targetModule);
          }
        }
      }
    }
  }

  // Generate Mermaid flowchart
  let mermaid = "graph LR\n";
  const visited = new Set<string>();
  let totalDeps = 0;

  // Add nodes
  for (const [mod] of modules) {
    const safeName = mod.replace(/[^a-zA-Z0-9]/g, "_");
    const displayName = mod.length > 25 ? mod.slice(0, 22) + "..." : mod;
    // Color code: infrastructure layers get different colors
    if (mod.includes("routes") || mod.includes("api")) {
      mermaid += `  ${safeName}["${displayName}"]:::api\n`;
    } else if (mod.includes("components") || mod.includes("pages")) {
      mermaid += `  ${safeName}["${displayName}"]:::ui\n`;
    } else if (mod.includes("db") || mod.includes("database") || mod.includes("models")) {
      mermaid += `  ${safeName}["${displayName}"]:::data\n`;
    } else if (mod.includes("test") || mod.includes("__tests")) {
      mermaid += `  ${safeName}["${displayName}"]:::test\n`;
    } else if (mod.includes("utils") || mod.includes("lib") || mod.includes("helpers")) {
      mermaid += `  ${safeName}["${displayName}"]:::util\n`;
    } else {
      mermaid += `  ${safeName}["${displayName}"]:::default\n`;
    }
  }

  // Add edges
  for (const [source, targets] of modules) {
    const safeSource = source.replace(/[^a-zA-Z0-9]/g, "_");
    for (const target of targets) {
      if (modules.has(target)) {
        const safeTarget = target.replace(/[^a-zA-Z0-9]/g, "_");
        mermaid += `  ${safeSource} --> ${safeTarget}\n`;
        totalDeps++;
      }
    }
  }

  // Add styles
  mermaid += `\n  classDef api fill:#3b82f6,color:#fff\n`;
  mermaid += `  classDef ui fill:#8b5cf6,color:#fff\n`;
  mermaid += `  classDef data fill:#10b981,color:#fff\n`;
  mermaid += `  classDef test fill:#f59e0b,color:#fff\n`;
  mermaid += `  classDef util fill:#6b7280,color:#fff\n`;
  mermaid += `  classDef default fill:#374151,color:#fff\n`;

  // Find the most-coupled modules
  let maxDeps = 0;
  let maxDepModule = "";
  for (const [source, targets] of modules) {
    if (targets.size > maxDeps) {
      maxDeps = targets.size;
      maxDepModule = source;
    }
  }

  return {
    mermaidCode: mermaid,
    moduleCount: modules.size,
    dependencyCount: totalDeps,
    summary: `${modules.size} modules detected. ${totalDeps} inter-module dependencies. ` +
      (maxDepModule ? `Most coupled module: ${maxDepModule} (${maxDeps} outgoing deps).` : ""),
  };
}

function resolveDir(base: string, relative: string): string | null {
  if (!relative.startsWith(".")) return null;
  const parts = base ? base.split("/") : [];
  const relParts = relative.split("/");
  for (const p of relParts) {
    if (p === "..") parts.pop();
    else if (p !== ".") parts.push(p);
  }
  return parts.join("/");
}
