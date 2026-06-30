import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { statSync } from "node:fs";
import {
  findingsToPatches,
  applyFixes,
  type FindingInput,
  type ApplyFixesResult,
} from "@reporank/fix-pack-generator";
import { runVerify, type VerifyOptions } from "./verify";

export interface ApplyFixesFromVerifyOptions extends VerifyOptions {
  dryRun?: boolean;
  interactive?: boolean;
}

export async function applyFixesFromVerify(
  opts: ApplyFixesFromVerifyOptions,
): Promise<ApplyFixesResult> {
  const { report } = await runVerify(opts);

  const absOptsPath = resolve(opts.path);
  const root = statSync(absOptsPath).isFile() ? dirname(absOptsPath) : absOptsPath;

  const fileContents = new Map<string, string>();
  for (const fr of report.files) {
    const absPath = resolve(root, fr.path);
    try {
      const content = readFileSync(absPath, "utf-8");
      fileContents.set(fr.path, content);
    } catch {
      // skip unreadable files
    }
  }

  const inputFindings: FindingInput[] = report.findings.map((f) => ({
    category: f.category,
    severity: f.severity,
    line: f.line,
    type: f.type,
    description: f.description,
    recommendation: f.recommendation,
    confidence: f.confidence,
    path: f.path,
  }));

  const patches = findingsToPatches(inputFindings, fileContents);

  const result = await applyFixes(patches, {
    workingDir: root,
    dryRun: opts.dryRun ?? false,
    interactive: opts.interactive ?? false,
  });

  return result;
}
