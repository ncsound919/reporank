import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  parseQualityProfile,
  parseIssueReport,
  parseQualityGate,
  mapProfileToRepoRank,
  mapIssuesToRepoRank,
  mapQualityGateToThresholds,
  generateMigrationReport,
  generateRepoRankConfig,
} from "../../importers/sonarqube";

const fixturesDir = resolve(__dirname, "fixtures");

function readFixture(name: string): string {
  return readFileSync(resolve(fixturesDir, name), "utf-8");
}

describe("parseQualityProfile", () => {
  const xml = readFixture("sample-profile.xml");

  it("parses profile name and language", () => {
    const profile = parseQualityProfile(xml);
    expect(profile.name).toBe("Sonar way (TypeScript)");
    expect(profile.language).toBe("ts");
  });

  it("parses correct number of rules", () => {
    const profile = parseQualityProfile(xml);
    expect(profile.rules.length).toBe(8);
  });

  it("parses rule keys and repository keys", () => {
    const profile = parseQualityProfile(xml);
    const s1125 = profile.rules.find((r) => r.key === "S1125");
    expect(s1125).toBeDefined();
    expect(s1125!.repositoryKey).toBe("typescript");
    expect(s1125!.priority).toBe("MAJOR");
  });

  it("parses BLOCKER severity", () => {
    const profile = parseQualityProfile(xml);
    const bug001 = profile.rules.find((r) => r.key === "bug-001");
    expect(bug001).toBeDefined();
    expect(bug001!.priority).toBe("BLOCKER");
  });

  it("parses CRITICAL severity", () => {
    const profile = parseQualityProfile(xml);
    const s1067 = profile.rules.find((r) => r.key === "S1067");
    expect(s1067).toBeDefined();
    expect(s1067!.priority).toBe("CRITICAL");
  });

  it("parses MINOR severity", () => {
    const profile = parseQualityProfile(xml);
    const smell = profile.rules.find((r) => r.key === "smell-001");
    expect(smell).toBeDefined();
    expect(smell!.priority).toBe("MINOR");
  });

  it("parses INFO severity", () => {
    const profile = parseQualityProfile(xml);
    const s1135 = profile.rules.find((r) => r.key === "S1135");
    expect(s1135).toBeDefined();
    expect(s1135!.priority).toBe("INFO");
  });

  it("parses rule with single parameter", () => {
    const profile = parseQualityProfile(xml);
    const s1125 = profile.rules.find((r) => r.key === "S1125");
    expect(s1125!.parameters).toEqual({ max: "3" });
  });

  it("parses rule with multiple parameters", () => {
    const profile = parseQualityProfile(xml);
    const custom = profile.rules.find((r) => r.key === "custom-xyz-001");
    expect(custom!.parameters).toEqual({ threshold: "10", mode: "strict" });
  });

  it("handles empty XML gracefully", () => {
    const profile = parseQualityProfile("<profile></profile>");
    expect(profile.rules).toEqual([]);
    expect(profile.name).toBe("");
  });

  it("handles single rule (not array)", () => {
    const xml = `<profile><rules><rule><repositoryKey>ts</repositoryKey><key>S1</key></rule></rules></profile>`;
    const profile = parseQualityProfile(xml);
    expect(profile.rules.length).toBe(1);
    expect(profile.rules[0].key).toBe("S1");
  });

  it("ignores XML entities and DOCTYPE declarations", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <!DOCTYPE profile [
      <!ENTITY xxe SYSTEM "file:///etc/passwd">
    ]>
    <profile>
      <name>Test &xxe;</name>
      <language>java</language>
      <rules>
        <rule>
          <repositoryKey>java</repositoryKey>
          <key>S1234</key>
          <priority>MAJOR</priority>
        </rule>
      </rules>
    </profile>`;

    const result = parseQualityProfile(xml);
    expect(result.name).not.toContain("root:");
    expect(result.rules).toHaveLength(1);
  });

  it("handles malformed XML gracefully", () => {
    expect(() => parseQualityProfile("<invalid>")).not.toThrow();
  });
});

describe("parseIssueReport", () => {
  const json = readFixture("sample-issues.json");

  it("parses total count", () => {
    const report = parseIssueReport(json);
    expect(report.total).toBe(4);
  });

  it("parses all issues", () => {
    const report = parseIssueReport(json);
    expect(report.issues.length).toBe(4);
  });

  it("parses CODE_SMELL issue", () => {
    const report = parseIssueReport(json);
    const smell = report.issues.find((i) => i.type === "CODE_SMELL");
    expect(smell).toBeDefined();
    expect(smell!.severity).toBe("MAJOR");
    expect(smell!.component).toBe("src/utils.ts");
    expect(smell!.line).toBe(42);
  });

  it("parses VULNERABILITY issue", () => {
    const report = parseIssueReport(json);
    const vuln = report.issues.find((i) => i.type === "VULNERABILITY");
    expect(vuln).toBeDefined();
    expect(vuln!.severity).toBe("CRITICAL");
    expect(vuln!.component).toBe("src/auth.ts");
  });

  it("parses BUG issue", () => {
    const report = parseIssueReport(json);
    const bug = report.issues.find((i) => i.type === "BUG");
    expect(bug).toBeDefined();
    expect(bug!.severity).toBe("BLOCKER");
    expect(bug!.component).toBe("src/db.ts");
    expect(bug!.line).toBe(120);
  });

  it("handles empty issues array", () => {
    const report = parseIssueReport("[]");
    expect(report.issues).toEqual([]);
  });

  it("handles array without issues wrapper", () => {
    const report = parseIssueReport(`[{"rule":"r1","severity":"MINOR","component":"f.ts","message":"m"}]`);
    expect(report.issues.length).toBe(1);
  });

  it("throws for invalid JSON", () => {
    expect(() => parseIssueReport("not json")).toThrow("Invalid JSON");
  });
});

describe("severity weight mapping", () => {
  it("maps BLOCKER to 0.95", () => {
    const mapped = mapIssuesToRepoRank([{ rule: "r", severity: "BLOCKER", component: "f", message: "m" }]);
    expect(mapped[0].weight).toBe(0.95);
  });

  it("maps CRITICAL to 0.85", () => {
    const mapped = mapIssuesToRepoRank([{ rule: "r", severity: "CRITICAL", component: "f", message: "m" }]);
    expect(mapped[0].weight).toBe(0.85);
  });

  it("maps MAJOR to 0.7", () => {
    const mapped = mapIssuesToRepoRank([{ rule: "r", severity: "MAJOR", component: "f", message: "m" }]);
    expect(mapped[0].weight).toBe(0.7);
  });

  it("maps MINOR to 0.5", () => {
    const mapped = mapIssuesToRepoRank([{ rule: "r", severity: "MINOR", component: "f", message: "m" }]);
    expect(mapped[0].weight).toBe(0.5);
  });

  it("maps INFO to 0.25", () => {
    const mapped = mapIssuesToRepoRank([{ rule: "r", severity: "INFO", component: "f", message: "m" }]);
    expect(mapped[0].weight).toBe(0.25);
  });

  it("rule type BUG maps to reliability", () => {
    const mapped = mapIssuesToRepoRank([{ rule: "r", severity: "MAJOR", component: "f", message: "m", type: "BUG" }]);
    expect(mapped[0].category).toBe("reliability");
  });

  it("rule type VULNERABILITY maps to security", () => {
    const mapped = mapIssuesToRepoRank([{ rule: "r", severity: "MAJOR", component: "f", message: "m", type: "VULNERABILITY" }]);
    expect(mapped[0].category).toBe("security");
  });

  it("rule type CODE_SMELL maps to maintainability", () => {
    const mapped = mapIssuesToRepoRank([{ rule: "r", severity: "MAJOR", component: "f", message: "m", type: "CODE_SMELL" }]);
    expect(mapped[0].category).toBe("maintainability");
  });

  it("repository key containing 'bug' maps to reliability", () => {
    const mapped = mapProfileToRepoRank({
      name: "test",
      language: "ts",
      rules: [{ repositoryKey: "common-bug-toolkit", key: "r1" }],
    });
    expect(mapped[0].reporankCategory).toBe("reliability");
  });

  it("repository key containing 'vulnerability' maps to security", () => {
    const mapped = mapProfileToRepoRank({
      name: "test",
      language: "ts",
      rules: [{ repositoryKey: "vulnerability-scanner", key: "r1" }],
    });
    expect(mapped[0].reporankCategory).toBe("security");
  });
});

describe("parseQualityGate", () => {
  it("parses quality gate conditions", () => {
    const json = JSON.stringify({
      name: "Sonar way (default)",
      conditions: [
        { metric: "blocker_violations", op: "GT", error: "0" },
        { metric: "critical_violations", op: "GT", error: "0" },
        { metric: "code_smells", op: "GT", error: "100", warning: "50" },
        { metric: "coverage", op: "LT", error: "80" },
      ],
    });
    const gate = parseQualityGate(json);
    expect(gate.name).toBe("Sonar way (default)");
    expect(gate.conditions.length).toBe(4);
    expect(gate.conditions[0].metric).toBe("blocker_violations");
    expect(gate.conditions[0].op).toBe("GT");
    expect(gate.conditions[2].error).toBe("100");
    expect(gate.conditions[2].warning).toBe("50");
  });

  it("maps quality gate conditions to RepoRank thresholds", () => {
    const json = JSON.stringify({
      name: "gate",
      conditions: [
        { metric: "blocker_violations", op: "GT", error: "0" },
        { metric: "coverage", op: "LT", error: "80" },
        { metric: "sqale_rating", op: "GT", error: "3", warning: "2" },
      ],
    });
    const gate = parseQualityGate(json);
    const thresholds = mapQualityGateToThresholds(gate);
    expect(thresholds.length).toBe(3);
    expect(thresholds[0].metric).toBe("blockers");
    expect(thresholds[1].metric).toBe("test_coverage");
    expect(thresholds[2].metric).toBe("maintainability_rating");
  });

  it("handles empty quality gate", () => {
    const gate = parseQualityGate("{}");
    expect(gate.conditions).toEqual([]);
  });

  it("throws for invalid JSON", () => {
    expect(() => parseQualityGate("not json")).toThrow("Invalid JSON");
  });
});

describe("generateMigrationReport", () => {
  const xml = readFixture("sample-profile.xml");

  it("generates report with profile and issues", () => {
    const profile = parseQualityProfile(xml);
    const issues = parseIssueReport(readFixture("sample-issues.json"));
    const report = generateMigrationReport(profile, issues.issues, null);

    expect(report.source).toBe("sonarqube");
    expect(report.profileName).toBe("Sonar way (TypeScript)");
    expect(report.language).toBe("ts");
    expect(report.totalRules).toBe(8);
    expect(report.totalIssues).toBe(4);
    expect(report.mappedRules.length).toBe(8);
    expect(report.mappedIssues.length).toBe(4);
    expect(report.coverage.total).toBe(8);
    expect(report.summary).toContain("8 rule(s)");
    expect(report.summary).toContain("4 issue(s)");
  });

  it("marks unknown plugin rules as unmapped", () => {
    const profile = parseQualityProfile(xml);
    const report = generateMigrationReport(profile, null, null);
    expect(report.unmappedRuleTypes).toContain("unknown-plugin");
  });

  it("reports coverage percent", () => {
    const profile = parseQualityProfile(xml);
    const report = generateMigrationReport(profile, null, null);
    expect(report.coverage.percent).toBeGreaterThan(0);
    expect(report.coverage.percent).toBeLessThanOrEqual(100);
  });

  it("returns zeroes for empty inputs", () => {
    const report = generateMigrationReport(null, null, null);
    expect(report.totalRules).toBe(0);
    expect(report.totalIssues).toBe(0);
    expect(report.coverage.percent).toBe(100);
    expect(report.summary).toContain("No SonarQube rules imported");
  });
});

describe("generateRepoRankConfig", () => {
  it("generates a valid config object", () => {
    const xml = readFixture("sample-profile.xml");
    const profile = parseQualityProfile(xml);
    const report = generateMigrationReport(profile, null, null);

    const config = generateRepoRankConfig(report);
    expect(config.generator).toBe("reporank import sonarqube");
    expect(config.generatedAt).toBeTruthy();
    expect(Array.isArray(config.rules)).toBe(true);
    expect((config.rules as unknown[]).length).toBe(8);
    expect(config.migrationCoverage).toBeDefined();
  });

  it("includes threshold config when quality gate provided", () => {
    const json = JSON.stringify({
      name: "gate",
      conditions: [{ metric: "blocker_violations", op: "GT", error: "0" }],
    });
    const gate = parseQualityGate(json);
    const profile = parseQualityProfile(readFixture("sample-profile.xml"));
    const report = generateMigrationReport(profile, null, gate);

    const config = generateRepoRankConfig(report);
    expect(config.thresholds).toBeDefined();
    const thresholds = config.thresholds as Record<string, unknown>;
    expect(thresholds.blockers).toBeDefined();
  });

  it("exported rules have correct shape", () => {
    const xml = readFixture("sample-profile.xml");
    const profile = parseQualityProfile(xml);
    const report = generateMigrationReport(profile, null, null);

    const config = generateRepoRankConfig(report);
    const firstRule = (config.rules as Record<string, unknown>[])[0];
    expect(firstRule.ruleKey).toBeDefined();
    expect(firstRule.source).toBeDefined();
    expect(typeof firstRule.weight).toBe("number");
    expect(firstRule.category).toBeDefined();
  });
});
