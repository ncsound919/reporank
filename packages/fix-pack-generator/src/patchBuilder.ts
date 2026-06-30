import type { HealthReport } from "@reporank/shared-types";

export interface GeneratedPatch {
  filePath: string;
  title: string;
  type: "create" | "modify";
  content?: string;
  oldText?: string;
  newText?: string;
  description: string;
  category?: string;
  severity?: "critical" | "high" | "medium" | "low" | "info";
}

export interface FindingInput {
  category: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  line: number;
  type: string;
  description: string;
  recommendation: string;
  confidence: number;
  path?: string;
}

export function generateFixPacks(report: HealthReport): GeneratedPatch[] {
  const patches: GeneratedPatch[] = [];

  if (!report.deployment.hasEnvExample) patches.push({
    filePath: ".env.example", title: "Create .env.example template", type: "create",
    content: "# Environment Variables\nPORT=3000\nNODE_ENV=development\nDATABASE_URL=postgresql://user:pass@localhost:5432/mydb\n",
    description: "Missing env template — create one for onboarding.",
  });

  if (!report.deployment.hasDockerfile) patches.push({
    filePath: "Dockerfile", title: "Create Dockerfile", type: "create",
    content: "FROM node:22-alpine\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci\nCOPY . .\nRUN npm run build\nEXPOSE 3000\nCMD [\"node\", \"dist/index.js\"]\n",
    description: "Missing Dockerfile for containerized deployment.",
  });

  if (!report.quality.hasCiConfig) patches.push({
    filePath: ".github/workflows/ci.yml", title: "Create CI workflow", type: "create",
    content: "name: CI\non: [push, pull_request]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n        with: { node-version: 22 }\n      - run: npm ci\n      - run: npm test\n",
    description: "Missing CI pipeline.",
  });

  return patches;
}

const AUTO_FIXABLE_TYPES: Record<string, { validateLine: boolean }> = {
  "any-type-abuse": { validateLine: true },
  "debug-code": { validateLine: false },
  "TASK-comment": { validateLine: false },
  "hardcoded-secret": { validateLine: false },
};

export function findingsToPatches(
  findings: FindingInput[],
  fileContents: Map<string, string>,
): GeneratedPatch[] {
  const patches: GeneratedPatch[] = [];

  for (const f of findings) {
    const fix = AUTO_FIXABLE_TYPES[f.type];
    if (!fix) continue;

    const filePath = f.path;
    if (!filePath) continue;

    const content = fileContents.get(filePath);
    if (!content) continue;

    const lines = content.split("\n");
    if (f.line < 1 || f.line > lines.length) continue;

    if (f.type === "any-type-abuse" && lines[f.line - 1].includes(": any")) {
      if (!fix.validateLine) continue;
      patches.push({
        filePath,
        title: `fix: replace 'any' with 'unknown'`,
        type: "modify",
        oldText: lines[f.line - 1],
        newText: lines[f.line - 1].replace(/: any\b/g, ": unknown"),
        description: f.description,
        category: f.category,
        severity: f.severity,
      });
    } else if (f.type === "debug-code") {
      const targetLine = lines[f.line - 1];
      if (targetLine.includes("console.log") || targetLine.includes("console.debug")) {
        const indent = targetLine.match(/^(\s*)/)?.[1] ?? "";
        patches.push({
          filePath,
          title: "fix: remove debug console statement",
          type: "modify",
          oldText: targetLine + "\n",
          newText: `// [reporank] removed console.log\n${indent}// use a proper logger (e.g. pino, winston)\n`,
          description: f.description,
          category: f.category,
          severity: f.severity,
        });
      }
    } else if (f.type === "TASK-comment") {
      const targetLine = lines[f.line - 1];
      if (/\/\/\s*(?:TASK|FIX_NOW|HACK|XXX)\b/i.test(targetLine)) {
        patches.push({
          filePath,
          title: `fix: link TASK to issue tracker`,
          type: "modify",
          oldText: targetLine,
          newText: `${targetLine} (tracked: see issue tracker)`,
          description: f.description,
          category: f.category,
          severity: f.severity,
        });
      }
    } else if (f.type === "hardcoded-secret") {
      const targetLine = lines[f.line - 1];
      const indent = targetLine.match(/^(\s*)/)?.[1] ?? "";
      patches.push({
        filePath,
        title: "fix: replace hardcoded secret with env var",
        type: "modify",
        oldText: targetLine,
        newText: `${indent}// [reporank] hardcoded secret removed — use process.env instead`,
        description: f.description,
        category: f.category,
        severity: f.severity,
      });
    }
  }

  return patches;
}
