import { describe, expect, it } from 'vitest';
import { parseSccJson, parseTokeiJson } from './loc.js';

describe('parseSccJson', () => {
  it('aggregates per-language rows and computes a total', () => {
    const summary = parseSccJson(
      JSON.stringify([
        { Name: 'TypeScript', Code: 200, Comment: 50, Blank: 30, Count: 4 },
        { Name: 'Python', Code: 100, Comment: 10, Blank: 5, Count: 2 },
      ]),
    )!;
    expect(summary.tool).toBe('scc');
    expect(summary.byLanguage.TypeScript).toEqual({ code: 200, comments: 50, blanks: 30, files: 4 });
    expect(summary.total).toEqual({ code: 300, comments: 60, blanks: 35, files: 6 });
  });

  it('returns null for junk or an empty language set', () => {
    expect(parseSccJson('not json')).toBeNull();
    expect(parseSccJson('{}')).toBeNull();
    expect(parseSccJson('[]')).toBeNull();
  });
});

describe('parseTokeiJson', () => {
  it('aggregates language keys and excludes the Total key', () => {
    const summary = parseTokeiJson(
      JSON.stringify({
        TypeScript: { code: 200, comments: 50, blanks: 30, reports: [{}, {}] },
        Total: { code: 200, comments: 50, blanks: 30 },
      }),
    )!;
    expect(summary.tool).toBe('tokei');
    expect(summary.byLanguage.TypeScript).toEqual({ code: 200, comments: 50, blanks: 30, files: 2 });
    expect(summary.byLanguage.Total).toBeUndefined();
    expect(summary.total.code).toBe(200);
  });

  it('returns null for junk or an empty language set', () => {
    expect(parseTokeiJson('nope')).toBeNull();
    expect(parseTokeiJson('[]')).toBeNull();
    expect(parseTokeiJson('{"Total":{"code":5}}')).toBeNull();
  });
});
