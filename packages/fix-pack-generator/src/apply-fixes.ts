import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname, sep } from "node:path";
import { mkdirSync } from "node:fs";
import { execSync, execFileSync } from "node:child_process";
import type { GeneratedPatch } from "./patchBuilder";

export interface ApplyFixesOptions {
  workingDir: string;
  dryRun?: boolean;
  interactive?: boolean;
  /** Optional stdin-like readline function for interactive mode */
  interactionPrompt?: (question: string) => Promise<string>;
}

export interface ApplyFixesResult {
  total: number;
  applied: GeneratedPatch[];
  skipped: GeneratedPatch[];
  failed: { patch: GeneratedPatch; error: string }[];
  dryRun: boolean;
  dryRunOutput: string[];
  dryRunWouldApply: GeneratedPatch[];
  commitShas: string[];
}

function resolvePath(workingDir: string, filePath: string): string {
  const workspaceRoot = resolve(workingDir);
  const abs = resolve(workspaceRoot, filePath);
  if (!abs.startsWith(workspaceRoot + sep) && abs !== workspaceRoot) {
    throw new Error(`Path traversal blocked: ${filePath} resolves outside workspace`);
  }
  return abs;
}

function checkCleanWorkingTree(workingDir: string): boolean {
  try {
    const status = execSync("git status --porcelain", {
      cwd: workingDir,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return status.trim() === "";
  } catch (e) {
    throw new Error(`Failed to check git status: ${(e as Error).message}. Is this a git repository?`);
  }
}

function createBackupRef(workingDir: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const refName = `reporank-backup-${timestamp}`;

  try {
    const existingBranches = execSync("git branch --list reporank-backup-*", {
      cwd: workingDir,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    if (existingBranches) {
      for (const branch of existingBranches.split("\n")) {
        const trimmed = branch.replace(/^[* ] /, "").trim();
        if (trimmed) {
          execFileSync("git", ["branch", "-D", trimmed], {
            cwd: workingDir,
            stdio: ["pipe", "pipe", "pipe"],
          });
        }
      }
    }

    const headContent = execSync("git rev-parse --verify HEAD", {
      cwd: workingDir,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();

    if (headContent) {
      execFileSync("git", ["branch", refName, "HEAD"], {
        cwd: workingDir,
        stdio: ["pipe", "pipe", "pipe"],
      });
      return refName;
    }
  } catch {
    // No HEAD commit yet — nothing to back up
  }

  return refName;
}

function validatePatch(patch: GeneratedPatch, workingDir: string): string | null {
  const absPath = resolvePath(workingDir, patch.filePath);

  if (patch.type === "create") {
    if (existsSync(absPath)) {
      return `File already exists: ${patch.filePath}`;
    }
    if (!patch.content && !patch.newText) {
      return "Create patch must have content";
    }
    return null;
  }

  if (patch.type === "modify") {
    if (!existsSync(absPath)) {
      return `File not found: ${patch.filePath}`;
    }
    if (!patch.oldText) {
      return "Modify patch must have oldText";
    }
    const currentContent = readFileSync(absPath, "utf-8");
    if (!currentContent.includes(patch.oldText)) {
      return `Text not found in ${patch.filePath}: content has changed since the patch was generated`;
    }
    const count = countOccurrences(currentContent, patch.oldText);
    if (count > 1) {
      return `Ambiguous match: oldText appears ${count} times in ${patch.filePath}`;
    }
    return null;
  }

  return `Unknown patch type: ${(patch as unknown as { type: string }).type}`;
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let pos = 0;
  while ((pos = haystack.indexOf(needle, pos)) !== -1) {
    count++;
    pos += needle.length;
  }
  return count;
}

function applyOnePatch(
  patch: GeneratedPatch,
  workingDir: string,
): { success: boolean; error?: string } {
  const absPath = resolvePath(workingDir, patch.filePath);

  try {
    if (patch.type === "create") {
      const content = patch.content ?? patch.newText ?? "";
      const dir = dirname(absPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(absPath, content, "utf-8");
      return { success: true };
    }

    if (patch.type === "modify") {
      const currentContent = readFileSync(absPath, "utf-8");
      if (patch.oldText && !currentContent.includes(patch.oldText)) {
        return { success: false, error: "File changed since validation — oldText no longer found" };
      }
      const newContent = currentContent.replace(patch.oldText!, patch.newText ?? "");
      if (newContent === currentContent) {
        return { success: false, error: "Replacement produced no change" };
      }
      writeFileSync(absPath, newContent, "utf-8");
      return { success: true };
    }

    return { success: false, error: `Unknown patch type` };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}

async function interactivePrompt(opts: ApplyFixesOptions): Promise<{ prompt: (patch: GeneratedPatch) => Promise<"y" | "n" | "skip">; cleanup: () => void }> {
  if (!opts.interactive) {
    return { prompt: () => Promise.resolve("y"), cleanup: () => {} };
  }

  const promptFn = opts.interactionPrompt;
  if (promptFn) {
    return {
      prompt: async (patch: GeneratedPatch) => {
        const question = `\nApply fix "${patch.title}" to ${patch.filePath}? [y/n/skip]: `;
        const answer = await promptFn(question);
        const cleaned = answer.trim().toLowerCase();
        if (cleaned === "y" || cleaned === "yes") return "y";
        if (cleaned === "n" || cleaned === "no") return "n";
        return "skip";
      },
      cleanup: () => {},
    };
  }

  const readline = await import("node:readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return {
    prompt: (patch: GeneratedPatch) => {
      return new Promise((resolveP) => {
        rl.question(
          `\nApply fix "${patch.title}" to ${patch.filePath}? [y/n/skip]: `,
          (answer: string) => {
            const cleaned = answer.trim().toLowerCase();
            if (cleaned === "y" || cleaned === "yes") resolveP("y");
            else if (cleaned === "n" || cleaned === "no") resolveP("n");
            else resolveP("skip");
          },
        );
      });
    },
    cleanup: () => rl.close(),
  };
}

function groupByCategory(patches: GeneratedPatch[]): Map<string, GeneratedPatch[]> {
  const groups = new Map<string, GeneratedPatch[]>();
  for (const p of patches) {
    const key = p.category ?? "general";
    const list = groups.get(key) ?? [];
    list.push(p);
    groups.set(key, list);
  }
  return groups;
}

function commitPatches(
  patches: GeneratedPatch[],
  category: string,
  workingDir: string,
): string | null {
  if (patches.length === 0) return null;

  const files = [...new Set(patches.map((p) => p.filePath))];
  for (const file of files) {
    execSync(`git add ${JSON.stringify(file)}`, {
      cwd: workingDir,
      stdio: ["pipe", "pipe", "pipe"],
    });
  }

  const title = patches[0].title;
  const msg = `fix(${category}): reporank auto-fix — ${title}\n\n${patches
    .map((p) => `- ${p.filePath}: ${p.description}`)
    .join("\n")}`;

  execSync(`git commit -m ${JSON.stringify(msg)}`, {
    cwd: workingDir,
    stdio: ["pipe", "pipe", "pipe"],
  });

  const sha = execSync("git rev-parse HEAD", {
    cwd: workingDir,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();

  return sha;
}

function checkGitAvailable(): boolean {
  try { execSync("git --version", { stdio: "ignore" }); return true; }
  catch { return false; }
}

export async function applyFixes(
  patches: GeneratedPatch[],
  opts: ApplyFixesOptions,
): Promise<ApplyFixesResult> {
  if (!checkGitAvailable()) {
    return {
      total: patches.length,
      applied: [],
      skipped: [],
      failed: patches.map(p => ({ patch: p, error: "Git is not available. Please install git to use fix-pack-generator." })),
      dryRun: !!opts.dryRun,
      dryRunOutput: [],
      dryRunWouldApply: [],
      commitShas: [],
    };
  }

  const dryRunOutput: string[] = [];
  const dryRunWouldApply: GeneratedPatch[] = [];
  const applied: GeneratedPatch[] = [];
  const skipped: GeneratedPatch[] = [];
  const failed: { patch: GeneratedPatch; error: string }[] = [];
  const commitShas: string[] = [];

  const { prompt: getInteraction, cleanup: cleanupPrompt } = await interactivePrompt(opts);

  try {

  if (patches.length === 0) {
    return {
      total: 0,
      applied,
      skipped,
      failed,
      dryRun: !!opts.dryRun,
      dryRunOutput,
      dryRunWouldApply,
      commitShas,
    };
  }

  if (opts.dryRun) {
    for (const patch of patches) {
      const validationErr = validatePatch(patch, opts.workingDir);
      if (validationErr) {
        dryRunOutput.push(`[SKIP] ${patch.filePath}: ${validationErr}`);
        skipped.push(patch);
        continue;
      }
      if (patch.type === "create") {
        dryRunOutput.push(`[CREATE] ${patch.filePath}: ${patch.title}`);
      } else if (patch.type === "modify") {
        const absPath = resolvePath(opts.workingDir, patch.filePath);
        const content = readFileSync(absPath, "utf-8");
        const before = patch.oldText ?? "";
        const after = patch.newText ?? "";
        const preview = showDiff(before, after);
        dryRunOutput.push(`[MODIFY] ${patch.filePath}: ${patch.title}`);
        dryRunOutput.push(preview);
      }
      dryRunWouldApply.push(patch);
    }

    return {
      total: patches.length,
      applied,
      skipped,
      failed,
      dryRun: true,
      dryRunOutput,
      dryRunWouldApply,
      commitShas,
    };
  }

  if (!checkCleanWorkingTree(opts.workingDir)) {
    const msg =
      "Working tree is dirty. Please commit or stash changes before applying fixes.";
    for (const p of patches) {
      failed.push({ patch: p, error: msg });
    }
    return {
      total: patches.length,
      applied,
      skipped,
      failed,
      dryRun: false,
      dryRunOutput,
      dryRunWouldApply,
      commitShas,
    };
  }

  const backupRef = createBackupRef(opts.workingDir);

  const toApply: GeneratedPatch[] = [];
  for (const patch of patches) {
    const validationErr = validatePatch(patch, opts.workingDir);
    if (validationErr) {
      failed.push({ patch, error: validationErr });
      continue;
    }

    if (opts.interactive) {
      const answer = await getInteraction(patch);
      if (answer === "n") {
        skipped.push(patch);
        continue;
      }
      if (answer === "skip") {
        skipped.push(patch);
        continue;
      }
    }

    const result = applyOnePatch(patch, opts.workingDir);
    if (result.success) {
      applied.push(patch);
      toApply.push(patch);
    } else {
      failed.push({ patch, error: result.error ?? "unknown error" });
    }
  }

  if (applied.length > 0) {
    const groups = groupByCategory(applied);
    for (const [category, groupPatches] of groups) {
      try {
        const sha = commitPatches(groupPatches, category, opts.workingDir);
        if (sha) commitShas.push(sha);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        for (const p of groupPatches) {
          failed.push({ patch: p, error: `Git commit failed: ${errMsg}` });
        }
      }
    }
  }

  return {
    total: patches.length,
    applied,
    skipped,
    failed,
    dryRun: false,
    dryRunOutput,
    dryRunWouldApply,
    commitShas,
  };

  } finally {
    cleanupPrompt();
  }
}

function showDiff(before: string, after: string): string {
  const lines: string[] = [];
  if (before === after) {
    lines.push("  (no change)");
    return lines.join("\n");
  }
  const blines = before.split("\n");
  const alines = after.split("\n");
  const maxLines = Math.max(blines.length, alines.length);
  for (let i = 0; i < maxLines; i++) {
    if (i < blines.length && i < alines.length) {
      if (blines[i] !== alines[i]) {
        lines.push(`  - ${blines[i]}`);
        lines.push(`  + ${alines[i]}`);
      }
    } else if (i < blines.length) {
      lines.push(`  - ${blines[i]}`);
    } else {
      lines.push(`  + ${alines[i]}`);
    }
  }
  return lines.join("\n");
}

export { checkCleanWorkingTree, createBackupRef, validatePatch, applyOnePatch };
