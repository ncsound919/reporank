import { describe, it, expect } from "vitest";
import { buildCrossRepoReport, codeFingerprint } from "../portfolio/cross-repo";

const SHARED_IMPL = `export function reconcile(ledger, entries) {
  const totals = new Map();
  for (const entry of entries) {
    const current = totals.get(entry.account) || 0;
    const delta = entry.credit - entry.debit;
    totals.set(entry.account, current + delta);
  }
  const drift = [...totals.values()].filter((value) => value !== 0);
  if (drift.length > 0) {
    return { balanced: false, drift };
  }
  return { balanced: true, drift: [] };
}
`;

const UNRELATED_IMPL = `class WeatherStation {
  sample(temp, humidity) {
    this.readings.push({ temp, humidity });
    return this.readings.length;
  }
}
`;

const OPTIONS = { shingleSize: 5, minSharedShingles: 3, minSimilarity: 0.9 };

describe("codeFingerprint", () => {
  it("is stable across cosmetic changes (comments, strings, whitespace)", () => {
    const a = codeFingerprint(SHARED_IMPL);
    const b = codeFingerprint(`// a comment\n${SHARED_IMPL}\n   `);
    const c = codeFingerprint(SHARED_IMPL.replace("ledger", "accountBook"));
    expect(a.size).toBeGreaterThan(3);
    expect([...b].sort()).toEqual([...a].sort());
    expect([...c].sort()).not.toEqual([...a].sort());
  });
});

describe("buildCrossRepoReport", () => {
  it("detects duplicated implementations across repos but not within one", () => {
    const report = buildCrossRepoReport(
      [
        {
          name: "alpha",
          sourceFiles: [
            { path: "src/reconcile.ts", content: SHARED_IMPL },
            { path: "src/reconcile-copy.ts", content: SHARED_IMPL },
          ],
        },
        { name: "beta", sourceFiles: [{ path: "lib/reconcile.ts", content: SHARED_IMPL }] },
        { name: "gamma", sourceFiles: [{ path: "src/weather.ts", content: UNRELATED_IMPL }] },
      ],
      OPTIONS,
    );

    const crossRepo = report.duplicates.filter((d) => d.a.repo !== d.b.repo);
    expect(crossRepo.length).toBe(2);
    for (const duplicate of crossRepo) {
      expect([duplicate.a.repo, duplicate.b.repo].sort()).toEqual(["alpha", "beta"]);
      expect(duplicate.similarity).toBe(1);
      expect(duplicate.sharedShingles).toBeGreaterThanOrEqual(3);
    }
    expect(report.duplicates.every((d) => d.a.repo !== d.b.repo)).toBe(true);
  });

  it("does not flag unrelated files as duplicates", () => {
    const report = buildCrossRepoReport(
      [
        { name: "alpha", sourceFiles: [{ path: "src/a.ts", content: SHARED_IMPL }] },
        { name: "gamma", sourceFiles: [{ path: "src/w.ts", content: UNRELATED_IMPL }] },
      ],
      OPTIONS,
    );
    expect(report.duplicates).toEqual([]);
  });

  it("resolves cross-repo dependency edges by package name", () => {
    const report = buildCrossRepoReport([
      {
        name: "app",
        sourceFiles: [{ path: "src/index.ts", content: 'import { reconcile } from "shared-lib";\nexport const x = reconcile;\n' }],
      },
      {
        name: "shared",
        packageName: "shared-lib",
        sourceFiles: [{ path: "src/index.ts", content: "export const reconcile = () => 0;\n" }],
      },
    ]);

    expect(report.edges).toHaveLength(1);
    expect(report.edges[0]).toMatchObject({ from: "app", to: "shared", specifier: "shared-lib", count: 1 });
    expect(report.graph.nodes).toEqual(["app", "shared"]);
    expect(report.graph.edges).toEqual(["app -> shared (shared-lib)"]);
  });

  it("does not create a self edge when a repo imports its own name", () => {
    const report = buildCrossRepoReport([
      {
        name: "app",
        packageName: "app",
        sourceFiles: [{ path: "src/index.ts", content: 'import helper from "app/helper";\nexport default helper;\n' }],
      },
    ]);
    expect(report.edges).toEqual([]);
  });
});
