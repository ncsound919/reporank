/**
 * cross-repo.ts — cross-repository dependency edges and duplication.
 *
 * Reuses the in-memory `buildModuleGraph` from import-graph.ts twice over:
 *   1. Each repo's external specifiers are matched against the other repos'
 *      package names to find cross-repo dependency edges.
 *   2. Each file is reduced to a normalized shingle set; files from different
 *      repos that are near-identical are reported as duplicated
 *      implementations.
 *
 * Everything is deterministic: same inputs -> same edges / duplicate order.
 * No LLM, no network, no new dependencies.
 */
import {
  buildModuleGraph,
  languageOf,
  normalizePath,
  type GraphSourceFile,
} from "../analyzers/import-graph";

export interface CrossRepoInput {
  name: string;
  /** Published package name, matched against other repos' external imports. */
  packageName?: string;
  sourceFiles: GraphSourceFile[];
}

export interface CrossRepoEdge {
  from: string;
  to: string;
  /** The bare specifier that created the edge. */
  specifier: string;
  /** Number of importing files. */
  count: number;
}

export interface DuplicateLocation {
  repo: string;
  file: string;
}

export interface DuplicateFinding {
  a: DuplicateLocation;
  b: DuplicateLocation;
  /** Jaccard similarity of the normalized shingle sets, 0..1. */
  similarity: number;
  sharedShingles: number;
  language: string;
}

export interface CrossRepoReport {
  repos: string[];
  edges: CrossRepoEdge[];
  duplicates: DuplicateFinding[];
  graph: {
    nodes: string[];
    /** Deterministic "from -> to (specifier)" edge strings. */
    edges: string[];
  };
  summary: string;
}

export interface CrossRepoOptions {
  /** Jaccard similarity required for a duplicate. Default 0.8. */
  minSimilarity?: number;
  /** Minimum shared shingles required. Default 8. */
  minSharedShingles?: number;
  /** Token shingle size. Default 5. */
  shingleSize?: number;
  /** Cap on reported duplicates. Default 50. */
  maxDuplicates?: number;
}

const DEFAULTS = {
  minSimilarity: 0.8,
  minSharedShingles: 8,
  shingleSize: 5,
  maxDuplicates: 50,
};

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function hashTokens(tokens: string[]): number {
  const joined = tokens.join("\u0001");
  let hash = FNV_OFFSET;
  for (let i = 0; i < joined.length; i++) {
    hash ^= joined.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
}

/** Strip comments and normalize string/number literals so cosmetic edits don't count. */
export function normalizeCode(content: string): string {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ")
    .replace(/["'`](?:\\.|[^"'`\\])*["'`]/g, '""')
    .replace(/\b\d+(?:\.\d+)?\b/g, "0")
    .replace(/\s+/g, " ")
    .trim();
}

/** Tokenize normalized code deterministically. */
export function tokenizeCode(content: string): string[] {
  const normalized = normalizeCode(content);
  return (
    normalized.match(
      /[A-Za-z_$][A-Za-z0-9_$]*|\d+|=>|===|!==|==|!=|<=|>=|&&|\|\||[{}()[\];,.:?+\-*/%<>=!&|^~]/g,
    ) ?? []
  );
}

/** Set of hashed token shingles for a file's normalized code. */
export function codeFingerprint(content: string, shingleSize = DEFAULTS.shingleSize): Set<number> {
  const tokens = tokenizeCode(content);
  const size = Math.max(1, shingleSize);
  const fingerprints = new Set<number>();
  if (tokens.length < size) {
    if (tokens.length > 0) fingerprints.add(hashTokens(tokens));
    return fingerprints;
  }
  for (let i = 0; i + size <= tokens.length; i++) {
    fingerprints.add(hashTokens(tokens.slice(i, i + size)));
  }
  return fingerprints;
}

function jaccard(a: Set<number>, b: Set<number>): { similarity: number; shared: number } {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let shared = 0;
  for (const value of small) if (large.has(value)) shared++;
  const union = a.size + b.size - shared;
  return { similarity: union === 0 ? 0 : shared / union, shared };
}

function isFingerprintable(file: string): boolean {
  return languageOf(file) !== "other";
}

function collectEdges(repos: CrossRepoInput[]): CrossRepoEdge[] {
  const packageOwner = new Map<string, string>();
  const nameOwner = new Map<string, string>();
  for (const repo of repos) {
    nameOwner.set(repo.name, repo.name);
    if (repo.packageName) packageOwner.set(repo.packageName, repo.name);
  }

  const edgeCounts = new Map<string, CrossRepoEdge>();
  for (const repo of repos) {
    const graph = buildModuleGraph(repo.sourceFiles);
    const specifierFiles = new Map<string, number>();
    for (const externals of graph.external.values()) {
      for (const specifier of externals) {
        specifierFiles.set(specifier, (specifierFiles.get(specifier) ?? 0) + 1);
      }
    }

    for (const specifier of [...specifierFiles.keys()].sort()) {
      const to = packageOwner.get(specifier) ?? nameOwner.get(specifier);
      if (!to || to === repo.name) continue;
      const key = `${repo.name}\u0000${to}\u0000${specifier}`;
      edgeCounts.set(key, {
        from: repo.name,
        to,
        specifier,
        count: specifierFiles.get(specifier) ?? 1,
      });
    }
  }

  return [...edgeCounts.values()].sort(
    (a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.specifier.localeCompare(b.specifier),
  );
}

export function buildCrossRepoReport(
  repos: CrossRepoInput[],
  options: CrossRepoOptions = {},
): CrossRepoReport {
  const minSimilarity = options.minSimilarity ?? DEFAULTS.minSimilarity;
  const minSharedShingles = options.minSharedShingles ?? DEFAULTS.minSharedShingles;
  const shingleSize = options.shingleSize ?? DEFAULTS.shingleSize;
  const maxDuplicates = options.maxDuplicates ?? DEFAULTS.maxDuplicates;

  const ordered = [...repos].sort((a, b) => a.name.localeCompare(b.name));
  const edges = collectEdges(ordered);

  const candidates: Array<{
    repo: string;
    file: string;
    language: string;
    fingerprint: Set<number>;
  }> = [];

  for (const repo of ordered) {
    for (const source of [...repo.sourceFiles].sort((a, b) => normalizePath(a.path).localeCompare(normalizePath(b.path)))) {
      const file = normalizePath(source.path);
      if (!isFingerprintable(file)) continue;
      const fingerprint = codeFingerprint(source.content, shingleSize);
      if (fingerprint.size < minSharedShingles) continue;
      candidates.push({ repo: repo.name, file, language: languageOf(file), fingerprint });
    }
  }

  const duplicates: DuplicateFinding[] = [];
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const left = candidates[i];
      const right = candidates[j];
      if (left.repo === right.repo) continue;
      if (left.language !== right.language) continue;
      const { similarity, shared } = jaccard(left.fingerprint, right.fingerprint);
      if (shared < minSharedShingles || similarity < minSimilarity) continue;
      duplicates.push({
        a: { repo: left.repo, file: left.file },
        b: { repo: right.repo, file: right.file },
        similarity: Math.round(similarity * 1000) / 1000,
        sharedShingles: shared,
        language: left.language,
      });
    }
  }

  duplicates.sort(
    (a, b) =>
      b.similarity - a.similarity ||
      a.a.repo.localeCompare(b.a.repo) ||
      a.a.file.localeCompare(b.a.file) ||
      a.b.repo.localeCompare(b.b.repo) ||
      a.b.file.localeCompare(b.b.file),
  );

  const capped = duplicates.slice(0, maxDuplicates);
  const graphEdges = edges
    .map((edge) => `${edge.from} -> ${edge.to} (${edge.specifier})`)
    .sort();

  return {
    repos: ordered.map((repo) => repo.name),
    edges,
    duplicates: capped,
    graph: { nodes: ordered.map((repo) => repo.name), edges: graphEdges },
    summary:
      `${ordered.length} repos, ${edges.length} cross-repo dependency edge(s), ` +
      `${capped.length} duplicated implementation(s).`,
  };
}
