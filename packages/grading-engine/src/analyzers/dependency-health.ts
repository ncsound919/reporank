export interface DependencyFinding {
  type: "outdated" | "deprecated" | "unused" | "vulnerable" | "mismatched" | "excessive" | "peer-conflict";
  packageName: string;
  version: string;
  severity: "critical" | "high" | "medium" | "low";
  detail: string;
}

export interface DependencyReport {
  findings: DependencyFinding[];
  totalDeps: number;
  devDeps: number;
  unusedPatterns: string[];
  depHealthScore: number;
  summary: string;
}

const KNOWN_DEPRECATED: Record<string, string> = {
  "request": "Deprecated since 2020. Use node-fetch, axios, or built-in fetch.",
  "moment": "Considered legacy. Use date-fns, dayjs, or luxon instead.",
  "underscore": "Native ES6+ Array/ Object methods now cover most use cases.",
  "chalk": "Native --color support in Node 22+.",
  "express-validator": "Use zod for validation (more modern, TypeScript-first).",
  "body-parser": "Built into Express 4.16+ via express.json() and express.urlencoded().",
  "bluebird": "Native Promise API is now standard. Drop-in replacement not needed.",
  "gulp": "Use Vite, esbuild, or tsc for builds.",
  "jade": "Renamed to pug in 2016.",
  "node-sass": "Use sass (dart-sass) instead.",
  "react-helmet": "Use native <title> or next/head in modern React.",
  "recompose": "Deprecated. Use React hooks.",
  "material-ui": "Renamed to @mui/material.",
};

const MAJOR_DEP_VERSION_GAPS = {
  "react": 19, "react-dom": 19, "next": 15, "vue": 3, "angular": 19,
  "express": 5, "typescript": 5.9, "prisma": 6, "@prisma/client": 6,
  "vite": 7, "webpack": 6, "tailwindcss": 4, "postcss": 9,
  "eslint": 9, "prettier": 4,
  "jest": 30, "vitest": 3,
};

const REPLACEMENTS: Record<string, string> = {
  "request": " && npm install node-fetch",
  "moment": " && npm install date-fns",
  "underscore": "",
  "chalk": "",
  "express-validator": " && npm install zod",
  "body-parser": "",
  "jade": " && npm install pug",
  "node-sass": " && npm install sass",
  "react-helmet": "",
  "recompose": "",
};

function getReplacement(name: string): string {
  return REPLACEMENTS[name] || ""; // If no replacement, just uninstalling is enough
}

export function analyzeDependencies(
  packageJsonContent: string,
  sourceFiles: { path: string; content: string }[]
): DependencyReport {
  const findings: DependencyFinding[] = [];
  const unusedPatterns: string[] = [];

  let pkg: any;
  try { pkg = JSON.parse(packageJsonContent); } catch {
    return { findings: [], totalDeps: 0, devDeps: 0, unusedPatterns: [], depHealthScore: 0, summary: "No valid package.json found" };
  }

  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
  const depNames = Object.keys(allDeps);
  const totalDeps = Object.keys(pkg.dependencies || {}).length;
  const devDeps = Object.keys(pkg.devDependencies || {}).length;

  // 1. Check for deprecated packages
  for (const [name, reason] of Object.entries(KNOWN_DEPRECATED)) {
    if (depNames.includes(name)) {
      findings.push({
        type: "deprecated", packageName: name, version: allDeps[name],
        severity: "high", detail: `${reason} Run: npm uninstall ${name}${getReplacement(name)}`,
      });
    }
  }

  // 2. Check for outdated major versions
  for (const [name, latestMajor] of Object.entries(MAJOR_DEP_VERSION_GAPS)) {
    if (allDeps[name]) {
      const versionStr = String(allDeps[name]);
      const majorMatch = versionStr.match(/\^?(\d+)/);
      if (majorMatch) {
        const currentMajor = parseInt(majorMatch[1], 10);
        const gap = latestMajor - currentMajor;
        if (gap >= 2) {
          findings.push({
            type: "outdated", packageName: name, version: versionStr,
            severity: gap >= 3 ? "critical" : "high",
            detail: `Version ${versionStr} is ${gap} major versions behind latest v${latestMajor}. Run: npm install ${name}@${latestMajor}`,
          });
        } else if (gap >= 1) {
          findings.push({
            type: "outdated", packageName: name, version: versionStr,
            severity: "medium", detail: `v${latestMajor} available — upgrade from ${versionStr}. Run: npm install ${name}@${latestMajor}`,
          });
        }
      }
    }
  }

  // 3. Check for excessive dependencies
  if (totalDeps > 50) {
    const topHeavy = Object.entries(allDeps)
      .filter(([_, v]) => typeof v === "string" && !v.startsWith("workspace"))
      .slice(0, 5)
      .map(([name]) => name);
    findings.push({
      type: "excessive", packageName: "all", version: `${totalDeps}+${devDeps}`,
      severity: "medium", detail: `${totalDeps} prod deps + ${devDeps} dev deps = ${totalDeps + devDeps} total. Check if all are needed.`
    });
  }

  // 4. Detect unused dependencies (not imported in any source file)
  const sourceContent = sourceFiles.map(f => f.content).join("\n");
  const allImports = new Set<string>();
  for (const match of sourceContent.matchAll(/(?:from|require)\s*\(?\s*["']([^"'.][^"'/]*)["']/g)) {
    const imported = match[1].split("/")[0];
    if (imported.startsWith("@")) {
      const scope = imported.split("/").slice(0, 2).join("/");
      allImports.add(scope);
    } else {
      allImports.add(imported);
    }
  }

  const KNOWN_USED_BUT_NOT_IMPORTED = new Set([
    "typescript", "prisma", "@prisma/client", "vite", "@vitejs/plugin-react", "vitest",
    "tailwindcss", "postcss", "autoprefixer", "tsx", "electron", "electron-builder",
    "dotenv", "turbo", "prettier", "eslint", "@tailwindcss/vite",
    "happy-dom", "@testing-library/jest-dom", "@testing-library/react",
    "@vitest/coverage-v8", "tw-animate-css", "tailwind-merge",
  ]);

  for (const dep of depNames) {
    // Skip known tooling/build deps
    if (KNOWN_USED_BUT_NOT_IMPORTED.has(dep)) continue;

    const isImported = [...allImports].some(i => i === dep || i.startsWith(dep + "/") || i.startsWith("@" + dep));
    // Skip packages used through barrel re-exports (radix, shadcn patterns)
    const isRadixPattern = dep.startsWith("@radix-ui/");
    if (!isImported && !dep.startsWith("@types/") && dep !== "typescript" && dep !== "prisma" && !isRadixPattern) {
      findings.push({
        type: "unused", packageName: dep, version: allDeps[dep],
        severity: "low", detail: `Declared in package.json but never imported in source files`,
      });
      unusedPatterns.push(dep);
    }
  }

  // 5. Check for version mismatches (same package in both deps and devDeps)
  if (pkg.dependencies && pkg.devDependencies) {
    for (const dep of Object.keys(pkg.dependencies)) {
      if (pkg.devDependencies[dep]) {
        findings.push({
          type: "mismatched", packageName: dep,
          version: `${pkg.dependencies[dep]} (prod) vs ${pkg.devDependencies[dep]} (dev)`,
          severity: "high", detail: "Same package in both dependencies and devDependencies — remove from one",
        });
      }
    }
  }

  // Calculate health score
  let score = 100;
  score -= findings.filter(f => f.severity === "critical").length * 20;
  score -= findings.filter(f => f.severity === "high").length * 10;
  score -= findings.filter(f => f.severity === "medium").length * 5;
  score -= findings.filter(f => f.severity === "low").length * 2;

  const criticalCount = findings.filter(f => f.severity === "critical").length;
  const totalFindings = findings.length;

  return {
    findings,
    totalDeps,
    devDeps,
    unusedPatterns,
    depHealthScore: Math.max(0, score),
    summary: `${totalDeps} prod deps, ${devDeps} dev deps. ${totalFindings} issues (${criticalCount} critical). Score: ${Math.max(0, score)}/100.`,
  };
}
