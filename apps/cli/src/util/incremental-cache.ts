import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Finding } from "../review_scanner";

interface CacheEntry {
  hash: string;
  findings: Finding[];
  timestamp: number;
}

export class IncrementalCache {
  private entries = new Map<string, CacheEntry>();
  private dirty = false;

  constructor(private cachePath: string) {
    this.load();
  }

  private load(): void {
    if (!existsSync(this.cachePath)) return;
    try {
      const data = JSON.parse(readFileSync(this.cachePath, "utf-8"));
      this.entries = new Map(Object.entries(data));
    } catch {
      this.entries = new Map();
    }
  }

  flush(): void {
    if (!this.dirty) return;
    mkdirSync(dirname(this.cachePath), { recursive: true });
    const obj = Object.fromEntries(this.entries);
    writeFileSync(this.cachePath, JSON.stringify(obj, null, 2));
    this.dirty = false;
  }

  private hashContent(filePath: string): string {
    const content = readFileSync(filePath, "utf-8");
    return createHash("sha256").update(content).digest("hex");
  }

  get(filePath: string): Finding[] | null {
    const entry = this.entries.get(filePath);
    if (!entry) return null;
    try {
      const currentHash = this.hashContent(filePath);
      if (entry.hash !== currentHash) return null;
    } catch {
      return null;
    }
    return entry.findings;
  }

  set(filePath: string, findings: Finding[]): void {
    try {
      const hash = this.hashContent(filePath);
      this.entries.set(filePath, { hash, findings, timestamp: Date.now() });
      this.dirty = true;
    } catch {
      // File deleted or unreadable — skip
    }
  }
}
