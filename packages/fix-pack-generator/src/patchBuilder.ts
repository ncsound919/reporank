import type { HealthReport } from "@reporank/shared-types";

export interface GeneratedPatch { filePath: string; title: string; type: "create" | "modify"; content?: string; description: string; }

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
