import { runScopeMatcher } from "./scopeMatcher";

const baseBrief = {
  deliverables: ["auth login", "payment stripe", "admin dashboard"],
  exclusions: [],
  constraints: ["no analytics"],
  assumptions: [],
};

describe("runScopeMatcher", () => {
  it("returns on-scope when all deliverables evidenced", () => {
    const result = runScopeMatcher({
      brief: baseBrief,
      report: {},
      fileTree: ["src/auth/login.ts", "src/billing/stripe.ts", "src/admin/dashboard.tsx"],
      sourceFiles: [
        { path: "src/auth/login.ts", content: "export function login() {}" },
        { path: "src/billing/stripe.ts", content: "export function processPayment() {}" },
        { path: "src/admin/dashboard.tsx", content: "export function AdminDashboard() {}" }
      ]
    });
    expect(result.status).toBe("on-scope");
    expect(result.inScope).toEqual(["auth login", "payment stripe", "admin dashboard"]);
  });

  it("returns blocked when nothing is evidenced", () => {
    const result = runScopeMatcher({
      brief: baseBrief,
      report: {},
      fileTree: ["README.md"],
      sourceFiles: [{ path: "README.md", content: "# My Project" }]
    });
    expect(result.status).toBe("blocked");
    expect(result.missingPlanned).toEqual(["auth login", "payment stripe", "admin dashboard"]);
  });

  it("returns at-risk when some deliverables evidenced", () => {
    const result = runScopeMatcher({
      brief: baseBrief,
      report: {},
      fileTree: ["src/auth/login.ts", "README.md"],
      sourceFiles: [
        { path: "src/auth/login.ts", content: "export function login() {}" },
        { path: "README.md", content: "# My Project" }
      ]
    });
    expect(result.status).toBe("at-risk");
    expect(result.inScope).toEqual(["auth login"]);
    expect(result.missingPlanned).toEqual(["payment stripe", "admin dashboard"]);
  });

  it("detects feature-creep for analytics when excluded", () => {
    const brief = { ...baseBrief, exclusions: ["analytics"] };
    const result = runScopeMatcher({
      brief,
      report: {},
      fileTree: ["src/analytics/posthog.ts", "src/auth/login.ts"],
      sourceFiles: [
        { path: "src/analytics/posthog.ts", content: "import posthog from 'posthog-js';" },
        { path: "src/auth/login.ts", content: "export function login() {}" }
      ]
    });
    expect(result.driftCategories).toContain("feature-creep");
    expect(result.outOfScope).toContain("analytics (detected in code, not in scope)");
  });

  it("detects excluded feature explicitly", () => {
    const brief = { ...baseBrief, exclusions: ["analytics"] };
    const result = runScopeMatcher({
      brief,
      report: {},
      fileTree: ["src/analytics/posthog.ts", "src/auth/login.ts"],
      sourceFiles: [
        { path: "src/analytics/posthog.ts", content: "import posthog from 'posthog-js';" },
        { path: "src/auth/login.ts", content: "export function login() {}" }
      ]
    });
    const analyticsIssue = result.outOfScope.find(s => s.includes("explicitly excluded"));
    expect(analyticsIssue).toBeDefined();
    expect(analyticsIssue).toContain("analytics (explicitly excluded but found in code)");
  });

  it("detects missing planned deliverables", () => {
    const result = runScopeMatcher({
      brief: baseBrief,
      report: {},
      fileTree: ["src/auth/login.ts"],
      sourceFiles: [{ path: "src/auth/login.ts", content: "export function login() {}" }]
    });
    expect(result.missingPlanned).toEqual(["payment stripe", "admin dashboard"]);
  });

  it("does not trigger dependency-creep for normal dep count", () => {
    const brief = { ...baseBrief, constraints: ["no analytics"] };
    const result = runScopeMatcher({
      brief,
      report: {},
      fileTree: ["package.json", "src/auth/login.ts"],
      sourceFiles: [
        { 
          path: "package.json", 
          content: JSON.stringify({
            dependencies: {
              "express": "^4.18.0",
              "react": "^18.0.0"
            },
            devDependencies: {
              "jest": "^28.0.0"
            }
          }) 
        },
        { path: "src/auth/login.ts", content: "export function login() {}" }
      ]
    });
    expect(result.driftCategories).not.toContain("dependency-creep");
  });

  it("triggers dependency-creep for high dep count without constraints", () => {
    const brief = { ...baseBrief, constraints: ["no analytics"] };
    const deps = {};
    for (let i = 0; i < 90; i++) {
      deps[`dep-${i}`] = "^1.0.0";
    }
    const result = runScopeMatcher({
      brief,
      report: {},
      fileTree: ["package.json", "src/auth/login.ts"],
      sourceFiles: [
        { 
          path: "package.json", 
          content: JSON.stringify({ dependencies: deps }) 
        },
        { path: "src/auth/login.ts", content: "export function login() {}" }
      ]
    });
    expect(result.driftCategories).toContain("dependency-creep");
  });

  it("does not trigger dependency-creep when constraints mention deps", () => {
    const brief = { 
      ...baseBrief, 
      constraints: ["no analytics", "bundle size under 500kb", "limited dependencies"] 
    };
    const deps = {};
    for (let i = 0; i < 90; i++) {
      deps[`dep-${i}`] = "^1.0.0";
    }
    const result = runScopeMatcher({
      brief,
      report: {},
      fileTree: ["package.json", "src/auth/login.ts"],
      sourceFiles: [
        { 
          path: "package.json", 
          content: JSON.stringify({ dependencies: deps }) 
        },
        { path: "src/auth/login.ts", content: "export function login() {}" }
      ]
    });
    expect(result.driftCategories).not.toContain("dependency-creep");
  });

  it("handles intent gaps analysis", () => {
    const brief = {
      ...baseBrief,
      intentDocument: {
        promisedFeatures: ["real-time updates", "offline support", "dark mode"]
      }
    };
    const result = runScopeMatcher({
      brief,
      report: {},
      fileTree: ["src/auth/login.ts", "src/features/dark-mode.ts"],
      sourceFiles: [
        { path: "src/auth/login.ts", content: "export function login() {}" },
        { path: "src/features/dark-mode.ts", content: "export const darkMode = true;" }
      ]
    });
    expect(result.intentGaps).toHaveLength(3);
    
    const realTimeGap = result.intentGaps.find(g => g.promised === "real-time updates");
    expect(realTimeGap).toBeDefined();
    expect(realTimeGap?.evidenceFound).toBe(false);
    
    const darkModeGap = result.intentGaps.find(g => g.promised === "dark mode");
    expect(darkModeGap).toBeDefined();
    expect(darkModeGap?.evidenceFound).toBe(true);
  });
});