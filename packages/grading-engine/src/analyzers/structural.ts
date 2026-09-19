/**
 * structural.ts — graph-level structural analyzers.
 *
 * Adds three deterministic analyses on top of the shared import graph:
 *   1. Import cycles      — strongly-connected components (Tarjan, iterative).
 *   2. Layer violations   — configurable directory dependency rules.
 *   3. Coupling/cohesion  — afferent/efferent coupling + instability + a
 *                           directory-local cohesion proxy.
 *
 * These do not duplicate the existing `architecture.ts` heuristics or the
 * `enterprise.analyzeCoupling` fan-in/fan-out pass: everything here is keyed
 * off *resolved* edges, so it never counts an unresolved string as a module.
 *
 * All output is sorted/deduped so the same source files always produce an
 * identical report. No LLM, no network.
 */
import {
  buildModuleGraph,
  dirName,
  type GraphSourceFile,
  type ModuleGraph,
} from "./import-graph";

export type StructuralSeverity = "critical" | "high" | "medium" | "low";

export interface StructuralFinding {
  type:
    | "import-cycle"
    | "layer-violation"
    | "high-instability"
    | "low-cohesion"
    | "high-afferent-coupling"
    | "high-efferent-coupling";
  filePath: string;
  line?: number;
  severity: StructuralSeverity;
  detail: string;
}

export interface ImportCycle {
  /** Sorted member module paths. */
  modules: string[];
  /** Participating edges, formatted "a -> b". */
  edges: string[];
}

export interface ModuleCoupling {
  file: string;
  /** Ca — distinct internal modules that import this one. */
  afferent: number;
  /** Ce — distinct internal modules this one imports. */
  efferent: number;
  /** Ce / (Ca + Ce), 0..1. 0 = stable (only depended upon), 1 = unstable. */
  instability: number;
  /** Fraction of internal imports that stay inside the same directory, 0..1. */
  cohesion: number;
}

export interface LayerRule {
  /** Importer directory token, e.g. "api" or "src/api". */
  from: string;
  /** Imported directory token that must not be imported, e.g. "db". */
  disallow: string;
  severity: StructuralSeverity;
  reason: string;
}

export interface StructuralReport {
  findings: StructuralFinding[];
  cycles: ImportCycle[];
  layerViolations: StructuralFinding[];
  coupling: ModuleCoupling[];
  cycleCount: number;
  layerViolationCount: number;
  averageInstability: number;
  summary: string;
}

/**
 * Small, conservative default rule set. Every rule is a directory pair, so it
 * can be overridden per-repo via `reporank.config.json` (see parseLayerRules).
 */
export const DEFAULT_LAYER_RULES: LayerRule[] = [
  {
    from: "api",
    disallow: "db",
    severity: "high",
    reason: "API layer must not import the data layer directly — go through a service/repository boundary.",
  },
  {
    from: "routes",
    disallow: "db",
    severity: "high",
    reason: "Route handlers must not import the data layer directly — move queries into services/.",
  },
  {
    from: "components",
    disallow: "db",
    severity: "high",
    reason: "UI components must not import the data layer — fetch through an API/service layer.",
  },
  {
    from: "db",
    disallow: "api",
    severity: "critical",
    reason: "Data layer importing the API layer inverts the dependency direction — this creates a cycle at runtime.",
  },
];

const COUPLING_LIMITS = {
  /** Ce above this is "knows too much". */
  maxEfferent: 20,
  /** Ca above this is "changes ripple everywhere". */
  maxAfferent: 10,
  /** Files with at least this many internal imports can be judged for cohesion. */
  minImportsForCohesion: 5,
  /** Cohesion below this is flagged. */
  minCohesion: 0.3,
  /** Max coupling findings so the dimension stays bounded. */
  maxFindings: 25,
};

function severityForCycle(size: number): StructuralSeverity {
  if (size >= 6) return "critical";
  if (size >= 4) return "high";
  if (size >= 2) return "medium";
  return "low";
}

/**
 * Tarjan's SCC algorithm, iterative to avoid stack overflow on large repos.
 * Returns components sorted by (descending size, then lexical) for determinism.
 */
export function findStronglyConnectedComponents(graph: ModuleGraph): string[][] {
  const nodes = graph.nodes;
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const components: string[][] = [];
  let counter = 0;

  for (const root of nodes) {
    if (index.has(root)) continue;

    // Frame: [node, neighbourIndex]
    const frames: { node: string; next: number }[] = [];
    index.set(root, counter);
    low.set(root, counter);
    counter++;
    stack.push(root);
    onStack.add(root);
    frames.push({ node: root, next: 0 });

    while (frames.length > 0) {
      const frame = frames[frames.length - 1];
      const neighbours = graph.edges.get(frame.node) ?? [];

      if (frame.next < neighbours.length) {
        const next = neighbours[frame.next];
        frame.next++;
        if (!index.has(next)) {
          index.set(next, counter);
          low.set(next, counter);
          counter++;
          stack.push(next);
          onStack.add(next);
          frames.push({ node: next, next: 0 });
        } else if (onStack.has(next)) {
          low.set(frame.node, Math.min(low.get(frame.node)!, index.get(next)!));
        }
        continue;
      }

      frames.pop();
      const parent = frames[frames.length - 1];
      if (parent) {
        low.set(parent.node, Math.min(low.get(parent.node)!, low.get(frame.node)!));
      }

      if (low.get(frame.node) === index.get(frame.node)) {
        const component: string[] = [];
        let member: string;
        do {
          member = stack.pop()!;
          onStack.delete(member);
          component.push(member);
        } while (member !== frame.node);
        components.push(component);
      }
    }
  }

  components.sort((a, b) => b.length - a.length || a[0].localeCompare(b[0]));
  return components;
}

/**
 * Find import cycles: SCCs with >1 module, plus self-imports (a file importing
 * itself, directly via re-export or through a path alias).
 */
export function findImportCycles(graph: ModuleGraph): ImportCycle[] {
  const cycles: ImportCycle[] = [];
  for (const component of findStronglyConnectedComponents(graph)) {
    if (component.length > 1) {
      const members = new Set(component);
      const edges: string[] = [];
      for (const from of [...component].sort()) {
        for (const to of graph.edges.get(from) ?? []) {
          if (members.has(to)) edges.push(`${from} -> ${to}`);
        }
      }
      cycles.push({ modules: [...component].sort(), edges: edges.sort() });
    } else {
      const only = component[0];
      if ((graph.edges.get(only) ?? []).includes(only)) {
        cycles.push({ modules: [only], edges: [`${only} -> ${only}`] });
      }
    }
  }
  return cycles;
}

/** True when a path is inside a directory identified by a rule token. */
function inDirectory(path: string, token: string): boolean {
  const norm = path.replace(/\\/g, "/");
  const dir = dirName(norm);
  if (token.includes("/")) {
    return norm === token || norm.startsWith(`${token}/`);
  }
  return dir === token || dir.startsWith(`${token}/`) || dir.includes(`/${token}/`) || dir.endsWith(`/${token}`);
}

/** Detect layering violations for resolved internal edges only. */
export function detectLayerViolations(graph: ModuleGraph, rules: LayerRule[] = DEFAULT_LAYER_RULES): StructuralFinding[] {
  const findings: StructuralFinding[] = [];
  const seen = new Set<string>();

  const sortedNodes = [...graph.nodes].sort();
  for (const from of sortedNodes) {
    for (const to of graph.edges.get(from) ?? []) {
      const rule = rules.find((r) => inDirectory(from, r.from) && inDirectory(to, r.disallow));
      if (!rule) continue;
      const key = `${from} -> ${to} (${rule.from}->${rule.disallow})`;
      if (seen.has(key)) continue;
      seen.add(key);
      const line = graph.lines.get(from)?.get(to);
      findings.push({
        type: "layer-violation",
        filePath: from,
        ...(line !== undefined ? { line } : {}),
        severity: rule.severity,
        detail: `${rule.reason} (${from} imports ${to})`,
      });
    }
  }

  findings.sort((a, b) => a.filePath.localeCompare(b.filePath) || (a.line ?? 0) - (b.line ?? 0));
  return findings;
}

/** Compute Ca/Ce/instability/cohesion for every module in the graph. */
export function computeModuleCoupling(graph: ModuleGraph): ModuleCoupling[] {
  const afferent = new Map<string, Set<string>>();
  for (const node of graph.nodes) afferent.set(node, new Set());

  for (const from of graph.nodes) {
    for (const to of graph.edges.get(from) ?? []) {
      afferent.get(to)?.add(from);
    }
  }

  const coupling: ModuleCoupling[] = graph.nodes.map((file) => {
    const efferentSet = new Set(graph.edges.get(file) ?? []);
    const ca = afferent.get(file)?.size ?? 0;
    const ce = efferentSet.size;
    const dir = dirName(file);
    let internal = 0;
    for (const target of efferentSet) {
      if (dirName(target) === dir) internal++;
    }
    return {
      file,
      afferent: ca,
      efferent: ce,
      instability: ca + ce === 0 ? 0 : Math.round((ce / (ca + ce)) * 1000) / 1000,
      cohesion: ce === 0 ? 1 : Math.round((internal / ce) * 1000) / 1000,
    };
  });

  coupling.sort((a, b) => a.file.localeCompare(b.file));
  return coupling;
}

const ENTRY_POINT_RE = /(^|\/)(index|main|app|server|cli)\.[a-z]+$/i;

function couplingFindings(coupling: ModuleCoupling[]): StructuralFinding[] {
  const findings: StructuralFinding[] = [];

  for (const c of coupling) {
    if (c.efferent > COUPLING_LIMITS.maxEfferent) {
      findings.push({
        type: "high-efferent-coupling",
        filePath: c.file,
        severity: "medium",
        detail: `Imports ${c.efferent} internal modules — too many responsibilities, hard to test and reason about.`,
      });
    }
    if (c.afferent > COUPLING_LIMITS.maxAfferent) {
      findings.push({
        type: "high-afferent-coupling",
        filePath: c.file,
        severity: "medium",
        detail: `Imported by ${c.afferent} internal modules — changes here ripple across the codebase; stabilise the interface.`,
      });
    }
    if (
      c.efferent >= COUPLING_LIMITS.minImportsForCohesion &&
      c.afferent === 0 &&
      !ENTRY_POINT_RE.test(c.file)
    ) {
      findings.push({
        type: "high-instability",
        filePath: c.file,
        severity: "low",
        detail: `Instability ${c.instability.toFixed(2)} with ${c.efferent} outgoing deps and no dependents — likely a leaf that should be consolidated.`,
      });
    }
    if (
      c.efferent >= COUPLING_LIMITS.minImportsForCohesion &&
      c.cohesion < COUPLING_LIMITS.minCohesion
    ) {
      findings.push({
        type: "low-cohesion",
        filePath: c.file,
        severity: "medium",
        detail: `Only ${Math.round(c.cohesion * 100)}% of imports stay in ${dirName(c.file) || "."}/ — module spans unrelated boundaries.`,
      });
    }
  }

  findings.sort((a, b) => a.filePath.localeCompare(b.filePath) || a.type.localeCompare(b.type));
  return findings.slice(0, COUPLING_LIMITS.maxFindings);
}

/** Read optional layer rules from an in-repo config file, if present. */
export function parseLayerRules(sourceFiles: GraphSourceFile[]): LayerRule[] | null {
  const configFile = sourceFiles.find((f) => {
    const p = f.path.replace(/\\/g, "/");
    return p === "reporank.config.json" || p === ".reporank.json";
  });
  if (!configFile) return null;
  try {
    const parsed = JSON.parse(configFile.content) as { layerRules?: unknown };
    if (!Array.isArray(parsed.layerRules)) return null;
    const rules: LayerRule[] = [];
    for (const raw of parsed.layerRules) {
      if (!raw || typeof raw !== "object") continue;
      const r = raw as Record<string, unknown>;
      if (typeof r.from !== "string" || typeof r.disallow !== "string") continue;
      const severity: StructuralSeverity =
        r.severity === "critical" || r.severity === "high" || r.severity === "medium" || r.severity === "low"
          ? r.severity
          : "medium";
      rules.push({
        from: r.from,
        disallow: r.disallow,
        severity,
        reason: typeof r.reason === "string" ? r.reason : `Layer rule: ${r.from} must not import ${r.disallow}.`,
      });
    }
    return rules.length > 0 ? rules : null;
  } catch {
    return null;
  }
}

export interface AnalyzeStructureOptions {
  layerRules?: LayerRule[];
}

/**
 * Run the full structural analysis and return located findings plus raw graph
 * metrics. Findings are intentionally capped for coupling so the downstream
 * index dimension stays bounded and count-independent.
 */
export function analyzeStructure(
  sourceFiles: GraphSourceFile[],
  options: AnalyzeStructureOptions = {},
): StructuralReport {
  const graph = buildModuleGraph(sourceFiles);
  const cycles = findImportCycles(graph);
  const cycleFindings: StructuralFinding[] = cycles.map((cycle) => {
    let line: number | undefined;
    const firstEdge = cycle.edges[0];
    if (firstEdge) {
      const [edgeFrom, edgeTo] = firstEdge.split(" -> ");
      line = graph.lines.get(edgeFrom)?.get(edgeTo);
    }
    return {
      type: "import-cycle",
      filePath: cycle.modules[0],
      ...(line !== undefined ? { line } : {}),
      severity: severityForCycle(cycle.modules.length),
      detail:
        cycle.modules.length === 1
          ? `Self-referential import in ${cycle.modules[0]}.`
          : `Import cycle across ${cycle.modules.length} modules: ${cycle.modules.join(" -> ")} -> ${cycle.modules[0]}.`,
    };
  });

  const rules = options.layerRules ?? parseLayerRules(sourceFiles) ?? DEFAULT_LAYER_RULES;
  const layerViolations = detectLayerViolations(graph, rules);
  const coupling = computeModuleCoupling(graph);
  const cFindings = couplingFindings(coupling);

  const findings = [...cycleFindings, ...layerViolations, ...cFindings].sort(
    (a, b) => a.filePath.localeCompare(b.filePath) || (a.line ?? 0) - (b.line ?? 0) || a.type.localeCompare(b.type),
  );

  const avgInstability =
    coupling.length === 0
      ? 0
      : Math.round((coupling.reduce((s, c) => s + c.instability, 0) / coupling.length) * 1000) / 1000;

  return {
    findings,
    cycles,
    layerViolations,
    coupling,
    cycleCount: cycles.length,
    layerViolationCount: layerViolations.length,
    averageInstability: avgInstability,
    summary:
      `${graph.nodes.length} modules, ${[...graph.edges.values()].reduce((s, e) => s + e.length, 0)} internal edges. ` +
      `${cycles.length} import cycle(s), ${layerViolations.length} layer violation(s), avg instability ${avgInstability}.`,
  };
}
