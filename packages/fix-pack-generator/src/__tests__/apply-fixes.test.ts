import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import {
  applyFixes,
  checkCleanWorkingTree,
  validatePatch,
  applyOnePatch,
} from "../apply-fixes";
import type { GeneratedPatch } from "../patchBuilder";

const TEST_DIR = join(tmpdir(), "reporank-apply-fixes-test-" + Date.now());

function git(cmd: string): string {
  return execSync(cmd, {
    cwd: TEST_DIR,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

function setupGitRepo(): void {
  rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(TEST_DIR, { recursive: true });
  execSync("git init", { cwd: TEST_DIR, stdio: ["pipe", "pipe", "pipe"] });
  execSync('git config user.email "test@test.com"', {
    cwd: TEST_DIR,
    stdio: ["pipe", "pipe", "pipe"],
  });
  execSync('git config user.name "Test"', {
    cwd: TEST_DIR,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

beforeEach(() => {
  setupGitRepo();
});

afterEach(() => {
  try {
    rmSync(TEST_DIR, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

describe("checkCleanWorkingTree", () => {
  it("returns true for a fresh git repo", () => {
    expect(checkCleanWorkingTree(TEST_DIR)).toBe(true);
  });

  it("returns false for a dirty tree", () => {
    writeFileSync(join(TEST_DIR, "test.txt"), "hello");
    expect(checkCleanWorkingTree(TEST_DIR)).toBe(false);
  });

  it("throws for non-git directory", () => {
    const nonGit = join(tmpdir(), "reporank-no-git-" + Date.now());
    mkdirSync(nonGit, { recursive: true });
    try {
      expect(() => checkCleanWorkingTree(nonGit)).toThrow(/git/);
    } finally {
      rmSync(nonGit, { recursive: true, force: true });
    }
  });
});

describe("validatePatch", () => {
  it("validates a valid create patch", () => {
    const patch: GeneratedPatch = {
      filePath: "newfile.txt",
      title: "Create new file",
      type: "create",
      content: "hello world",
      description: "test",
    };
    expect(validatePatch(patch, TEST_DIR)).toBeNull();
  });

  it("rejects create patch for existing file", () => {
    writeFileSync(join(TEST_DIR, "existing.txt"), "already here");
    const patch: GeneratedPatch = {
      filePath: "existing.txt",
      title: "Create new file",
      type: "create",
      content: "hello world",
      description: "test",
    };
    expect(validatePatch(patch, TEST_DIR)).toContain("already exists");
  });

  it("validates a valid modify patch", () => {
    writeFileSync(join(TEST_DIR, "modify.txt"), "hello world");
    const patch: GeneratedPatch = {
      filePath: "modify.txt",
      title: "Modify file",
      type: "modify",
      oldText: "hello",
      newText: "goodbye",
      description: "test",
    };
    expect(validatePatch(patch, TEST_DIR)).toBeNull();
  });

  it("rejects modify patch when oldText not found", () => {
    writeFileSync(join(TEST_DIR, "modify.txt"), "hello world");
    const patch: GeneratedPatch = {
      filePath: "modify.txt",
      title: "Modify file",
      type: "modify",
      oldText: "nonexistent",
      newText: "replacement",
      description: "test",
    };
    expect(validatePatch(patch, TEST_DIR)).toContain("not found");
  });

  it("rejects modify patch with ambiguous oldText", () => {
    writeFileSync(join(TEST_DIR, "dup.txt"), "hello hello world");
    const patch: GeneratedPatch = {
      filePath: "dup.txt",
      title: "Modify file",
      type: "modify",
      oldText: "hello",
      newText: "hi",
      description: "test",
    };
    expect(validatePatch(patch, TEST_DIR)).toContain("Ambiguous");
  });
});

describe("applyOnePatch", () => {
  it("creates a new file", () => {
    const patch: GeneratedPatch = {
      filePath: "created.txt",
      title: "Create file",
      type: "create",
      content: "new content",
      description: "test",
    };
    applyOnePatch(patch, TEST_DIR);
    const content = readFileSync(join(TEST_DIR, "created.txt"), "utf-8");
    expect(content).toBe("new content");
  });

  it("modifies an existing file", () => {
    writeFileSync(join(TEST_DIR, "mod.txt"), "before after");
    const patch: GeneratedPatch = {
      filePath: "mod.txt",
      title: "Modify file",
      type: "modify",
      oldText: "before",
      newText: "replaced",
      description: "test",
    };
    applyOnePatch(patch, TEST_DIR);
    const content = readFileSync(join(TEST_DIR, "mod.txt"), "utf-8");
    expect(content).toBe("replaced after");
  });
});

describe("applyFixes — dry-run", () => {
  it("shows dry-run output for create patches", async () => {
    const patches: GeneratedPatch[] = [
      {
        filePath: "dry-create.txt",
        title: "Create file",
        type: "create",
        content: "content here",
        description: "test create",
        category: "deployment",
      },
    ];
    const result = await applyFixes(patches, {
      workingDir: TEST_DIR,
      dryRun: true,
    });
    expect(result.dryRun).toBe(true);
    expect(result.dryRunOutput.length).toBeGreaterThan(0);
    expect(result.dryRunOutput.some((l) => l.includes("CREATE"))).toBe(true);
    expect(existsSync(join(TEST_DIR, "dry-create.txt"))).toBe(false);
  });

  it("shows dry-run output for modify patches", async () => {
    writeFileSync(join(TEST_DIR, "dry-mod.txt"), "original text here");
    const patches: GeneratedPatch[] = [
      {
        filePath: "dry-mod.txt",
        title: "Modify file",
        type: "modify",
        oldText: "original",
        newText: "modified",
        description: "test modify",
        category: "quality",
      },
    ];
    const result = await applyFixes(patches, {
      workingDir: TEST_DIR,
      dryRun: true,
    });
    expect(result.dryRun).toBe(true);
    expect(result.dryRunOutput.some((l) => l.includes("MODIFY"))).toBe(true);
    const content = readFileSync(join(TEST_DIR, "dry-mod.txt"), "utf-8");
    expect(content).toBe("original text here");
  });
});

describe("applyFixes — single fix", () => {
  it("applies and commits a single modify patch", async () => {
    writeFileSync(join(TEST_DIR, "single.ts"), "const x: any = 1;\n");
    execSync("git add single.ts", { cwd: TEST_DIR, stdio: ["pipe", "pipe", "pipe"] });
    execSync('git commit -m "initial"', { cwd: TEST_DIR, stdio: ["pipe", "pipe", "pipe"] });

    const patches: GeneratedPatch[] = [
      {
        filePath: "single.ts",
        title: "fix: replace any with unknown",
        type: "modify",
        oldText: "const x: any = 1;",
        newText: "const x: unknown = 1;",
        description: "Replace any type",
        category: "quality",
      },
    ];

    const result = await applyFixes(patches, {
      workingDir: TEST_DIR,
      dryRun: false,
    });

    expect(result.applied.length).toBe(1);
    expect(result.failed.length).toBe(0);
    expect(result.commitShas.length).toBe(1);

    const content = readFileSync(join(TEST_DIR, "single.ts"), "utf-8");
    expect(content).toContain("const x: unknown = 1;");
  });
});

describe("applyFixes — all fixes", () => {
  it("applies and commits multiple patches grouped by category", async () => {
    writeFileSync(join(TEST_DIR, "a.ts"), "const a: any = 1;\n");
    writeFileSync(join(TEST_DIR, "b.ts"), "const b: any = 2;\n");
    execSync("git add a.ts b.ts", { cwd: TEST_DIR, stdio: ["pipe", "pipe", "pipe"] });
    execSync('git commit -m "initial"', { cwd: TEST_DIR, stdio: ["pipe", "pipe", "pipe"] });

    const patches: GeneratedPatch[] = [
      {
        filePath: "a.ts",
        title: "fix: replace any",
        type: "modify",
        oldText: "const a: any = 1;",
        newText: "const a: unknown = 1;",
        description: "Replace any in a.ts",
        category: "quality",
      },
      {
        filePath: "b.ts",
        title: "fix: replace any",
        type: "modify",
        oldText: "const b: any = 2;",
        newText: "const b: unknown = 2;",
        description: "Replace any in b.ts",
        category: "quality",
      },
      {
        filePath: ".env.example",
        title: "Create env example",
        type: "create",
        content: "PORT=3000\n",
        description: "Missing env template",
        category: "deployment",
      },
    ];

    const result = await applyFixes(patches, {
      workingDir: TEST_DIR,
      dryRun: false,
    });

    expect(result.applied.length).toBe(3);
    expect(result.failed.length).toBe(0);
    // Two commits: one for quality, one for deployment
    expect(result.commitShas.length).toBe(2);

    expect(readFileSync(join(TEST_DIR, "a.ts"), "utf-8")).toContain("unknown");
    expect(readFileSync(join(TEST_DIR, "b.ts"), "utf-8")).toContain("unknown");
    expect(readFileSync(join(TEST_DIR, ".env.example"), "utf-8")).toContain("PORT=3000");
  });
});

describe("applyFixes — dirty tree", () => {
  it("refuses to apply on dirty working tree", async () => {
    writeFileSync(join(TEST_DIR, "dirty.ts"), "uncommitted\n");
    // No git add + commit → dirty tree
    const patches: GeneratedPatch[] = [
      {
        filePath: "dirty.ts",
        title: "fix",
        type: "modify",
        oldText: "uncommitted",
        newText: "fixed",
        description: "test",
      },
    ];

    const result = await applyFixes(patches, {
      workingDir: TEST_DIR,
      dryRun: false,
    });

    expect(result.applied.length).toBe(0);
    expect(result.failed.length).toBe(1);
    expect(result.failed[0].error).toContain("dirty");
  });
});

describe("applyFixes — interactive mode", () => {
  it("applies patches when user says yes", async () => {
    writeFileSync(join(TEST_DIR, "inter.ts"), "const a: any = 1;\n");
    execSync("git add inter.ts", { cwd: TEST_DIR, stdio: ["pipe", "pipe", "pipe"] });
    execSync('git commit -m "initial"', { cwd: TEST_DIR, stdio: ["pipe", "pipe", "pipe"] });

    const patches: GeneratedPatch[] = [
      {
        filePath: "inter.ts",
        title: "fix: replace any",
        type: "modify",
        oldText: "const a: any = 1;",
        newText: "const a: unknown = 1;",
        description: "Replace any",
        category: "quality",
      },
    ];

    const result = await applyFixes(patches, {
      workingDir: TEST_DIR,
      dryRun: false,
      interactive: true,
      interactionPrompt: () => Promise.resolve("y"),
    });

    expect(result.applied.length).toBe(1);
  });

  it("skips patches when user says no", async () => {
    writeFileSync(join(TEST_DIR, "skip.ts"), "const a: any = 1;\n");
    execSync("git add skip.ts", { cwd: TEST_DIR, stdio: ["pipe", "pipe", "pipe"] });
    execSync('git commit -m "initial"', { cwd: TEST_DIR, stdio: ["pipe", "pipe", "pipe"] });

    const patches: GeneratedPatch[] = [
      {
        filePath: "skip.ts",
        title: "fix: replace any",
        type: "modify",
        oldText: "const a: any = 1;",
        newText: "const a: unknown = 1;",
        description: "Replace any",
        category: "quality",
      },
    ];

    const result = await applyFixes(patches, {
      workingDir: TEST_DIR,
      dryRun: false,
      interactive: true,
      interactionPrompt: () => Promise.resolve("n"),
    });

    expect(result.skipped.length).toBe(1);
    expect(result.applied.length).toBe(0);
  });
});

describe("applyFixes — backup ref", () => {
  it("returns a commit sha for applied fixes", async () => {
    writeFileSync(join(TEST_DIR, "backup-test.ts"), "const a: any = 1;\n");
    execSync("git add backup-test.ts", { cwd: TEST_DIR, stdio: ["pipe", "pipe", "pipe"] });
    execSync('git commit -m "initial"', { cwd: TEST_DIR, stdio: ["pipe", "pipe", "pipe"] });

    const patches: GeneratedPatch[] = [
      {
        filePath: "backup-test.ts",
        title: "fix: replace any",
        type: "modify",
        oldText: "const a: any = 1;",
        newText: "const a: unknown = 1;",
        description: "Replace any",
        category: "quality",
      },
    ];

    const result = await applyFixes(patches, {
      workingDir: TEST_DIR,
      dryRun: false,
    });

    expect(result.commitShas.length).toBe(1);
    // The backup branch should exist
    const branches = git("git branch");
    expect(branches).toContain("reporank-backup-");
  });
});
