/**
 * evidenceLabeler — annotates scan findings with evidence level labels.
 * Pure function, no I/O.
 */

export type EvidenceLevel = "verified" | "inferred" | "missing-proof" | "human-needed";

export interface LabeledFinding {
  title: string;
  description?: string;
  evidenceLevel: EvidenceLevel;
  evidenceSource: string;
  whyWeThinkThis: string;
}

interface LabelInput {
  report: Record<string, unknown> | null;
  clawFindings: Record<string, unknown> | null;
  brief?: { deliverables: string[]; acceptanceCriteria: string[] } | null;
}

function labelQuickWins(quickWins: any[]): LabeledFinding[] {
  return quickWins.map(win => {
    let evidenceLevel: EvidenceLevel = "inferred";
    let evidenceSource = "AI grading";
    let whyWeThinkThis = win.description || win.title;

    if (win.filePath && win.action) {
      evidenceLevel = "verified";
      evidenceSource = "Static code analysis";
      whyWeThinkThis = `Found at ${win.filePath}. Action: ${win.action}`;
    } else if (win.severity === "critical" && !win.filePath) {
      evidenceLevel = "inferred";
      evidenceSource = "Pattern matching";
      whyWeThinkThis = `Inferred from code patterns. ${win.description || ""}`;
    } else if (!win.description) {
      evidenceLevel = "human-needed";
      evidenceSource = "Unverified";
      whyWeThinkThis = "No description or file reference — requires manual review";
    }

    return {
      title: win.title,
      description: win.description,
      evidenceLevel,
      evidenceSource,
      whyWeThinkThis,
    };
  });
}

function labelSecretFindings(clawFindings: Record<string, unknown>): LabeledFinding[] {
  const secrets = (clawFindings.secrets as any) || {};
  const findings: LabeledFinding[] = [];

  if (secrets.secretsFound > 0) {
    findings.push({
      title: `${secrets.secretsFound} secret(s) detected`,
      description: "Hardcoded credentials or API keys found in source code",
      evidenceLevel: "verified",
      evidenceSource: "Claw secret scanner",
      whyWeThinkThis: "Detected by pattern-matching against known secret formats (API keys, tokens, passwords). These are deterministic matches.",
    });
  }

  return findings;
}

function labelInvisibleBugs(invisible: any): LabeledFinding[] {
  if (!invisible?.findings) return [];
  return invisible.findings.slice(0, 10).map((bug: any) => ({
    title: bug.detail,
    description: bug.reproductionScenario,
    evidenceLevel: bug.confidence >= 70 ? "verified" : "inferred",
    evidenceSource: "Invisible bugs detector",
    whyWeThinkThis: `Confidence ${bug.confidence}%. ${bug.seniorNote || ""}`,
  }));
}

function labelDeliverables(
  deliverables: string[],
  inScopeDeliverables: string[],
  missingDeliverables: string[],
): LabeledFinding[] {
  const findings: LabeledFinding[] = [];

  for (const d of inScopeDeliverables) {
    findings.push({
      title: d,
      evidenceLevel: "verified",
      evidenceSource: "Scope matcher (file tree analysis)",
      whyWeThinkThis: "Code markers matching this deliverable were found in the file tree or report",
    });
  }

  for (const d of missingDeliverables) {
    findings.push({
      title: d,
      evidenceLevel: "missing-proof",
      evidenceSource: "Scope matcher",
      whyWeThinkThis: "No code markers matching this deliverable were found. It may be unimplemented or named differently.",
    });
  }

  return findings;
}

export function labelFindings(input: LabelInput): {
  labeledQuickWins: LabeledFinding[];
  labeledSecrets: LabeledFinding[];
  labeledBugs: LabeledFinding[];
  labeledDeliverables: LabeledFinding[];
  verifiedCount: number;
  inferredCount: number;
  missingProofCount: number;
  humanNeededCount: number;
} {
  const report = input.report || {};
  const claw = input.clawFindings || {};
  const drift = (claw as any).drift || {};

  const labeledQuickWins = labelQuickWins((report as any).quickWins || []);
  const labeledSecrets = labelSecretFindings(claw);
  const labeledBugs = labelInvisibleBugs((claw as any).invisible);
  const labeledDeliverables = input.brief
    ? labelDeliverables(
        input.brief.deliverables,
        drift.inScope || [],
        drift.missingPlanned || [],
      )
    : [];

  const all = [...labeledQuickWins, ...labeledSecrets, ...labeledBugs, ...labeledDeliverables];

  return {
    labeledQuickWins,
    labeledSecrets,
    labeledBugs,
    labeledDeliverables,
    verifiedCount: all.filter(f => f.evidenceLevel === "verified").length,
    inferredCount: all.filter(f => f.evidenceLevel === "inferred").length,
    missingProofCount: all.filter(f => f.evidenceLevel === "missing-proof").length,
    humanNeededCount: all.filter(f => f.evidenceLevel === "human-needed").length,
  };
}
