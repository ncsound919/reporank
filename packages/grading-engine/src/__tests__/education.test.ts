import { describe, it, expect } from "vitest";
import { auditSubmission, type CourseGuideline, type SubmissionInput } from "../analyzers/education";

const basicGuidelines: CourseGuideline[] = [
  { id: "use-types", description: "Use type annotations for variables", category: "naming", enforced: true },
  { id: "add-tests", description: "Include at least one test file", category: "testing", enforced: true },
  { id: "no-eval", description: "Never use eval()", category: "performance", enforced: true },
  { id: "comment-code", description: "Add explanatory comments", category: "documentation", enforced: false },
];

const humanSubmission: SubmissionInput = {
  studentId: "student-1",
  assignmentId: "hw1",
  language: "TypeScript",
  sourceFiles: [
    {
      path: "src/solution.ts",
      content: `// Calculate factorial recursively
// This handles edge cases for n = 0 and n = 1
function factorial(n: number): number {
  if (n <= 1) {
    return 1;
  }
  return n * factorial(n - 1);
}

const result = factorial(5);
process.stdout.write(result);
`,
    },
    {
      path: "src/solution.test.ts",
      content: `import { factorial } from "./solution";
it("factorial of 5", () => { expect(factorial(5)).toBe(120); });
`,
    },
  ],
  guidelines: basicGuidelines,
};

const aiLikelySubmission: SubmissionInput = {
  studentId: "student-2",
  assignmentId: "hw1",
  language: "TypeScript",
  sourceFiles: [
    {
      path: "src/solution.ts",
      content: `import { useState, useEffect, useMemo, useCallback, useRef, useContext, useReducer, useImperativeHandle, useLayoutEffect, useDebugValue } from 'react';
class AbstractFactoryBuilder<T> { create(): T { return null as any; } }
class StrategyPatternImplA extends AbstractFactoryBuilder<number> { create(): number { return 42; } }
class StrategyPatternImplB extends AbstractFactoryBuilder<string> { create(): string { return "hello world"; } }
class AbstractFactoryImpl2<T> { create(): T { return null as any; } }
class AbstractFactoryImpl3<T> { create(): T { return null as any; } }
async function processData(input: any): Promise<any> {
  const result = await fetch("/api");
  return result.json();
}
async function processData2(input: any): Promise<any> {
  const result = await fetch("/api");
  return result.json();
}
async function processData3(input: any): Promise<any> {
  const result = await fetch("/api");
  return result.json();
}
const x: any = 1;
const y: any = 2;
const z: any = 3;
function deeplyNested() { if (a) { if (b) { if (c) { if (d) { if (e) { if (f) { if (g) { if (h) { doStuff(); } } } } } } } }
`,
    },
  ],
  guidelines: basicGuidelines,
};

describe("auditSubmission", () => {
  it("audits a clean human submission with high score", () => {
    const report = auditSubmission(humanSubmission);
    expect(report.overallScore).toBeGreaterThan(60);
    expect(report.overallGrade).not.toBe("F");
    expect(report.integrity.aiContaminationScore).toBeLessThan(50);
    expect(report.integrity.sessionConsistency).toBe("human-like");
  });

  it("flags AI-likely submission with high contamination", () => {
    const report = auditSubmission(aiLikelySubmission);
    expect(report.integrity.aiContaminationScore).toBeGreaterThan(30);
    expect(["mixed", "ai-likely", "pure-ai"]).toContain(report.integrity.sessionConsistency);
  });

  it("builds Layer 1 with basic stats", () => {
    const report = auditSubmission(humanSubmission);
    expect(report.layers.layer1.runs).toBe(true);
    expect(report.layers.layer1.totalFiles).toBe(2);
    expect(report.layers.layer1.primaryLanguage).toBe("TypeScript");
    expect(report.layers.layer1.hasComments).toBe(true);
    expect(report.layers.layer1.whatItDoes).toMatch(/file/);
  });

  it("builds Layer 2 with improvements", () => {
    const report = auditSubmission(humanSubmission);
    expect(report.layers.layer2.improvements.length).toBeGreaterThan(0);
    expect(report.layers.layer2.estimatedScoreBoost).toBeGreaterThanOrEqual(0);
  });

  it("does NOT build Layer 3 when not unlocked", () => {
    const report = auditSubmission(humanSubmission, [1]);
    expect(report.layers.layer3.patternsToAdopt).toHaveLength(0);
  });

  it("builds Layer 3 when unlocked", () => {
    const report = auditSubmission(humanSubmission, [1, 3]);
    expect(report.layers.layer3.patternsToAdopt).toBeDefined();
    expect(report.layers.layer3.seniorityLevel).toBeDefined();
  });

  it("builds Layer 4 with AI contamination score", () => {
    const report = auditSubmission(humanSubmission);
    expect(report.layers.layer4.aiContaminationScore).toBeGreaterThanOrEqual(0);
  });

  it("reports guideline violations", () => {
    const report = auditSubmission(humanSubmission);
    expect(report.integrity.guidelineViolations).toHaveLength(basicGuidelines.length);
    const testViolation = report.integrity.guidelineViolations.find(v => v.guideline.id === "add-tests");
    expect(testViolation).toBeDefined();
    expect(testViolation!.matched).toBe(true); // Has a test file
  });

  it("flags plagiarism risk for repeated lines", () => {
    const plagiarized: SubmissionInput = {
      ...humanSubmission,
      sourceFiles: [{
        path: "src/x.ts",
        content: "const veryLongRepeatedLineOfCode = 'value';\n".repeat(10),
      }],
    };
    const report = auditSubmission(plagiarized);
    expect(["medium", "high"]).toContain(report.integrity.plagiarismRisk);
  });

  it("respects DisclosureLayer argument", () => {
    const report = auditSubmission(humanSubmission, [1, 2, 3, 4]);
    expect(report.unlockedLayers).toEqual([1, 2, 3, 4]);
  });

  it("returns timestamp", () => {
    const report = auditSubmission(humanSubmission);
    expect(report.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("handles empty submission gracefully", () => {
    const empty: SubmissionInput = {
      studentId: "x", assignmentId: "y", language: "Python",
      sourceFiles: [], guidelines: [],
    };
    const report = auditSubmission(empty);
    expect(report.layers.layer1.runs).toBe(false);
    expect(report.layers.layer1.totalFiles).toBe(0);
  });
});

describe("integrity classifications", () => {
  it("classifies pure-ai for high contamination", () => {
    const pureAI: SubmissionInput = {
      ...humanSubmission,
      sourceFiles: [{
        path: "src/x.ts",
        content: `import a from 'a';
import b from 'b';
import c from 'c';
async function foo(): any { const x = await fetch(); return x; }
async function bar(): any { const x = await fetch(); return x; }
async function baz(): any { const x = await fetch(); return x; }
class AbstractFactory<T> {}
class StrategyPatternImpl<T> {}
class StrategyPatternImpl2<T> {}
class StrategyPatternImpl3<T> {}
class StrategyPatternImpl4<T> {}
const any1: any = 1;
const any2: any = 2;
const any3: any = 3;
const any4: any = 4;
const any5: any = 5;
`,
      }],
    };
    const report = auditSubmission(pureAI);
    expect(report.integrity.aiContaminationScore).toBeGreaterThan(20);
  });
});
