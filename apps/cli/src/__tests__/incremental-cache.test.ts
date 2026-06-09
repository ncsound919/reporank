import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { IncrementalCache } from "../util/incremental-cache";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("IncrementalCache", () => {
  let tmpDir: string;
  let cachePath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "cache-test-"));
    cachePath = join(tmpDir, "cache.json");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns null for unseen file", () => {
    const cache = new IncrementalCache(cachePath);
    expect(cache.get("nonexistent.ts")).toBeNull();
  });

  it("stores and retrieves findings", () => {
    const cache = new IncrementalCache(cachePath);
    const file = join(tmpDir, "test.ts");
    writeFileSync(file, "const x = 1;");
    const findings: any[] = [{ category: "security", type: "xss", line: 1 }];
    cache.set(file, findings);
    const loaded = cache.get(file);
    expect(loaded).toEqual(findings);
  });

  it("invalidates when file changes", () => {
    const cache = new IncrementalCache(cachePath);
    const file = join(tmpDir, "test.ts");
    writeFileSync(file, "const x = 1;");
    cache.set(file, [{ category: "security", type: "xss", line: 1 } as any]);
    expect(cache.get(file)).not.toBeNull();
    writeFileSync(file, "const x = 2;");
    expect(cache.get(file)).toBeNull();
  });

  it("persists across instances", () => {
    const cache1 = new IncrementalCache(cachePath);
    const file = join(tmpDir, "test.ts");
    writeFileSync(file, "const x = 1;");
    cache1.set(file, [{ category: "security", type: "xss", line: 1 } as any]);
    cache1.flush();
    const cache2 = new IncrementalCache(cachePath);
    expect(cache2.get(file)).not.toBeNull();
  });
});
