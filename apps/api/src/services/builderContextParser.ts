/**
 * builderContextParser — detects builder-specific signals from file tree + source files.
 * Pure function, deterministic, no I/O.
 */

export interface BuilderContext {
  buildSource: "github" | "bolt" | "lovable" | "manual-upload" | "other";
  detectedStack: string[];
  builderSignals: BuilderSignal[];
  branch: string;
}

export interface BuilderSignal {
  type: string;
  description: string;
  severity: "info" | "warning" | "critical";
}

const STACK_MARKERS: Record<string, string[]> = {
  "Vite": ["vite.config.ts", "vite.config.js"],
  "Next.js": ["next.config.js", "next.config.ts", "next.config.mjs"],
  "React": ["react", "jsx", "tsx"],
  "Supabase": ["supabase", "@supabase/supabase-js"],
  "Stripe": ["stripe", "@stripe/stripe-js"],
  "Tailwind": ["tailwind.config.js", "tailwind.config.ts"],
  "Prisma": ["prisma/schema.prisma", "schema.prisma"],
  "Drizzle": ["drizzle.config.ts", "drizzle.config.js"],
  "Express": ["express"],
  "Fastify": ["fastify"],
  "tRPC": ["trpc", "@trpc/server"],
  "Shadcn": ["components/ui", "shadcn"],
  "Clerk": ["@clerk/nextjs", "@clerk/clerk-sdk"],
  "Resend": ["resend", "@resend/node"],
  "Vercel": ["vercel.json", ".vercel"],
  "Railway": ["railway.json"],
  "Docker": ["Dockerfile", "docker-compose.yml"],
};

function detectStack(fileTree: string[], packageJsonContent: string): string[] {
  const detected: string[] = [];
  const lowerTree = fileTree.map(f => f.toLowerCase());

  for (const [name, markers] of Object.entries(STACK_MARKERS)) {
    const found = markers.some(marker => {
      const lower = marker.toLowerCase();
      return lowerTree.some(f => f.includes(lower)) || packageJsonContent.toLowerCase().includes(lower);
    });
    if (found) detected.push(name);
  }

  return [...new Set(detected)];
}

function detectBuilderSignals(
  fileTree: string[],
  sourceFiles: { path: string; content: string }[]
): BuilderSignal[] {
  const signals: BuilderSignal[] = [];

  // Count UI vs backend files
  const uiExtensions = [".tsx", ".jsx", ".css", ".svg", ".png"];
  const backendExtensions = [".ts", ".js", ".py", ".go", ".rs", ".java"];
  const uiFiles = fileTree.filter(f => uiExtensions.some(e => f.endsWith(e)));
  const backendFiles = fileTree.filter(f =>
    backendExtensions.some(e => f.endsWith(e)) &&
    !f.endsWith(".tsx") && !f.endsWith(".jsx")
  );

  if (uiFiles.length > 0 && backendFiles.length > 0) {
    const ratio = uiFiles.length / (backendFiles.length + 1);
    if (ratio > 3) {
      signals.push({
        type: "ui-heavy",
        description: `UI/backend file ratio is ${ratio.toFixed(1)}:1 — typical of AI builder output`,
        severity: "info",
      });
    }
  }

  // Sparse tests
  const testFiles = fileTree.filter(f => /\.(test|spec)\.[a-z]+$/i.test(f) || f.includes("__tests__"));
  if (testFiles.length === 0) {
    signals.push({ type: "no-tests", description: "No test files detected", severity: "warning" });
  } else if (testFiles.length < 3 && fileTree.length > 20) {
    signals.push({ type: "sparse-tests", description: `Only ${testFiles.length} test file(s) for ${fileTree.length} total files`, severity: "warning" });
  }

  // Missing docs
  const hasReadme = fileTree.some(f => f.toLowerCase() === "readme.md" || f.toLowerCase().endsWith("/readme.md"));
  if (!hasReadme) {
    signals.push({ type: "no-readme", description: "No README.md found", severity: "warning" });
  }

  // Missing migrations
  const hasMigrations = fileTree.some(f =>
    f.includes("migrations/") || f.includes("migration/") || f.includes("prisma/migrations")
  );
  if (!hasMigrations) {
    const hasPrisma = fileTree.some(f => f.includes("schema.prisma"));
    const hasDrizzle = fileTree.some(f => f.includes("drizzle.config"));
    if (hasPrisma || hasDrizzle) {
      signals.push({ type: "no-migrations", description: "ORM detected but no migration files found", severity: "critical" });
    }
  }

  // Missing env strategy
  const hasEnvExample = fileTree.some(f => f.includes(".env.example") || f.includes(".env.sample"));
  const hasEnvActual = fileTree.some(f => f === ".env" || f.endsWith("/.env"));
  if (!hasEnvExample && hasEnvActual) {
    signals.push({ type: "missing-env-strategy", description: ".env file present but no .env.example — secrets may be hardcoded", severity: "critical" });
  }

  // Mock data mistaken for real integration
  const mockPatterns = [/mock\s*=\s*true/i, /useMockData/i, /MOCK_MODE/i, /isDev.*mock/i];
  for (const sf of sourceFiles.slice(0, 100)) {
    if (mockPatterns.some(p => p.test(sf.content))) {
      signals.push({ type: "mock-data-detected", description: `Mock data patterns found in ${sf.path}`, severity: "warning" });
      break;
    }
  }

  // Missing CI
  const hasCI = fileTree.some(f =>
    f.includes(".github/workflows") || f.includes(".gitlab-ci") || f.includes("Jenkinsfile") || f.includes(".circleci")
  );
  if (!hasCI) {
    signals.push({ type: "no-ci", description: "No CI/CD configuration detected", severity: "info" });
  }

  return signals;
}

export function parseBuilderContext(
  fileTree: string[],
  sourceFiles: { path: string; content: string }[],
  branch: string,
  buildSource: BuilderContext["buildSource"] = "github"
): BuilderContext {
  const pkgFile = sourceFiles.find(f => f.path === "package.json" || f.path.endsWith("/package.json"));
  const packageJsonContent = pkgFile?.content || "{}";

  return {
    buildSource,
    detectedStack: detectStack(fileTree, packageJsonContent),
    builderSignals: detectBuilderSignals(fileTree, sourceFiles),
    branch,
  };
}
