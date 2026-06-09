/**
 * portabilityChecker — checks if a build can leave Bolt/Lovable cleanly.
 * Pure function, deterministic, no I/O.
 */

export interface PortabilityResult {
  secretsExternalized: boolean;
  deployReproducible: boolean;
  gitHistoryUsable: boolean;
  apisEncodedOutsideBuilder: boolean;
  hasMigrations: boolean;
  overallScore: number;
  issues: PortabilityIssue[];
}

export interface PortabilityIssue {
  check: string;
  passed: boolean;
  severity: "info" | "warning" | "critical";
  detail: string;
  fix: string;
}

export function checkPortability(
  fileTree: string[],
  sourceFiles: { path: string; content: string }[],
): PortabilityResult {
  const issues: PortabilityIssue[] = [];

  // 1. Secrets externalized
  const hasEnvExample = fileTree.some(f => f.includes(".env.example") || f.includes(".env.sample"));
  const hasEnvActual = fileTree.some(f => f === ".env" || f.endsWith("/.env"));
  const hardcodedSecretPattern = /(?:api[_-]?key|apikey|secret[_-]?key|password|token|auth[_-]?token|bearer)\s*[:=]\s*["'`][^"'`\s]{8,}["'`]/i;
  
  // Scan ALL files up to a total content budget (5MB), skip obviously safe files
  const MAX_CONTENT_BYTES = 5 * 1024 * 1024; // 5MB
  const SKIP_EXTENSIONS = /\.(png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot|mp4|zip|lock)$/i;
  const SKIP_PATHS = /(node_modules|\.git|dist|build|\.next)\//;
  
  let bytesScanned = 0;
  let secretsFound = false;

  for (const sf of sourceFiles) {
    if (SKIP_EXTENSIONS.test(sf.path) || SKIP_PATHS.test(sf.path)) continue;
    if (sf.path.includes(".env") && !sf.path.includes(".env.example")) continue;

    bytesScanned += sf.content.length;
    if (bytesScanned > MAX_CONTENT_BYTES) break;

    if (hardcodedSecretPattern.test(sf.content)) {
      secretsFound = true;
      break;
    }
  }

  const hasHardcodedSecrets = secretsFound;
  const secretsExternalized = hasEnvExample && !hasHardcodedSecrets;
  issues.push({
    check: "Secrets externalized",
    passed: secretsExternalized,
    severity: hasHardcodedSecrets ? "critical" : "warning",
    detail: hasHardcodedSecrets
      ? "Hardcoded secrets detected in source files"
      : hasEnvExample
        ? ".env.example present — secrets strategy looks good"
        : "No .env.example found — secrets strategy unclear",
    fix: "Move all credentials to environment variables and add a .env.example template",
  });

  // 2. Deploy reproducible
  const hasDockerfile = fileTree.some(f => f === "Dockerfile" || f.endsWith("/Dockerfile"));
  const hasCI = fileTree.some(f =>
    f.includes(".github/workflows") || f.includes(".gitlab-ci") || f.includes("Jenkinsfile")
  );
  const hasPackageJson = fileTree.some(f => f === "package.json" || f.endsWith("/package.json"));
  const deployReproducible = hasDockerfile || hasCI;
  issues.push({
    check: "Deploy setup reproducible",
    passed: deployReproducible,
    severity: "warning",
    detail: deployReproducible
      ? `Deployment config found: Docker=${hasDockerfile}, CI=${hasCI}`
      : "No Dockerfile or CI configuration found",
    fix: "Add a Dockerfile and/or CI workflow to make deploys reproducible outside the builder",
  });

  // 3. Git history usable (proxy: check for .gitignore and not committing node_modules)
  const hasGitignore = fileTree.some(f => f === ".gitignore" || f.endsWith("/.gitignore"));
  const commitsNodeModules = fileTree.some(f => f.includes("node_modules/"));
  const gitHistoryUsable = hasGitignore && !commitsNodeModules;
  issues.push({
    check: "Git history usable",
    passed: gitHistoryUsable,
    severity: commitsNodeModules ? "critical" : "info",
    detail: commitsNodeModules
      ? "node_modules appears to be committed — Git history will be polluted"
      : hasGitignore
        ? ".gitignore present — Git history should be clean"
        : "No .gitignore found — verify node_modules and build artifacts are excluded",
    fix: "Ensure .gitignore excludes node_modules, dist, and .env files",
  });

  // 4. APIs encoded outside builder UI
  const hasApiRoutes = fileTree.some(f =>
    f.includes("api/") || f.includes("routes/") || f.includes("controllers/") || f.includes("server.")
  );
  const hasOpenApiOrTypes = fileTree.some(f =>
    f.includes("openapi") || f.includes("swagger") || f.includes("types.ts") || f.includes("schema.ts")
  );
  const apisEncodedOutsideBuilder = hasApiRoutes && (hasOpenApiOrTypes || hasPackageJson);
  issues.push({
    check: "APIs encoded in code (not builder UI only)",
    passed: apisEncodedOutsideBuilder,
    severity: "warning",
    detail: apisEncodedOutsideBuilder
      ? "API routes found in code — data model is not locked to the builder UI"
      : "No API route files detected — data model may only exist in the builder UI",
    fix: "Ensure all API routes, data models, and integrations are expressed in code files, not just builder configuration",
  });

  // 5. Migrations present (if ORM detected)
  const hasPrisma = fileTree.some(f => f.includes("schema.prisma"));
  const hasDrizzle = fileTree.some(f => f.includes("drizzle.config"));
  const hasMigrationFiles = fileTree.some(f =>
    f.includes("migrations/") || f.includes("prisma/migrations")
  );
  const hasMigrations = (hasPrisma || hasDrizzle) ? hasMigrationFiles : true; // pass if no ORM
  issues.push({
    check: "Database migrations present",
    passed: hasMigrations,
    severity: "critical",
    detail: hasMigrations
      ? "Migration files found alongside ORM schema"
      : (hasPrisma || hasDrizzle)
        ? "ORM detected but no migration files — schema changes are not reproducible"
        : "No ORM detected (check passes)",
    fix: "Run `prisma migrate dev` or `drizzle-kit generate` and commit migration files",
  });

  const passedCount = issues.filter(i => i.passed).length;
  const overallScore = Math.round((passedCount / issues.length) * 100);

  return {
    secretsExternalized,
    deployReproducible,
    gitHistoryUsable,
    apisEncodedOutsideBuilder,
    hasMigrations,
    overallScore,
    issues,
  };
}
