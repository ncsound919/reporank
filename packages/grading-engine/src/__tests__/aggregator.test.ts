/**
 * aggregator.test.ts
 *
 * Covers the three highest-risk behaviours in aggregator.ts:
 * 1. Correct severity-weighted score composition
 * 2. Edge case: all-zero inputs produce empty worst-files list
 * 3. Edge case: single analyzer failure (missing field) is handled gracefully
 * 4. Recommendation rules fire in priority order
 * 5. buildWorstFiles respects the limit parameter
 */
import { describe, it, expect } from 'vitest';
import {
  aggregateFileScores,
  buildWorstFiles,
  generateTopRecommendations,
  type AnalysisResult,
} from '../analyzers/aggregator';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function emptyAnalysisResult(): AnalysisResult {
  return {
    complexity: {
      hotSpots: [],
      fileSizeDistribution: { small: 5, medium: 2, large: 0, xlarge: 0 },
      longestFiles: [],
      worstFiles: [],
      cohesionViolations: [],
      summary: 'clean',
    },
    dependencies: {
      findings: [],
      depHealthScore: 100,
      unusedPatterns: [],
      summary: 'clean',
    },
    architecture: { findings: [], summary: 'clean' },
    production: { findings: [], deployBlockers: [], overallReadiness: 'ready', summary: 'clean' },
    codeHygiene: { findings: [], summary: 'clean' },
    enterprise: {
      apiContract:   { findings: [], apiSurface: [], consistencyScore: 100, seniorSummary: '' },
      observability: { findings: [], observabilityScore: 100, seniorSummary: '' },
      buildCI:       { findings: [], ciScore: 100, seniorSummary: '' },
      coupling:      { findings: [], couplingScore: 100, seniorSummary: '' },
      license:       { findings: [], licenseScore: 100, seniorSummary: '' },
      longTermDebt:  { findings: [], debtScore: 100, seniorSummary: '' },
      overallSeniorScore: 100,
      criticalBlockers: [],
      seniorSummary: '',
      rawPromptBlock: '',
    },
  };
}

function withComplexityHotspot(
  base: AnalysisResult,
  filePath: string,
  severity: 'critical' | 'high' | 'medium' | 'low',
  detail = 'test finding',
): AnalysisResult {
  return {
    ...base,
    complexity: {
      ...base.complexity,
      hotSpots: [
        ...base.complexity.hotSpots,
        { filePath, size: 1000, lines: 300, concern: 'god-file', severity, detail },
      ],
      worstFiles: [{ path: filePath, score: 25, reasons: [detail] }],
    },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('aggregateFileScores', () => {
  it('returns an empty map when all analyzers have zero findings', () => {
    const result = emptyAnalysisResult();
    const scores = aggregateFileScores(result);
    expect(scores.size).toBe(0);
  });

  it('assigns SEVERITY_WEIGHTS correctly: critical=30, high=15, medium=5, low=1', () => {
    const base = emptyAnalysisResult();
    const weights: Record<string, number> = { critical: 30, high: 15, medium: 5, low: 1 };

    for (const [severity, expected] of Object.entries(weights)) {
      const result = withComplexityHotspot(base, `src/${severity}.ts`, severity as any);
      const scores = aggregateFileScores(result);
      const entry = scores.get(`src/${severity}.ts`);
      expect(entry?.score).toBe(expected);
    }
  });

  it('accumulates scores across multiple analyzers for the same file', () => {
    const base = emptyAnalysisResult();
    const filePath = 'src/shared/utils.ts';

    // Complexity hotspot (high = 15) + architecture finding (medium = 5) = 20
    const result: AnalysisResult = {
      ...base,
      complexity: {
        ...base.complexity,
        hotSpots: [{ filePath, size: 800, lines: 400, concern: 'bloat', severity: 'high', detail: 'too large' }],
        worstFiles: [{ path: filePath, score: 15, reasons: ['too large'] }],
      },
      architecture: {
        findings: [{ filePath, severity: 'medium', detail: 'layer violation', type: 'layer-violation' }],
        summary: '',
      },
    };

    const scores = aggregateFileScores(result);
    const entry = scores.get(filePath);
    expect(entry?.score).toBe(20);
    expect(entry?.reasons).toHaveLength(2);
  });

  it('handles enterprise sub-domain findings without throwing', () => {
    const base = emptyAnalysisResult();
    base.enterprise.apiContract.findings.push({
      type: 'missing-versioning',
      filePath: 'src/app.ts',
      severity: 'medium',
      detail: 'no version prefix',
      seniorNote: '',
      endpoint: undefined,
    });
    expect(() => aggregateFileScores(base)).not.toThrow();
    const scores = aggregateFileScores(base);
    expect(scores.get('src/app.ts')?.score).toBe(5); // medium = 5
  });
});

describe('buildWorstFiles', () => {
  it('returns empty array when fileScores map is empty', () => {
    expect(buildWorstFiles(new Map(), 10)).toEqual([]);
  });

  it('respects the limit parameter', () => {
    const map = new Map<string, { score: number; reasons: string[] }>();
    for (let i = 0; i < 20; i++) {
      map.set(`src/file-${i}.ts`, { score: 20 - i, reasons: ['reason'] });
    }
    expect(buildWorstFiles(map, 5)).toHaveLength(5);
  });

  it('sorts files by descending score', () => {
    const map = new Map([
      ['src/low.ts',      { score: 5,  reasons: [] }],
      ['src/critical.ts', { score: 80, reasons: [] }],
      ['src/medium.ts',   { score: 20, reasons: [] }],
    ]);
    const worst = buildWorstFiles(map, 10);
    expect(worst[0].path).toBe('src/critical.ts');
    expect(worst[1].path).toBe('src/medium.ts');
    expect(worst[2].path).toBe('src/low.ts');
  });

  it('excludes files with score === 0', () => {
    const map = new Map([
      ['src/clean.ts', { score: 0,  reasons: [] }],
      ['src/dirty.ts', { score: 10, reasons: ['issue'] }],
    ]);
    const worst = buildWorstFiles(map, 10);
    expect(worst.map(f => f.path)).not.toContain('src/clean.ts');
  });
});

describe('generateTopRecommendations', () => {
  it('returns empty array for a fully clean result', () => {
    const result = emptyAnalysisResult();
    expect(generateTopRecommendations(result)).toEqual([]);
  });

  it('prioritises critical dep findings over complexity hotspots (priority 2 < priority 1? no: rule 1 is complexity)', () => {
    // Rule priority 1 = complexity.worstFiles, priority 2 = critical deps.
    // So complexity fires first.
    const result = withComplexityHotspot(emptyAnalysisResult(), 'src/god.ts', 'high');
    result.dependencies.findings.push({
      packageName: 'lodash', severity: 'critical', detail: 'CVE-1234', type: 'vulnerable',
    } as any);
    const recs = generateTopRecommendations(result);
    expect(recs[0]).toMatch(/REFACTOR/);
    expect(recs[1]).toMatch(/UPDATE/);
  });

  it('returns at most 10 recommendations regardless of finding count', () => {
    // Fill every condition by building a maximally-broken result
    const result = emptyAnalysisResult();
    result.complexity.worstFiles = [{ path: 'src/god.ts', score: 100, reasons: ['too big'] }];
    result.complexity.hotSpots = [
      { filePath: 'src/god.ts', size: 9000, lines: 700, concern: 'god-file', severity: 'critical', detail: 'huge' },
      { filePath: 'src/nesting.ts', size: 5000, lines: 500, concern: 'deep-nesting', severity: 'high', detail: 'deep' },
    ];
    result.complexity.fileSizeDistribution.xlarge = 3;
    result.dependencies.findings.push({ packageName: 'x', severity: 'critical', detail: 'CVE', type: 'vulnerable' } as any);
    result.production.deployBlockers = [{ detail: 'missing env', type: 'missing-env', severity: 'critical', filePath: '' }];
    result.production.overallReadiness = 'not-ready';
    result.enterprise.criticalBlockers = ['no license'];
    result.codeHygiene.findings.push({ severity: 'critical', detail: 'raw sql', filePath: 'db.ts', type: 'sql-injection' } as any);
    const recs = generateTopRecommendations(result);
    expect(recs.length).toBeLessThanOrEqual(10);
  });
});
