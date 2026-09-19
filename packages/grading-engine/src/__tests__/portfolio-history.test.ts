import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  diffSnapshots,
  loadHistory,
  recordSnapshot,
  resolveHistoryPath,
  snapshotFromIndex,
} from "../portfolio/history";
import type { StructuralIndex } from "../analyzers/structural-index";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "reporank-history-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function makeIndex(index: number, dimensions: Record<string, number>): StructuralIndex {
  const names = Object.keys(dimensions);
  return {
    index,
    unmeasured: [],
    normalization: { cohort: "typescript:m", baseline: 1, normalizedIndex: index },
    contributions: names.map((dimension) => ({
      dimension,
      score: dimensions[dimension],
      weight: 1 / names.length,
      raw: 0,
      baseline: 1,
      findings: [],
    })),
    formula: "test",
  };
}

describe("history persistence", () => {
  it("writes a snapshot to the default .reporank/history.json", () => {
    const snapshot = snapshotFromIndex(makeIndex(80, { security: 80 }), "abc123", "2026-01-01T00:00:00.000Z");
    const result = recordSnapshot(tmp, snapshot);

    expect(result.historyPath).toBe(join(tmp, ".reporank", "history.json"));
    expect(existsSync(result.historyPath)).toBe(true);

    const reloaded = loadHistory(tmp);
    expect(reloaded.snapshots).toHaveLength(1);
    expect(reloaded.snapshots[0].index).toBe(80);
    expect(reloaded.cursor).toEqual({ lastCommit: "abc123", lastScannedAt: "2026-01-01T00:00:00.000Z" });
  });

  it("appends across invocations and survives a fresh load", () => {
    recordSnapshot(tmp, snapshotFromIndex(makeIndex(80, { security: 80 }), "c1", "2026-01-01T00:00:00.000Z"));
    recordSnapshot(tmp, snapshotFromIndex(makeIndex(70, { security: 70 }), "c2", "2026-01-02T00:00:00.000Z"));

    const reloaded = loadHistory(tmp);
    expect(reloaded.snapshots.map((s) => s.index)).toEqual([80, 70]);
    expect(reloaded.cursor.lastCommit).toBe("c2");
  });

  it("honours REPORANK_HISTORY_DIR from the environment", () => {
    const dir = join(tmp, "custom");
    expect(resolveHistoryPath(tmp, { env: { REPORANK_HISTORY_DIR: dir } })).toBe(join(dir, "history.json"));
  });

  it("degrades to an empty store on a corrupt file", () => {
    const path = join(tmp, ".reporank", "history.json");
    mkdirSync(join(tmp, ".reporank"), { recursive: true });
    writeFileSync(path, "{ not json", "utf-8");
    expect(existsSync(path)).toBe(true);
    const store = loadHistory(tmp);
    expect(store.snapshots).toEqual([]);
    expect(store.cursor.lastCommit).toBeNull();
  });

  it("reads history.dir from reporank.config.json", () => {
    writeFileSync(join(tmp, "reporank.config.json"), JSON.stringify({ history: { dir: "state" } }), "utf-8");
    expect(resolveHistoryPath(tmp)).toBe(join(tmp, "state", "history.json"));
  });
});

describe("drift alerts", () => {
  it("alerts on a dimension that drops past the default threshold", () => {
    const previous = snapshotFromIndex(makeIndex(80, { security: 80, complexity: 80 }), "c1", "t1");
    const current = snapshotFromIndex(makeIndex(60, { security: 60, complexity: 78 }), "c2", "t2");
    const alerts = diffSnapshots(previous, current);

    const security = alerts.find((a) => a.dimension === "security");
    expect(security).toBeDefined();
    expect(security!.delta).toBe(-20);
    expect(security!.threshold).toBe(5);
    expect(alerts.find((a) => a.dimension === "complexity")).toBeUndefined();
  });

  it("does not alert when thresholds are configured high enough", () => {
    const previous = snapshotFromIndex(makeIndex(80, { security: 80 }), "c1", "t1");
    const current = snapshotFromIndex(makeIndex(60, { security: 60 }), "c2", "t2");
    const alerts = diffSnapshots(previous, current, { drift: { threshold: 50 } });
    expect(alerts).toEqual([]);
  });

  it("supports per-dimension threshold overrides", () => {
    const previous = snapshotFromIndex(makeIndex(80, { security: 80, complexity: 80 }), "c1", "t1");
    const current = snapshotFromIndex(makeIndex(79, { security: 79, complexity: 60 }), "c2", "t2");
    const alerts = diffSnapshots(previous, current, { drift: { threshold: 50, dimensions: { complexity: 5 } } });
    expect(alerts.map((a) => a.dimension)).toEqual(["complexity"]);
  });

  it("records alerts against the previous snapshot", () => {
    recordSnapshot(tmp, snapshotFromIndex(makeIndex(90, { security: 90 }), "c1", "t1"));
    const result = recordSnapshot(tmp, snapshotFromIndex(makeIndex(40, { security: 40 }), "c2", "t2"));
    expect(result.previous?.index).toBe(90);
    expect(result.alerts.some((a) => a.dimension === "security" && a.delta === -50)).toBe(true);
  });

  it("never alerts on an improvement", () => {
    const previous = snapshotFromIndex(makeIndex(40, { security: 40 }), "c1", "t1");
    const current = snapshotFromIndex(makeIndex(90, { security: 90 }), "c2", "t2");
    expect(diffSnapshots(previous, current)).toEqual([]);
  });
});
