/**
 * measuredAudit.ts — runs the real audit-core tool suite (Semgrep, CodeQL,
 * OSV, Trivy, Gitleaks, Checkov, Syft) against a target and maps the measured
 * findings into RepoRank's SecurityGroup.
 *
 * Every result carries provenance. If the audit cannot run, an honest empty
 * group with the reason is returned — never a fabricated pass.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { reportFingerprint, runAudit, type AuditReport } from "@overlay365/audit-core";
import {
  emptySecurityGroup,
  securityFromAuditReport,
  type SecurityGroup,
} from "@reporank/grading-engine";
import { logger } from "../logger";

export interface AuditRunOptions {
  timeoutMs?: number;
  gitHistory?: boolean;
  codeqlBuild?: string;
  toolsDir?: string;
}

export interface MeasuredAuditResult {
  group: SecurityGroup;
  report: AuditReport | null;
}

function reason(err: unknown): string {
  return err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200);
}

export async function auditDirectory(dir: string, opts: AuditRunOptions = {}): Promise<MeasuredAuditResult> {
  try {
    const report = await runAudit({
      root: dir,
      ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}),
      ...(opts.gitHistory !== undefined ? { gitHistory: opts.gitHistory } : {}),
      ...(opts.toolsDir ? { toolsDir: opts.toolsDir } : {}),
      ...(opts.codeqlBuild ? { codeql: { buildCommand: opts.codeqlBuild } } : {}),
    });
    return { group: securityFromAuditReport(report, reportFingerprint(report)), report };
  } catch (err) {
    logger.warn(`Measured audit failed: ${reason(err)}`);
    return { group: emptySecurityGroup(`audit-core failed: ${reason(err)}`), report: null };
  }
}

export async function auditRemoteRepo(
  owner: string,
  repo: string,
  opts: AuditRunOptions = {},
): Promise<MeasuredAuditResult> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "reporank-audit-"));
  try {
    const safeUrl = `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}.git`;
    execFileSync("git", ["clone", "--filter=blob:none", safeUrl, "."], {
      cwd: tempDir,
      encoding: "utf-8",
      timeout: 180_000,
      stdio: "pipe",
    });
    return await auditDirectory(tempDir, opts);
  } catch (err) {
    logger.warn(`Measured audit clone failed: ${reason(err)}`);
    return { group: emptySecurityGroup(`clone failed: ${reason(err)}`), report: null };
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
}

/** Materialize uploaded files into a temp dir, audit it, then clean up. */
export async function auditLocalFiles(
  files: { path: string; content: string }[],
  opts: AuditRunOptions = {},
): Promise<MeasuredAuditResult> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "reporank-audit-local-"));
  try {
    for (const f of files) {
      const full = path.resolve(tempDir, f.path);
      if (!full.startsWith(tempDir)) continue; // refuse path traversal
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, f.content, "utf8");
    }
    return await auditDirectory(tempDir, opts);
  } catch (err) {
    logger.warn(`Measured audit (local) failed: ${reason(err)}`);
    return { group: emptySecurityGroup(`local audit failed: ${reason(err)}`), report: null };
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
}
