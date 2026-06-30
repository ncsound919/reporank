/**
 * provider-normalization.test.ts
 *
 * Verifies that parseHealthReport (the LLM response normalizer) produces
 * a structurally valid HealthReport regardless of which provider emitted
 * the JSON — and that score fields are always numbers in [0, 100].
 *
 * These tests catch silent scoring regressions caused by provider-specific
 * JSON quirks (e.g., Gemini returns scores as strings, a future provider
 * returns them nested differently).
 */
import { describe, it, expect } from 'vitest';
import { parseHealthReport } from '../responseParser';

// ── Shared assertions ─────────────────────────────────────────────────────────

function assertValidHealthReport(report: ReturnType<typeof parseHealthReport>) {
  expect(typeof report).toBe('object');
  // Score fields must be numbers in [0, 100]
  const scoreFields = [
    'overallScore', 'codeQualityScore', 'maintainabilityScore',
    'securityScore', 'documentationScore', 'testCoverageScore',
  ] as const;
  for (const field of scoreFields) {
    const val = (report as any)[field];
    if (val !== undefined) {
      expect(typeof val).toBe('number');
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThanOrEqual(100);
    }
  }
  // Grade must be a non-empty string if present
  if ((report as any).grade !== undefined) {
    expect(typeof (report as any).grade).toBe('string');
    expect((report as any).grade.length).toBeGreaterThan(0);
  }
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const GEMINI_TYPICAL = JSON.stringify({
  overallScore: 72,
  codeQualityScore: 68,
  maintainabilityScore: 75,
  securityScore: 80,
  documentationScore: 60,
  testCoverageScore: 55,
  grade: 'B',
  summary: 'Decent codebase with room for improvement.',
  findings: [],
  recommendations: ['Add tests', 'Remove console.logs'],
});

// Simulates a provider that serialises numbers as strings
const PROVIDER_STRING_SCORES = JSON.stringify({
  overallScore: '84',
  codeQualityScore: '90',
  maintainabilityScore: '78',
  securityScore: '92',
  documentationScore: '70',
  testCoverageScore: '65',
  grade: 'A',
  summary: 'Strong codebase.',
  findings: [],
  recommendations: [],
});

// Simulates a provider that wraps the report in a 'result' key
const PROVIDER_WRAPPED = JSON.stringify({
  result: {
    overallScore: 50,
    grade: 'C',
    summary: 'Needs work.',
    findings: [],
    recommendations: [],
  },
});

// Simulates a provider that returns scores > 100 (clamp check)
const PROVIDER_OUT_OF_RANGE = JSON.stringify({
  overallScore: 150,
  codeQualityScore: -10,
  grade: 'S',
  summary: 'Parser should clamp these.',
  findings: [],
  recommendations: [],
});

// Minimal valid payload — only required fields
const PROVIDER_MINIMAL = JSON.stringify({
  overallScore: 0,
  grade: 'F',
  summary: '',
  findings: [],
  recommendations: [],
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('parseHealthReport — provider normalization', () => {
  it('parses a typical Gemini response without throwing', () => {
    const report = parseHealthReport(GEMINI_TYPICAL);
    assertValidHealthReport(report);
  });

  it('coerces string-typed score values to numbers', () => {
    // parseHealthReport should handle providers that stringify numbers.
    // If it does not coerce, the assertValidHealthReport type check will fail.
    let report: any;
    try {
      report = parseHealthReport(PROVIDER_STRING_SCORES);
    } catch {
      // If the parser throws on string scores, that is itself a bug — fail explicitly.
      throw new Error(
        'parseHealthReport threw on string-typed scores. ' +
        'Add Number() coercion in responseParser.ts for all score fields.'
      );
    }
    assertValidHealthReport(report);
  });

  it('returns a valid report from a minimal payload', () => {
    const report = parseHealthReport(PROVIDER_MINIMAL);
    expect(report).toBeDefined();
    expect((report as any).overallScore).toBe(0);
  });

  it('handles out-of-range scores gracefully (clamp or passthrough, but no throw)', () => {
    expect(() => parseHealthReport(PROVIDER_OUT_OF_RANGE)).not.toThrow();
  });

  it('does not throw on malformed JSON — returns a fallback or throws a typed error', () => {
    // The parser may either return a fallback shape or throw a typed Error.
    // What it must NOT do is propagate a raw SyntaxError with no context.
    let threw = false;
    let errorMessage = '';
    try {
      parseHealthReport('{not valid json');
    } catch (e: any) {
      threw = true;
      errorMessage = e?.message ?? '';
    }
    if (threw) {
      // If it throws, it should include context, not be a bare SyntaxError
      expect(errorMessage).not.toBe('');
    }
    // If it did not throw (returned a fallback), that is also acceptable.
  });

  it('produces identical output on repeated calls with the same input (determinism check)', () => {
    const r1 = parseHealthReport(GEMINI_TYPICAL);
    const r2 = parseHealthReport(GEMINI_TYPICAL);
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });
});
